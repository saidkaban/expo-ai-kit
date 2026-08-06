import AVFoundation
import Foundation
import Speech

/// On-device speech recognition via Apple's SpeechAnalyzer/SpeechTranscriber
/// (iOS 26+). Owns availability, OS-managed asset preparation, batch file
/// transcription (with audio-time segments), and the live microphone session.
///
/// Errors use the module's "CODE:modelId:reason" contract with modelId
/// "apple-speech". The module gates every call behind #available(iOS 26).
@available(iOS 26.0, *)
final class SpeechRecognitionClient {
  // Live-session state (one session at a time — the JS layer enforces the
  // speech single-flight, so these are simple optionals).
  private var liveAnalyzer: SpeechAnalyzer?
  private var liveTranscriber: SpeechTranscriber?
  private var liveEngine: AVAudioEngine?
  private var liveInputContinuation: AsyncStream<AnalyzerInput>.Continuation?
  private var liveResultsTask: Task<Void, Never>?
  private var preparingLocale = false

  private func contractError(_ code: String, _ reason: String) -> NSError {
    return NSError(
      domain: "ExpoAiKit", code: 0,
      userInfo: [NSLocalizedDescriptionKey: "\(code):apple-speech:\(reason)"]
    )
  }

  // ==================================================================
  // Locales & availability
  // ==================================================================

  func supportedLocaleIdentifiers() async -> [String] {
    let locales = await SpeechTranscriber.supportedLocales
    return locales.map { $0.identifier(.bcp47) }.sorted()
  }

  /// Resolve a requested BCP-47 tag ('' = device locale) against the engine's
  /// supported locales: exact match first, then same primary language.
  func resolveLocale(_ requested: String) async throws -> Locale {
    let supported = await SpeechTranscriber.supportedLocales
    let wanted = requested.isEmpty ? Locale.current : Locale(identifier: requested)
    let wantedId = wanted.identifier(.bcp47).lowercased()
    if let exact = supported.first(where: { $0.identifier(.bcp47).lowercased() == wantedId }) {
      return exact
    }
    let wantedLanguage = wantedId.split(separator: "-").first.map(String.init) ?? wantedId
    if let sameLanguage = supported.first(where: {
      $0.identifier(.bcp47).lowercased().split(separator: "-").first.map(String.init) == wantedLanguage
    }) {
      return sameLanguage
    }
    throw contractError(
      "LANGUAGE_NOT_SUPPORTED",
      "No on-device speech model supports locale \"\(requested.isEmpty ? wantedId : requested)\". " +
        "Call getSupportedSpeechLocales() for the list")
  }

  /// Status for the JS availability contract. The device gate is
  /// SpeechTranscriber.isAvailable; the locale gate is supported/installed.
  func availability(requestedLocale: String) async -> [String: Any] {
    guard SpeechTranscriber.isAvailable else {
      return ["status": "unavailable", "reason": "device"]
    }
    let locale: Locale
    do {
      locale = try await resolveLocale(requestedLocale)
    } catch {
      return ["status": "unavailable", "reason": "locale"]
    }
    if preparingLocale {
      return ["status": "downloading"]
    }
    let installed = await SpeechTranscriber.installedLocales
    let localeId = locale.identifier(.bcp47).lowercased()
    if installed.contains(where: { $0.identifier(.bcp47).lowercased() == localeId }) {
      return ["status": "available"]
    }
    return ["status": "downloadable"]
  }

  /// Download the OS-managed model assets for a locale when needed.
  /// Progress is polled from the request's Foundation Progress.
  func prepare(requestedLocale: String, onProgress: @escaping (Double) -> Void) async throws {
    guard SpeechTranscriber.isAvailable else {
      throw contractError("DEVICE_NOT_SUPPORTED", "Speech recognition is not supported on this device")
    }
    let locale = try await resolveLocale(requestedLocale)
    let transcriber = SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: [],
      attributeOptions: []
    )
    guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
    else {
      onProgress(1.0)
      return
    }
    preparingLocale = true
    defer { preparingLocale = false }
    let progress = request.progress
    let poll = Task {
      while !Task.isCancelled {
        onProgress(progress.fractionCompleted)
        try? await Task.sleep(nanoseconds: 200_000_000)
      }
    }
    defer { poll.cancel() }
    do {
      try await request.downloadAndInstall()
      onProgress(1.0)
    } catch {
      throw contractError("DOWNLOAD_FAILED", "Speech model download failed: \(error.localizedDescription)")
    }
  }

  /// Throw MODEL_NOT_DOWNLOADED when the locale's OS-managed assets are not
  /// installed yet — matching the documented availability lifecycle.
  private func requireInstalledLocale(_ locale: Locale) async throws {
    let installed = await SpeechTranscriber.installedLocales
    let localeId = locale.identifier(.bcp47).lowercased()
    guard installed.contains(where: { $0.identifier(.bcp47).lowercased() == localeId }) else {
      throw contractError(
        "MODEL_NOT_DOWNLOADED",
        "The speech model for \(locale.identifier(.bcp47)) is not installed. " +
          "Call prepareSpeechRecognition() first")
    }
  }

  // ==================================================================
  // Batch file transcription
  // ==================================================================

  /// Transcribe a local audio file. Faster than real time; finalized results
  /// carry audioTimeRange attributes which become the public segments.
  func transcribeFile(url: URL, requestedLocale: String) async throws -> [String: Any] {
    guard SpeechTranscriber.isAvailable else {
      throw contractError("DEVICE_NOT_SUPPORTED", "Speech recognition is not supported on this device")
    }
    let locale = try await resolveLocale(requestedLocale)

    // Honor the availability contract: a supported-but-not-installed locale is
    // MODEL_NOT_DOWNLOADED (call prepareSpeechRecognition first), not a raw
    // engine failure.
    try await requireInstalledLocale(locale)

    let audioFile: AVAudioFile
    do {
      audioFile = try AVAudioFile(forReading: url)
    } catch {
      throw contractError(
        "AUDIO_DECODE_FAILED", "Could not read audio file: \(error.localizedDescription)")
    }
    let duration = Double(audioFile.length) / audioFile.processingFormat.sampleRate

    let transcriber = SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: [],
      attributeOptions: [.audioTimeRange]
    )
    let analyzer = SpeechAnalyzer(modules: [transcriber])

    // Collect finalized results concurrently with feeding the file.
    let collector = Task<([[String: Any]], String), Error> {
      var segments: [[String: Any]] = []
      var pieces: [String] = []
      for try await result in transcriber.results {
        guard result.isFinal else { continue }
        let text = String(result.text.characters)
        guard !text.isEmpty else { continue }
        var start: Double?
        var end: Double?
        for run in result.text.runs {
          if let range = run.audioTimeRange {
            let runStart = CMTimeGetSeconds(range.start)
            let runEnd = CMTimeGetSeconds(CMTimeRangeGetEnd(range))
            start = min(start ?? runStart, runStart)
            end = max(end ?? runEnd, runEnd)
          }
        }
        pieces.append(text)
        segments.append([
          "text": text,
          "startSeconds": start ?? 0.0,
          "endSeconds": end ?? start ?? 0.0,
        ])
      }
      return (segments, pieces.joined(separator: " "))
    }

    do {
      if let lastSample = try await analyzer.analyzeSequence(from: audioFile) {
        try await analyzer.finalizeAndFinish(through: lastSample)
      } else {
        await analyzer.cancelAndFinishNow()
      }
    } catch is CancellationError {
      collector.cancel()
      await analyzer.cancelAndFinishNow()
      throw contractError("INFERENCE_CANCELLED", "Transcription was cancelled")
    } catch {
      collector.cancel()
      await analyzer.cancelAndFinishNow()
      throw contractError("TRANSCRIPTION_FAILED", error.localizedDescription)
    }

    let (segments, text): ([[String: Any]], String)
    do {
      (segments, text) = try await collector.value
    } catch {
      throw contractError("TRANSCRIPTION_FAILED", error.localizedDescription)
    }

    return [
      "text": text,
      "segments": segments,
      "language": locale.identifier(.bcp47),
      "durationSeconds": duration,
    ]
  }

  // ==================================================================
  // Live microphone transcription
  // ==================================================================

  func startLive(
    requestedLocale: String,
    onUpdate: @escaping (_ text: String, _ isFinal: Bool) -> Void,
    onError: @escaping (_ contract: String) -> Void,
    onEnd: @escaping () -> Void
  ) async throws {
    guard SpeechTranscriber.isAvailable else {
      throw contractError("DEVICE_NOT_SUPPORTED", "Speech recognition is not supported on this device")
    }
    let locale = try await resolveLocale(requestedLocale)

    let granted = AVAudioApplication.shared.recordPermission == .granted
    guard granted else {
      throw contractError(
        "MIC_PERMISSION_DENIED",
        "Microphone permission is required for live transcription. Call requestSpeechPermissionsAsync() first")
    }

    try await requireInstalledLocale(locale)

    let transcriber = SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: [.volatileResults],
      attributeOptions: []
    )
    let analyzer = SpeechAnalyzer(modules: [transcriber])

    guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
      compatibleWith: [transcriber])
    else {
      throw contractError("TRANSCRIPTION_FAILED", "No compatible audio format for the speech engine")
    }

    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.record, mode: .measurement, options: [])
      try session.setActive(true, options: [])
    } catch {
      throw contractError("TRANSCRIPTION_FAILED", "Audio session error: \(error.localizedDescription)")
    }

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    guard let converter = AVAudioConverter(from: inputFormat, to: analyzerFormat) else {
      try? session.setActive(false, options: [.notifyOthersOnDeactivation])
      throw contractError("TRANSCRIPTION_FAILED", "Could not convert microphone audio to the engine format")
    }

    let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)

    input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
      let ratio = analyzerFormat.sampleRate / inputFormat.sampleRate
      let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up) + 16)
      guard let converted = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity)
      else { return }
      var consumed = false
      var conversionError: NSError?
      converter.convert(to: converted, error: &conversionError) { _, outStatus in
        if consumed {
          outStatus.pointee = .noDataNow
          return nil
        }
        consumed = true
        outStatus.pointee = .haveData
        return buffer
      }
      if conversionError == nil, converted.frameLength > 0 {
        continuation.yield(AnalyzerInput(buffer: converted))
      }
    }

    let resultsTask = Task {
      do {
        for try await result in transcriber.results {
          onUpdate(String(result.text.characters), result.isFinal)
        }
        onEnd()
      } catch is CancellationError {
        // Torn down by a failed start — the module surfaces the typed error;
        // emitting onEnd here would settle the JS stream as a success first.
      } catch {
        onError("TRANSCRIPTION_FAILED:apple-speech:\(error.localizedDescription)")
      }
    }

    engine.prepare()
    do {
      try engine.start()
      try await analyzer.start(inputSequence: stream)
    } catch {
      resultsTask.cancel()
      continuation.finish()
      engine.stop()
      input.removeTap(onBus: 0)
      try? session.setActive(false, options: [.notifyOthersOnDeactivation])
      throw contractError("TRANSCRIPTION_FAILED", "Could not start live transcription: \(error.localizedDescription)")
    }

    liveAnalyzer = analyzer
    liveTranscriber = transcriber
    liveEngine = engine
    liveInputContinuation = continuation
    liveResultsTask = resultsTask
  }

  /// Stop the live session, letting the engine finalize the tail. The results
  /// loop ends afterwards, which fires onEnd (the terminal event for JS).
  func stopLive() async {
    guard let analyzer = liveAnalyzer else { return }
    liveEngine?.stop()
    liveEngine?.inputNode.removeTap(onBus: 0)
    liveInputContinuation?.finish()
    try? await analyzer.finalizeAndFinishThroughEndOfInput()
    // Safety net: if finalize did not terminate the results sequence, cancel
    // the loop task so it never leaks (JS has already settled via stop()).
    liveResultsTask?.cancel()
    liveAnalyzer = nil
    liveTranscriber = nil
    liveEngine = nil
    liveInputContinuation = nil
    liveResultsTask = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }
}
