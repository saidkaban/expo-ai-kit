import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

/// On-device vision via Apple's Vision framework: subject cutouts
/// (VNGenerateForegroundInstanceMaskRequest, iOS 17+), image labels
/// (VNClassifyImageRequest), and text recognition (VNRecognizeTextRequest).
///
/// Errors use the module's "CODE:modelId:reason" contract with modelId
/// "apple-vision". Cutouts are written to the app's Caches directory and
/// returned as file:// URIs so no pixel data crosses the bridge. Every model
/// ships with the OS, so there is nothing to download on iOS.
final class VisionClient {
  static let modelId = "apple-vision"

  /// Decode budgets (width × height) per feature. Vision's classifier and OCR
  /// models run at modest internal resolutions, so capping the input bounds
  /// memory without costing accuracy.
  private static let labelingMaxPixels = 1_000_000
  private static let textMaxPixels = 4_000_000

  /// The iOS Simulator cannot run Vision's neural-network requests: foreground
  /// masking and image classification fail with "Failed to create espresso
  /// context". Text recognition works there. Verified on Xcode 26.3.
  #if targetEnvironment(simulator)
    private static let isSimulator = true
  #else
    private static let isSimulator = false
  #endif

  private let renderContext = CIContext()

  private func contractError(_ code: String, _ reason: String) -> NSError {
    return NSError(
      domain: "ExpoAiKit", code: 0,
      userInfo: [NSLocalizedDescriptionKey: "\(code):\(Self.modelId):\(reason)"]
    )
  }

  // ==================================================================
  // Availability
  // ==================================================================

  private var backgroundRemovalAvailability: [String: Any] {
    guard #available(iOS 17.0, *) else {
      return ["status": "unavailable", "reason": "os-version"]
    }
    if Self.isSimulator {
      return ["status": "unavailable", "reason": "device"]
    }
    return ["status": "available"]
  }

  private var imageLabelingAvailability: [String: Any] {
    if Self.isSimulator {
      return ["status": "unavailable", "reason": "device"]
    }
    return ["status": "available"]
  }

  func availability() -> [String: Any] {
    return [
      "backgroundRemoval": backgroundRemovalAvailability,
      "imageLabeling": imageLabelingAvailability,
      "textRecognition": ["status": "available"],
    ]
  }

  /// Validate that the requested features can run here. iOS has nothing to
  /// download, so this is the whole of prepareVision() on this platform.
  func requireFeatures(_ features: [String]) throws {
    if features.contains("background-removal") {
      try requireBackgroundRemoval()
    }
    if features.contains("image-labeling") {
      try requireImageLabeling()
    }
  }

  private func requireBackgroundRemoval() throws {
    guard #available(iOS 17.0, *) else {
      throw contractError("DEVICE_NOT_SUPPORTED", "Background removal requires iOS 17 or later")
    }
    if Self.isSimulator {
      throw contractError(
        "DEVICE_NOT_SUPPORTED",
        "Background removal requires a physical device. The iOS Simulator cannot run Vision foreground masking")
    }
  }

  private func requireImageLabeling() throws {
    if Self.isSimulator {
      throw contractError(
        "DEVICE_NOT_SUPPORTED",
        "Image labeling requires a physical device. The iOS Simulator cannot run Vision's image classifier")
    }
  }

  func supportedTextLanguages() -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    return ((try? request.supportedRecognitionLanguages()) ?? []).sorted()
  }

  // ==================================================================
  // Image loading and output files
  // ==================================================================

  private func fileURL(from path: String) -> URL {
    if path.hasPrefix("file://"), let url = URL(string: path) {
      return url
    }
    return URL(fileURLWithPath: path)
  }

  /// Decode an image upright (EXIF orientation baked in) and downscaled so
  /// width × height stays within `maxPixels`.
  private func loadImage(path: String, maxPixels: Int) throws -> CGImage {
    let url = fileURL(from: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
      throw contractError("IMAGE_DECODE_FAILED", "Could not open an image at \(path)")
    }
    let budget = Double(max(maxPixels, 1))
    var maxPixelSize = Int(budget.squareRoot().rounded(.up))
    if let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = props[kCGImagePropertyPixelWidth] as? Double,
      let height = props[kCGImagePropertyPixelHeight] as? Double,
      width > 0, height > 0
    {
      let longest = max(width, height)
      let total = width * height
      if total <= budget {
        maxPixelSize = Int(longest.rounded(.up))
      } else {
        maxPixelSize = max(1, Int((longest * (budget / total).squareRoot()).rounded(.up)))
      }
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      throw contractError("IMAGE_DECODE_FAILED", "The file at \(path) could not be decoded as an image")
    }
    return image
  }

  private func outputDirectory() throws -> URL {
    let caches =
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    let directory = caches.appendingPathComponent("expo-ai-kit/vision", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func writeImage(_ image: CGImage, jpeg: Bool, quality: Double) throws -> URL {
    let directory = try outputDirectory()
    let url = directory.appendingPathComponent("\(UUID().uuidString).\(jpeg ? "jpg" : "png")")
    let type = (jpeg ? UTType.jpeg : UTType.png).identifier as CFString
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) else {
      throw contractError("VISION_FAILED", "Could not create the output image file")
    }
    var properties: [CFString: Any] = [:]
    if jpeg {
      properties[kCGImageDestinationLossyCompressionQuality] = min(max(quality, 0), 1)
    }
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw contractError("VISION_FAILED", "Could not encode the cutout image")
    }
    return url
  }

  // ==================================================================
  // Background removal (subject cutout)
  // ==================================================================

  private struct MaskMetrics {
    let coverage: Double
    let centroidX: Double
    let centroidY: Double
    /// nil when no pixel cleared the 0.5 foreground threshold.
    let bounds: (x: Int, y: Int, width: Int, height: Int)?
  }

  /// Scan a OneComponent32Float mask (top-left row order) for coverage,
  /// centroid, and the bounding box of pixels above the foreground threshold.
  private func maskMetrics(_ buffer: CVPixelBuffer, width: Int, height: Int) throws -> MaskMetrics {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else {
      throw contractError("VISION_FAILED", "The subject mask has no readable pixels")
    }
    let scanWidth = min(width, CVPixelBufferGetWidth(buffer))
    let scanHeight = min(height, CVPixelBufferGetHeight(buffer))
    let rowFloats = CVPixelBufferGetBytesPerRow(buffer) / MemoryLayout<Float32>.size
    let source = base.assumingMemoryBound(to: Float32.self)

    var foreground = 0
    var sumX = 0.0
    var sumY = 0.0
    var minX = scanWidth
    var minY = scanHeight
    var maxX = -1
    var maxY = -1
    for y in 0..<scanHeight {
      let row = source.advanced(by: y * rowFloats)
      for x in 0..<scanWidth where row[x] > 0.5 {
        foreground += 1
        sumX += Double(x)
        sumY += Double(y)
        if x < minX { minX = x }
        if y < minY { minY = y }
        if x > maxX { maxX = x }
        if y > maxY { maxY = y }
      }
    }
    guard foreground > 0, maxX >= 0 else {
      return MaskMetrics(coverage: 0, centroidX: 0.5, centroidY: 0.5, bounds: nil)
    }
    return MaskMetrics(
      coverage: Double(foreground) / Double(width * height),
      centroidX: (sumX / Double(foreground) + 0.5) / Double(width),
      centroidY: (sumY / Double(foreground) + 0.5) / Double(height),
      bounds: (x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    )
  }

  /// Which instance sits under a normalized point, read from Vision's
  /// per-pixel instance map (0 = background). The map is at the model's
  /// resolution, so the point is scaled into it.
  @available(iOS 17.0, *)
  private func instanceIndex(
    at point: (x: Double, y: Double), in observation: VNInstanceMaskObservation
  ) -> Int {
    let map = observation.instanceMask
    CVPixelBufferLockBaseAddress(map, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(map) else { return 0 }
    let width = CVPixelBufferGetWidth(map)
    let height = CVPixelBufferGetHeight(map)
    guard width > 0, height > 0 else { return 0 }
    let x = min(width - 1, max(0, Int(point.x * Double(width))))
    let y = min(height - 1, max(0, Int(point.y * Double(height))))
    let bytesPerRow = CVPixelBufferGetBytesPerRow(map)
    return Int(base.assumingMemoryBound(to: UInt8.self)[y * bytesPerRow + x])
  }

  /// Write the float mask for a crop rect as an 8-bit grayscale PNG (white = subject).
  private func writeMask(
    _ buffer: CVPixelBuffer, cropX: Int, cropY: Int, cropWidth: Int, cropHeight: Int
  ) throws -> URL {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else {
      throw contractError("VISION_FAILED", "The subject mask has no readable pixels")
    }
    let maskWidth = CVPixelBufferGetWidth(buffer)
    let maskHeight = CVPixelBufferGetHeight(buffer)
    let rowFloats = CVPixelBufferGetBytesPerRow(buffer) / MemoryLayout<Float32>.size
    let source = base.assumingMemoryBound(to: Float32.self)
    var bytes = [UInt8](repeating: 0, count: cropWidth * cropHeight)
    for row in 0..<cropHeight {
      let sourceY = cropY + row
      guard sourceY < maskHeight else { break }
      let sourceRow = source.advanced(by: sourceY * rowFloats)
      for column in 0..<cropWidth {
        let sourceX = cropX + column
        guard sourceX < maskWidth else { break }
        bytes[row * cropWidth + column] = UInt8(min(255, max(0, sourceRow[sourceX] * 255)))
      }
    }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData),
      let image = CGImage(
        width: cropWidth, height: cropHeight, bitsPerComponent: 8, bitsPerPixel: 8,
        bytesPerRow: cropWidth, space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else {
      throw contractError("VISION_FAILED", "Could not build the mask image")
    }
    return try writeImage(image, jpeg: false, quality: 1)
  }

  func removeBackground(
    path: String, trim: Bool, format: String, quality: Double, maxPixels: Int,
    subjectX: Double, subjectY: Double, includeMask: Bool
  ) throws -> [String: Any] {
    try requireBackgroundRemoval()
    guard #available(iOS 17.0, *) else {
      throw contractError("DEVICE_NOT_SUPPORTED", "Background removal requires iOS 17 or later")
    }

    let cgImage = try loadImage(path: path, maxPixels: maxPixels)
    let sourceWidth = cgImage.width
    let sourceHeight = cgImage.height
    guard sourceWidth > 0, sourceHeight > 0 else {
      throw contractError("IMAGE_DECODE_FAILED", "The image has no readable pixels")
    }
    // Orientation is already baked into the pixels, so Vision gets `.up`.
    let ciImage = CIImage(cgImage: cgImage)
    let handler = VNImageRequestHandler(ciImage: ciImage, orientation: .up)
    let request = VNGenerateForegroundInstanceMaskRequest()
    do {
      try handler.perform([request])
    } catch {
      throw contractError("VISION_FAILED", "Subject segmentation failed: \(error.localizedDescription)")
    }
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      throw contractError("NO_SUBJECT_FOUND", "No foreground subject detected in the image")
    }
    // Keep every instance, or only the one under the caller's point.
    var instances = observation.allInstances
    if subjectX >= 0, subjectY >= 0 {
      let index = instanceIndex(at: (subjectX, subjectY), in: observation)
      guard index > 0, observation.allInstances.contains(index) else {
        throw contractError("NO_SUBJECT_FOUND", "No subject under the selected point")
      }
      instances = IndexSet(integer: index)
    }
    let maskBuffer: CVPixelBuffer
    do {
      maskBuffer = try observation.generateScaledMaskForImage(forInstances: instances, from: handler)
    } catch {
      throw contractError("VISION_FAILED", "Could not build the subject mask: \(error.localizedDescription)")
    }
    let metrics = try maskMetrics(maskBuffer, width: sourceWidth, height: sourceHeight)
    guard let pixelBounds = metrics.bounds else {
      throw contractError("NO_SUBJECT_FOUND", "No foreground subject detected in the image")
    }

    // Composite: subject over transparency (PNG) or white (JPEG has no alpha).
    let jpeg = format == "jpeg"
    let blend = CIFilter.blendWithMask()
    blend.inputImage = ciImage
    blend.maskImage = CIImage(cvPixelBuffer: maskBuffer)
    blend.backgroundImage =
      jpeg ? CIImage(color: CIColor.white).cropped(to: ciImage.extent) : CIImage.empty()
    guard let composited = blend.outputImage else {
      throw contractError("VISION_FAILED", "Could not composite the subject mask")
    }

    var cropX = 0
    var cropY = 0
    var cropWidth = sourceWidth
    var cropHeight = sourceHeight
    if trim {
      let pad = 2
      cropX = max(0, pixelBounds.x - pad)
      cropY = max(0, pixelBounds.y - pad)
      let right = min(sourceWidth - 1, pixelBounds.x + pixelBounds.width - 1 + pad)
      let bottom = min(sourceHeight - 1, pixelBounds.y + pixelBounds.height - 1 + pad)
      cropWidth = right - cropX + 1
      cropHeight = bottom - cropY + 1
    }
    // Core Image's origin is bottom-left; the mask metrics are top-left rows.
    let renderRect = CGRect(
      x: cropX, y: sourceHeight - cropY - cropHeight, width: cropWidth, height: cropHeight)
    guard let rendered = renderContext.createCGImage(composited, from: renderRect) else {
      throw contractError("VISION_FAILED", "Could not render the cutout")
    }
    let url = try writeImage(rendered, jpeg: jpeg, quality: quality)
    var maskUri: String?
    if includeMask {
      maskUri = try writeMask(
        maskBuffer, cropX: cropX, cropY: cropY, cropWidth: cropWidth, cropHeight: cropHeight
      ).absoluteString
    }

    let w = Double(sourceWidth)
    let h = Double(sourceHeight)
    var result: [String: Any] = [
      "uri": url.absoluteString,
      "width": cropWidth,
      "height": cropHeight,
      "sourceWidth": sourceWidth,
      "sourceHeight": sourceHeight,
      "bounds": [
        "x": Double(pixelBounds.x) / w,
        "y": Double(pixelBounds.y) / h,
        "width": Double(pixelBounds.width) / w,
        "height": Double(pixelBounds.height) / h,
      ],
      "pixelBounds": [
        "x": pixelBounds.x,
        "y": pixelBounds.y,
        "width": pixelBounds.width,
        "height": pixelBounds.height,
      ],
      "foregroundCoverage": metrics.coverage,
      "centroid": ["x": metrics.centroidX, "y": metrics.centroidY],
      "instanceCount": observation.allInstances.count,
      "trimOrigin": ["x": Double(cropX) / w, "y": Double(cropY) / h],
    ]
    if let maskUri {
      result["maskUri"] = maskUri
    }
    return result
  }

  // ==================================================================
  // Image labels
  // ==================================================================

  func labelImage(path: String, maxResults: Int, minConfidence: Double) throws -> [[String: Any]] {
    try requireImageLabeling()
    let cgImage = try loadImage(path: path, maxPixels: Self.labelingMaxPixels)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
    let request = VNClassifyImageRequest()
    do {
      try handler.perform([request])
    } catch {
      throw contractError("VISION_FAILED", "Image labeling failed: \(error.localizedDescription)")
    }
    let observations = (request.results ?? [])
      .filter { Double($0.confidence) >= minConfidence }
      .sorted { $0.confidence > $1.confidence }
    let limited = maxResults > 0 ? Array(observations.prefix(maxResults)) : observations
    return limited.map { ["label": $0.identifier, "confidence": Double($0.confidence)] }
  }

  // ==================================================================
  // Text recognition (OCR)
  // ==================================================================

  /// Resolve requested BCP-47 tags against Vision's supported recognition
  /// languages: exact match first, then the same primary language ('en' ->
  /// 'en-US'). Throws LANGUAGE_NOT_SUPPORTED naming the first miss.
  private func resolveTextLanguages(_ requested: [String], request: VNRecognizeTextRequest) throws -> [String] {
    guard !requested.isEmpty else { return [] }
    let supported = (try? request.supportedRecognitionLanguages()) ?? []
    var resolved: [String] = []
    for tag in requested {
      let wanted = tag.lowercased()
      if let exact = supported.first(where: { $0.lowercased() == wanted }) {
        resolved.append(exact)
        continue
      }
      let language = wanted.split(separator: "-").first.map(String.init) ?? wanted
      if let sameLanguage = supported.first(where: {
        $0.lowercased().split(separator: "-").first.map(String.init) == language
      }) {
        resolved.append(sameLanguage)
        continue
      }
      throw contractError(
        "LANGUAGE_NOT_SUPPORTED",
        "No on-device text-recognition model reads \"\(tag)\". Call getSupportedTextRecognitionLanguages() for the list")
    }
    return resolved
  }

  private func normalizedRect(_ box: CGRect) -> [String: Any] {
    // Vision reports normalized rects with a bottom-left origin; flip to top-left.
    return [
      "x": Double(box.origin.x),
      "y": Double(1 - box.origin.y - box.size.height),
      "width": Double(box.size.width),
      "height": Double(box.size.height),
    ]
  }

  private func normalizedPoint(_ point: CGPoint) -> [String: Any] {
    return ["x": Double(point.x), "y": Double(1 - point.y)]
  }

  func recognizeText(
    path: String,
    languages: [String],
    recognitionLevel: String,
    usesLanguageCorrection: Bool,
    customWords: [String],
    minTextHeight: Double
  ) throws -> [String: Any] {
    let cgImage = try loadImage(path: path, maxPixels: Self.textMaxPixels)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = recognitionLevel == "fast" ? .fast : .accurate

    let resolvedLanguages = try resolveTextLanguages(languages, request: request)
    if !resolvedLanguages.isEmpty {
      request.recognitionLanguages = resolvedLanguages
      if #available(iOS 16.0, *) {
        request.automaticallyDetectsLanguage = false
      }
    } else if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = true
    }

    // Apple's Chinese models do not support language correction.
    let chineseOnly =
      !resolvedLanguages.isEmpty
      && resolvedLanguages.allSatisfy {
        $0.lowercased().hasPrefix("zh") || $0.lowercased().hasPrefix("yue")
      }
    let correction = chineseOnly ? false : usesLanguageCorrection
    request.usesLanguageCorrection = correction
    if correction, !customWords.isEmpty {
      request.customWords = customWords
    }
    if minTextHeight > 0 {
      request.minimumTextHeight = Float(min(minTextHeight, 1))
    }

    do {
      try handler.perform([request])
    } catch {
      throw contractError("VISION_FAILED", "Text recognition failed: \(error.localizedDescription)")
    }

    var blocks: [[String: Any]] = []
    var texts: [String] = []
    for observation in request.results ?? [] {
      guard let candidate = observation.topCandidates(1).first else { continue }
      let bounds = normalizedRect(observation.boundingBox)
      let corners = [
        observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft,
      ].map(normalizedPoint)
      let line: [String: Any] = [
        "text": candidate.string,
        "bounds": bounds,
        "confidence": Double(candidate.confidence),
        "cornerPoints": corners,
      ]
      // Vision has no paragraph grouping: each observation is a one-line block.
      blocks.append([
        "text": candidate.string,
        "bounds": bounds,
        "lines": [line],
        "cornerPoints": corners,
      ])
      texts.append(candidate.string)
    }
    return ["text": texts.joined(separator: "\n"), "blocks": blocks]
  }
}
