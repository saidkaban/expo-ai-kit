package expo.modules.aikit.vision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Point
import android.graphics.Rect
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.OptionalModuleApi
import com.google.android.gms.common.moduleinstall.InstallStatusListener
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallClient
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.aikit.VisionBackend
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.sqrt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * ML Kit vision backend: Subject Segmentation (Google Play services module,
 * beta), Image Labeling (model bundled with the app), and Text Recognition v2
 * (one Play services module per script: Latin, Chinese, Japanese, Korean,
 * Devanagari).
 *
 * Models are never downloaded implicitly, [prepare] installs the Play
 * services modules and the analysis calls throw MODEL_NOT_DOWNLOADED until it
 * has. Bitmaps handed to ML Kit are immutable ARGB_8888 software copies with
 * the longest edge capped (mutable/hardware bitmaps can crash across the
 * Play services binder boundary; the segmentation model works at ~512 px).
 */
class MlKitVisionBackend(private val context: Context) : VisionBackend {

  companion object {
    const val MODEL_ID = "mlkit-vision"
    private const val SEGMENT_MAX_EDGE = 512
    private const val TEXT_MAX_EDGE = 2048
    private const val LABELING_MAX_PIXELS = 1_000_000
    private const val TEXT_MAX_PIXELS = 4_000_000
    private const val INSTALL_TIMEOUT_MS = 120_000L
    private const val INSTALL_POLL_MS = 2_000L
    private const val FOREGROUND_THRESHOLD = 0.5f
  }

  private enum class Script { LATIN, CHINESE, JAPANESE, KOREAN, DEVANAGARI }

  private val installClient: ModuleInstallClient by lazy { ModuleInstall.getClient(context) }

  private val segmenterLock = Any()
  private var segmenter: SubjectSegmenter? = null

  private val textClientsLock = Any()
  private val textClients = HashMap<Script, TextRecognizer>()

  private fun fail(code: String, reason: String): Nothing =
    throw RuntimeException("$code:$MODEL_ID:$reason")

  private fun isContract(e: Throwable): Boolean =
    e.message?.let { Regex("^[A-Z][A-Z_]*:").containsMatchIn(it) } == true

  /** Re-throw contract errors untouched; wrap anything else as [code]. */
  private inline fun <T> wrapping(code: String, block: () -> T): T =
    try {
      block()
    } catch (e: CancellationException) {
      throw e
    } catch (e: RuntimeException) {
      if (isContract(e)) throw e
      fail(code, e.message ?: e.toString())
    } catch (e: Throwable) {
      fail(code, e.message ?: e.toString())
    }

  // ==================================================================
  // Play services & module install
  // ==================================================================

  private fun playServicesAvailable(): Boolean =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
      ConnectionResult.SUCCESS

  private fun requirePlayServices(feature: String) {
    if (!playServicesAvailable()) {
      fail("DEVICE_NOT_SUPPORTED", "$feature requires Google Play services, which this device does not have")
    }
  }

  private suspend fun modulesInstalled(apis: List<OptionalModuleApi>): Boolean =
    try {
      installClient.areModulesAvailable(*apis.toTypedArray()).await().areModulesAvailable()
    } catch (_: Throwable) {
      false
    }

  private suspend fun requireModules(feature: String, apis: List<OptionalModuleApi>) {
    if (!modulesInstalled(apis)) {
      fail(
        "MODEL_NOT_DOWNLOADED",
        "The on-device $feature model is not installed yet. Call prepareVision() first, " +
          "vision calls never download models themselves"
      )
    }
  }

  private suspend fun installModules(apis: List<OptionalModuleApi>, onProgress: (Double) -> Unit) {
    if (apis.isEmpty() || modulesInstalled(apis)) {
      onProgress(1.0)
      return
    }
    onProgress(0.0)
    var failure: Throwable? = null
    val completed = try {
      withTimeoutOrNull(INSTALL_TIMEOUT_MS) {
        coroutineScope {
          val install = async { awaitInstall(apis, onProgress) }
          // Play services does not always deliver a terminal listener update;
          // polling availability is the reliable signal, the listener just
          // makes success and failure land sooner.
          val poll = async {
            while (!modulesInstalled(apis)) delay(INSTALL_POLL_MS)
          }
          try {
            select<Unit> {
              install.onAwait {}
              poll.onAwait {}
            }
          } finally {
            install.cancel()
            poll.cancel()
          }
        }
        true
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Throwable) {
      failure = e
      null
    }
    if (completed == true || modulesInstalled(apis)) {
      onProgress(1.0)
      return
    }
    val reason = failure?.message?.let { if (isContract(failure)) throw failure else it }
    fail(
      "DOWNLOAD_FAILED",
      reason ?: "Timed out downloading the on-device vision model. Check the network and Google Play services, then try again"
    )
  }

  private suspend fun awaitInstall(apis: List<OptionalModuleApi>, onProgress: (Double) -> Unit) =
    suspendCancellableCoroutine<Unit> { continuation ->
      val client = installClient
      val listener = object : InstallStatusListener {
        override fun onInstallStatusUpdated(update: ModuleInstallStatusUpdate) {
          update.progressInfo?.let { info ->
            if (info.totalBytesToDownload > 0) {
              val fraction = info.bytesDownloaded.toDouble() / info.totalBytesToDownload.toDouble()
              // Hold 1.0 for the terminal update so callers see a real "done".
              onProgress(fraction.coerceIn(0.0, 0.99))
            }
          }
          when (update.installState) {
            ModuleInstallStatusUpdate.InstallState.STATE_COMPLETED -> {
              client.unregisterListener(this)
              if (continuation.isActive) continuation.resume(Unit)
            }
            ModuleInstallStatusUpdate.InstallState.STATE_FAILED,
            ModuleInstallStatusUpdate.InstallState.STATE_CANCELED -> {
              client.unregisterListener(this)
              if (continuation.isActive) {
                continuation.resumeWithException(
                  RuntimeException(
                    "DOWNLOAD_FAILED:$MODEL_ID:Google Play services could not install the on-device vision model"
                  )
                )
              }
            }
            else -> Unit
          }
        }
      }
      val request = ModuleInstallRequest.newBuilder()
        .apply { apis.forEach { addApi(it) } }
        .setListener(listener)
        .build()
      continuation.invokeOnCancellation {
        try {
          client.unregisterListener(listener)
        } catch (_: Throwable) {}
      }
      client.installModules(request)
        .addOnSuccessListener { response ->
          if (response.areModulesAlreadyInstalled()) {
            client.unregisterListener(listener)
            if (continuation.isActive) continuation.resume(Unit)
          }
        }
        .addOnFailureListener { error ->
          client.unregisterListener(listener)
          if (continuation.isActive) {
            continuation.resumeWithException(
              RuntimeException("DOWNLOAD_FAILED:$MODEL_ID:${error.message ?: error}", error)
            )
          }
        }
    }

  // ==================================================================
  // Clients
  // ==================================================================

  private fun segmenterClient(): SubjectSegmenter =
    synchronized(segmenterLock) {
      segmenter ?: SubjectSegmentation.getClient(
        SubjectSegmenterOptions.Builder()
          .enableForegroundConfidenceMask()
          // Per-subject masks let the caller keep only the subject under a point.
          .enableMultipleSubjects(
            SubjectSegmenterOptions.SubjectResultOptions.Builder().enableConfidenceMask().build()
          )
          .build()
      ).also { segmenter = it }
    }

  private fun discardSegmenter(stale: SubjectSegmenter) {
    synchronized(segmenterLock) {
      if (segmenter === stale) segmenter = null
    }
    try {
      stale.close()
    } catch (_: Throwable) {}
  }

  private fun textClient(script: Script): TextRecognizer =
    synchronized(textClientsLock) {
      textClients[script] ?: when (script) {
        Script.LATIN -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        Script.CHINESE -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        Script.JAPANESE -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        Script.KOREAN -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        Script.DEVANAGARI -> TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
      }.also { textClients[script] = it }
    }

  /**
   * Map normalized BCP-47 tags to script models, preserving order. Empty →
   * Latin. The CJK and Devanagari models also read Latin text, so Latin is
   * dropped whenever another script is requested (no second pass).
   */
  private fun scriptsFor(languages: List<String>): List<Script> {
    if (languages.isEmpty()) return listOf(Script.LATIN)
    val scripts = LinkedHashSet<Script>()
    for (tag in languages) {
      val lower = tag.lowercase()
      val parts = lower.split('-')
      val primary = parts.firstOrNull().orEmpty()
      scripts.add(
        when {
          primary == "zh" || primary == "yue" || parts.contains("hans") || parts.contains("hant") -> Script.CHINESE
          primary == "ja" || parts.contains("jpan") -> Script.JAPANESE
          primary == "ko" || parts.contains("kore") -> Script.KOREAN
          primary == "hi" || primary == "mr" || primary == "ne" || primary == "sa" || parts.contains("deva") -> Script.DEVANAGARI
          else -> Script.LATIN
        }
      )
    }
    val nonLatin = scripts.filter { it != Script.LATIN }
    return if (nonLatin.isNotEmpty()) nonLatin else listOf(Script.LATIN)
  }

  // ==================================================================
  // Availability & preparation
  // ==================================================================

  override suspend fun availability(): Map<String, Any?> = withContext(Dispatchers.IO) {
    // The label model is bundled, no Play services module involved.
    val labeling = mapOf("status" to "available")
    if (!playServicesAvailable()) {
      val unavailable = mapOf("status" to "unavailable", "reason" to "device")
      return@withContext mapOf(
        "backgroundRemoval" to unavailable,
        "imageLabeling" to labeling,
        "textRecognition" to unavailable
      )
    }
    val segmentation = try {
      if (modulesInstalled(listOf(segmenterClient()))) "available" else "downloadable"
    } catch (_: Throwable) {
      "downloadable"
    }
    val text = try {
      if (modulesInstalled(listOf(textClient(Script.LATIN)))) "available" else "downloadable"
    } catch (_: Throwable) {
      "downloadable"
    }
    mapOf(
      "backgroundRemoval" to mapOf("status" to segmentation),
      "imageLabeling" to labeling,
      "textRecognition" to mapOf("status" to text)
    )
  }

  override suspend fun prepare(
    features: List<String>,
    languages: List<String>,
    onProgress: (Double) -> Unit
  ) = withContext(Dispatchers.IO) {
    val apis = ArrayList<OptionalModuleApi>()
    if ("background-removal" in features) {
      requirePlayServices("Background removal")
      apis.add(segmenterClient())
    }
    if ("text-recognition" in features) {
      requirePlayServices("Text recognition")
      scriptsFor(languages).forEach { apis.add(textClient(it)) }
    }
    // 'image-labeling' ships with the app: nothing to prepare.
    wrapping("DOWNLOAD_FAILED") { installModules(apis, onProgress) }
  }

  // ==================================================================
  // Image loading
  // ==================================================================

  private fun toUri(path: String): Uri =
    if (path.startsWith("file://") || path.startsWith("content://")) Uri.parse(path)
    else Uri.fromFile(File(path))

  /**
   * Decode [path] as an immutable software ARGB_8888 bitmap, upright (EXIF
   * baked in) and downscaled so width × height stays within [maxPixels].
   */
  private fun loadBitmap(path: String, maxPixels: Int): Bitmap {
    val uri = toUri(path)
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val source = ImageDecoder.createSource(context.contentResolver, uri)
        val decoded = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
          val total = info.size.width.toLong() * info.size.height.toLong()
          if (total > maxPixels) {
            val scale = sqrt(total.toDouble() / maxPixels.toDouble())
            decoder.setTargetSize(
              (info.size.width / scale).toInt().coerceAtLeast(1),
              (info.size.height / scale).toInt().coerceAtLeast(1)
            )
          }
          decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        toImmutableArgb(decoded)
      } else {
        decodeLegacy(uri, maxPixels)
      }
    } catch (e: RuntimeException) {
      if (isContract(e)) throw e
      fail("IMAGE_DECODE_FAILED", "Could not decode the image at $path: ${e.message}")
    } catch (e: Throwable) {
      fail("IMAGE_DECODE_FAILED", "Could not decode the image at $path: ${e.message}")
    }
  }

  private fun toImmutableArgb(bitmap: Bitmap): Bitmap {
    if (!bitmap.isMutable && bitmap.config == Bitmap.Config.ARGB_8888) return bitmap
    val copy = bitmap.copy(Bitmap.Config.ARGB_8888, false)
      ?: fail("IMAGE_DECODE_FAILED", "Could not copy the decoded image")
    if (copy !== bitmap) bitmap.recycle()
    return copy
  }

  private fun decodeLegacy(uri: Uri, maxPixels: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sampleSize = 1
    if (bounds.outWidth > 0 && bounds.outHeight > 0) {
      var total = bounds.outWidth.toLong() * bounds.outHeight.toLong()
      while (total / (sampleSize.toLong() * sampleSize) > maxPixels) sampleSize *= 2
    }
    val options = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inSampleSize = sampleSize
    }
    val decoded = context.contentResolver.openInputStream(uri)?.use {
      BitmapFactory.decodeStream(it, null, options)
    } ?: fail("IMAGE_DECODE_FAILED", "Could not decode the image at $uri")
    // BitmapFactory ignores EXIF orientation (ImageDecoder on API 28+ bakes it in).
    val orientation = try {
      context.contentResolver.openInputStream(uri)?.use { stream ->
        ExifInterface(stream).getAttributeInt(
          ExifInterface.TAG_ORIENTATION,
          ExifInterface.ORIENTATION_NORMAL
        )
      } ?: ExifInterface.ORIENTATION_NORMAL
    } catch (_: Throwable) {
      ExifInterface.ORIENTATION_NORMAL
    }
    return toImmutableArgb(applyExifOrientation(decoded, orientation))
  }

  private fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.preRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.preRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.preRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.preRotate(90f)
        matrix.preScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.preRotate(270f)
        matrix.preScale(-1f, 1f)
      }
      else -> return bitmap
    }
    val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (oriented !== bitmap) bitmap.recycle()
    return oriented
  }

  /** Downscale to [maxEdge] and make sure the result is an immutable ARGB_8888 software bitmap. */
  private fun mlKitInput(bitmap: Bitmap, maxEdge: Int): Bitmap {
    val longest = maxOf(bitmap.width, bitmap.height)
    val scaled = if (longest > maxEdge) {
      val scale = maxEdge.toFloat() / longest.toFloat()
      Bitmap.createScaledBitmap(
        bitmap,
        (bitmap.width * scale).toInt().coerceAtLeast(1),
        (bitmap.height * scale).toInt().coerceAtLeast(1),
        true
      )
    } else {
      bitmap
    }
    val needsCopy = scaled.isMutable || scaled.config != Bitmap.Config.ARGB_8888 ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && scaled.config == Bitmap.Config.HARDWARE)
    if (!needsCopy) return scaled
    val copy = scaled.copy(Bitmap.Config.ARGB_8888, false)
      ?: fail("IMAGE_DECODE_FAILED", "Could not prepare the image for ML Kit")
    if (scaled !== bitmap) scaled.recycle()
    return copy
  }

  private fun outputFile(extension: String): File {
    val directory = File(context.cacheDir, "expo-ai-kit/vision")
    directory.mkdirs()
    return File(directory, "${UUID.randomUUID()}.$extension")
  }

  // ==================================================================
  // Background removal (subject cutout)
  // ==================================================================

  override suspend fun removeBackground(
    uri: String,
    trim: Boolean,
    format: String,
    quality: Double,
    maxPixels: Int,
    subjectX: Double,
    subjectY: Double,
    includeMask: Boolean
  ): Map<String, Any?> = withContext(Dispatchers.Default) {
    requirePlayServices("Background removal")
    val client = segmenterClient()
    requireModules("subject segmentation", listOf(client))

    val source = loadBitmap(uri, maxPixels)
    try {
      val input = mlKitInput(source, SEGMENT_MAX_EDGE)
      val ownsInput = input !== source
      val result = try {
        wrapping("VISION_FAILED") { client.process(InputImage.fromBitmap(input, 0)).await() }
      } catch (e: Throwable) {
        // A client built before the module finished installing keeps a failed
        // init for the life of the process; drop it so the next call rebuilds.
        if (e !is CancellationException) discardSegmenter(client)
        throw e
      } finally {
        if (ownsInput) input.recycle()
      }
      val maskWidth = input.width
      val maskHeight = input.height
      val subjects = result.subjects
      val mask: FloatArray
      if (subjectX >= 0 && subjectY >= 0) {
        // Keep only the subject whose mask is most confident under the point.
        val px = (subjectX * maskWidth).toInt().coerceIn(0, maskWidth - 1)
        val py = (subjectY * maskHeight).toInt().coerceIn(0, maskHeight - 1)
        var best: com.google.mlkit.vision.segmentation.subject.Subject? = null
        var bestConfidence = FOREGROUND_THRESHOLD
        for (subject in subjects) {
          val buffer = subject.confidenceMask ?: continue
          val localX = px - subject.startX
          val localY = py - subject.startY
          if (localX < 0 || localY < 0 || localX >= subject.width || localY >= subject.height) continue
          val confidence = buffer.get(localY * subject.width + localX)
          if (confidence > bestConfidence) {
            bestConfidence = confidence
            best = subject
          }
        }
        val chosen = best ?: fail("NO_SUBJECT_FOUND", "No subject under the selected point")
        mask = FloatArray(maskWidth * maskHeight)
        val buffer = chosen.confidenceMask!!
        buffer.rewind()
        for (y in 0 until chosen.height) {
          val targetY = chosen.startY + y
          if (targetY < 0 || targetY >= maskHeight) continue
          for (x in 0 until chosen.width) {
            val targetX = chosen.startX + x
            if (targetX < 0 || targetX >= maskWidth) continue
            mask[targetY * maskWidth + targetX] = buffer.get(y * chosen.width + x)
          }
        }
      } else {
        val rawMask = result.foregroundConfidenceMask
          ?: fail("NO_SUBJECT_FOUND", "No foreground subject detected in the image")
        mask = FloatArray(maskWidth * maskHeight)
        rawMask.rewind()
        rawMask.get(mask)
      }

      val width = source.width
      val height = source.height
      val colors = IntArray(width * height)
      source.getPixels(colors, 0, width, 0, 0, width, height)

      // Apply the (nearest-neighbour upscaled) confidence mask as alpha and
      // measure the foreground in the same pass. Keep the upscaled mask when the
      // caller wants it written out.
      val fullMask = if (includeMask) FloatArray(width * height) else null
      var foreground = 0
      var sumX = 0.0
      var sumY = 0.0
      var minX = width
      var minY = height
      var maxX = -1
      var maxY = -1
      for (y in 0 until height) {
        val my = minOf(maskHeight - 1, y * maskHeight / height)
        for (x in 0 until width) {
          val mx = minOf(maskWidth - 1, x * maskWidth / width)
          val confidence = mask[my * maskWidth + mx].coerceIn(0f, 1f)
          val i = y * width + x
          colors[i] = ((confidence * 255f).toInt() shl 24) or (colors[i] and 0x00FFFFFF)
          fullMask?.set(i, confidence)
          if (confidence > FOREGROUND_THRESHOLD) {
            foreground++
            sumX += x
            sumY += y
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
          }
        }
      }
      if (foreground == 0 || maxX < 0) {
        fail("NO_SUBJECT_FOUND", "No foreground subject detected in the image")
      }
      val boundsX = minX
      val boundsY = minY
      val boundsW = maxX - minX + 1
      val boundsH = maxY - minY + 1

      var cropX = 0
      var cropY = 0
      var cropW = width
      var cropH = height
      if (trim) {
        val pad = 2
        cropX = (boundsX - pad).coerceAtLeast(0)
        cropY = (boundsY - pad).coerceAtLeast(0)
        val right = (boundsX + boundsW - 1 + pad).coerceAtMost(width - 1)
        val bottom = (boundsY + boundsH - 1 + pad).coerceAtMost(height - 1)
        cropW = right - cropX + 1
        cropH = bottom - cropY + 1
      }
      val cutout = if (cropX == 0 && cropY == 0 && cropW == width && cropH == height) {
        Bitmap.createBitmap(colors, width, height, Bitmap.Config.ARGB_8888)
      } else {
        Bitmap.createBitmap(colors, cropY * width + cropX, width, cropW, cropH, Bitmap.Config.ARGB_8888)
      }
      try {
        val jpeg = format == "jpeg"
        val file = outputFile(if (jpeg) "jpg" else "png")
        wrapping("VISION_FAILED") {
          if (jpeg) {
            // JPEG has no alpha: flatten onto white, like iOS.
            val flat = Bitmap.createBitmap(cropW, cropH, Bitmap.Config.ARGB_8888)
            try {
              val canvas = Canvas(flat)
              canvas.drawColor(Color.WHITE)
              canvas.drawBitmap(cutout, 0f, 0f, null)
              FileOutputStream(file).use { out ->
                flat.compress(Bitmap.CompressFormat.JPEG, (quality.coerceIn(0.0, 1.0) * 100).toInt(), out)
              }
            } finally {
              flat.recycle()
            }
          } else {
            FileOutputStream(file).use { out -> cutout.compress(Bitmap.CompressFormat.PNG, 100, out) }
          }
        }
        val maskUri = fullMask?.let { writeMask(it, width, cropX, cropY, cropW, cropH) }
        val w = width.toDouble()
        val h = height.toDouble()
        buildMap<String, Any?> {
          put("uri", Uri.fromFile(file).toString())
          if (maskUri != null) put("maskUri", maskUri)
          putAll(mapOf(
          "width" to cropW,
          "height" to cropH,
          "sourceWidth" to width,
          "sourceHeight" to height,
          "bounds" to mapOf(
            "x" to boundsX / w,
            "y" to boundsY / h,
            "width" to boundsW / w,
            "height" to boundsH / h
          ),
          "pixelBounds" to mapOf("x" to boundsX, "y" to boundsY, "width" to boundsW, "height" to boundsH),
          "foregroundCoverage" to foreground.toDouble() / (w * h),
          "centroid" to mapOf("x" to (sumX / foreground + 0.5) / w, "y" to (sumY / foreground + 0.5) / h),
          "instanceCount" to if (subjects.isNotEmpty()) subjects.size else 1,
          "trimOrigin" to mapOf("x" to cropX / w, "y" to cropY / h)
          ))
        }
      } finally {
        cutout.recycle()
      }
    } finally {
      source.recycle()
    }
  }

  /** Write the confidence mask for the crop rect as an 8-bit grayscale PNG (white = subject). */
  private fun writeMask(mask: FloatArray, stride: Int, cropX: Int, cropY: Int, cropW: Int, cropH: Int): String {
    val pixels = IntArray(cropW * cropH)
    for (y in 0 until cropH) {
      for (x in 0 until cropW) {
        val v = (mask[(cropY + y) * stride + cropX + x].coerceIn(0f, 1f) * 255f).toInt()
        pixels[y * cropW + x] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
      }
    }
    val bitmap = Bitmap.createBitmap(pixels, cropW, cropH, Bitmap.Config.ARGB_8888)
    try {
      val file = outputFile("png")
      wrapping("VISION_FAILED") {
        FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
      }
      return Uri.fromFile(file).toString()
    } finally {
      bitmap.recycle()
    }
  }

  // ==================================================================
  // Image labels
  // ==================================================================

  override suspend fun labelImage(
    uri: String,
    maxResults: Int,
    minConfidence: Double
  ): List<Map<String, Any?>> = withContext(Dispatchers.Default) {
    val source = loadBitmap(uri, LABELING_MAX_PIXELS)
    try {
      val input = mlKitInput(source, SEGMENT_MAX_EDGE)
      val labeler = ImageLabeling.getClient(
        ImageLabelerOptions.Builder()
          .setConfidenceThreshold(minConfidence.toFloat().coerceIn(0f, 1f))
          .build()
      )
      try {
        val labels = wrapping("VISION_FAILED") { labeler.process(InputImage.fromBitmap(input, 0)).await() }
        val sorted = labels.sortedByDescending { it.confidence }
        val limited = if (maxResults > 0) sorted.take(maxResults) else sorted
        limited.map { mapOf("label" to it.text, "confidence" to it.confidence.toDouble()) }
      } finally {
        try {
          labeler.close()
        } catch (_: Throwable) {}
        if (input !== source) input.recycle()
      }
    } finally {
      source.recycle()
    }
  }

  // ==================================================================
  // Text recognition (OCR)
  // ==================================================================

  override suspend fun recognizeText(
    uri: String,
    languages: List<String>,
    minTextHeight: Double
  ): Map<String, Any?> = withContext(Dispatchers.Default) {
    requirePlayServices("Text recognition")
    val scripts = scriptsFor(languages)
    val clients = scripts.map { textClient(it) }
    requireModules("text recognition", clients)

    val source = loadBitmap(uri, TEXT_MAX_PIXELS)
    try {
      val input = mlKitInput(source, TEXT_MAX_EDGE)
      try {
        val image = InputImage.fromBitmap(input, 0)
        val outputs = wrapping("VISION_FAILED") {
          coroutineScope {
            clients.map { client ->
              async { mapText(client.process(image).await(), input.width, input.height, minTextHeight) }
            }.awaitAll()
          }
        }
        merge(outputs)
      } finally {
        if (input !== source) input.recycle()
      }
    } finally {
      source.recycle()
    }
  }

  private class Block(
    val text: String,
    val bounds: Map<String, Double>,
    val lines: List<Map<String, Any?>>,
    val language: String?,
    val cornerPoints: List<Map<String, Double>>?
  ) {
    fun toMap(): Map<String, Any?> = buildMap {
      put("text", text)
      put("bounds", bounds)
      put("lines", lines)
      if (language != null) put("language", language)
      if (cornerPoints != null) put("cornerPoints", cornerPoints)
    }
  }

  private fun mapText(visionText: Text, width: Int, height: Int, minTextHeight: Double): List<Block> {
    val blocks = ArrayList<Block>()
    for (block in visionText.textBlocks) {
      val lines = ArrayList<Map<String, Any?>>()
      for (line in block.lines) {
        val bounds = normalizeRect(line.boundingBox, width, height) ?: continue
        if (minTextHeight > 0 && (bounds["height"] ?: 0.0) < minTextHeight) continue
        lines.add(
          buildMap {
            put("text", line.text)
            put("bounds", bounds)
            val confidence = line.confidence
            if (confidence > 0f) put("confidence", confidence.toDouble())
            language(line.recognizedLanguage)?.let { put("language", it) }
            normalizeCorners(line.cornerPoints, width, height)?.let { put("cornerPoints", it) }
          }
        )
      }
      if (lines.isEmpty()) continue
      val blockBounds = normalizeRect(block.boundingBox, width, height)
        ?: unionBounds(lines.map { @Suppress("UNCHECKED_CAST") (it["bounds"] as Map<String, Double>) })
      blocks.add(
        Block(
          text = block.text,
          bounds = blockBounds,
          lines = lines,
          language = language(block.recognizedLanguage),
          cornerPoints = normalizeCorners(block.cornerPoints, width, height)
        )
      )
    }
    return blocks
  }

  /** Merge multi-script passes: drop near-duplicates (IoU ≥ 0.5, same text), sort in reading order. */
  private fun merge(outputs: List<List<Block>>): Map<String, Any?> {
    val merged = ArrayList<Block>()
    for (output in outputs) {
      for (block in output) {
        val duplicate = merged.any { existing ->
          iou(existing.bounds, block.bounds) >= 0.5 &&
            existing.text.filterNot { it.isWhitespace() } == block.text.filterNot { it.isWhitespace() }
        }
        if (!duplicate) merged.add(block)
      }
    }
    if (outputs.size > 1) {
      merged.sortWith(compareBy({ it.bounds["y"] ?: 0.0 }, { it.bounds["x"] ?: 0.0 }))
    }
    return mapOf(
      "text" to merged.joinToString("\n") { it.text },
      "blocks" to merged.map { it.toMap() }
    )
  }

  private fun language(tag: String?): String? =
    if (tag.isNullOrEmpty() || tag == "und") null else tag

  private fun normalizeRect(box: Rect?, width: Int, height: Int): Map<String, Double>? {
    if (box == null || width <= 0 || height <= 0) return null
    return mapOf(
      "x" to (box.left.toDouble() / width).coerceIn(0.0, 1.0),
      "y" to (box.top.toDouble() / height).coerceIn(0.0, 1.0),
      "width" to (box.width().toDouble() / width).coerceIn(0.0, 1.0),
      "height" to (box.height().toDouble() / height).coerceIn(0.0, 1.0)
    )
  }

  private fun normalizeCorners(points: Array<Point>?, width: Int, height: Int): List<Map<String, Double>>? {
    if (points == null || points.isEmpty() || width <= 0 || height <= 0) return null
    return points.map {
      mapOf(
        "x" to (it.x.toDouble() / width).coerceIn(0.0, 1.0),
        "y" to (it.y.toDouble() / height).coerceIn(0.0, 1.0)
      )
    }
  }

  private fun unionBounds(rects: List<Map<String, Double>>): Map<String, Double> {
    var minX = Double.POSITIVE_INFINITY
    var minY = Double.POSITIVE_INFINITY
    var maxX = Double.NEGATIVE_INFINITY
    var maxY = Double.NEGATIVE_INFINITY
    for (r in rects) {
      val x = r["x"] ?: 0.0
      val y = r["y"] ?: 0.0
      minX = minOf(minX, x)
      minY = minOf(minY, y)
      maxX = maxOf(maxX, x + (r["width"] ?: 0.0))
      maxY = maxOf(maxY, y + (r["height"] ?: 0.0))
    }
    if (rects.isEmpty()) return mapOf("x" to 0.0, "y" to 0.0, "width" to 0.0, "height" to 0.0)
    return mapOf("x" to minX, "y" to minY, "width" to (maxX - minX).coerceAtLeast(0.0), "height" to (maxY - minY).coerceAtLeast(0.0))
  }

  private fun iou(a: Map<String, Double>, b: Map<String, Double>): Double {
    val ax = a["x"] ?: 0.0
    val ay = a["y"] ?: 0.0
    val aw = a["width"] ?: 0.0
    val ah = a["height"] ?: 0.0
    val bx = b["x"] ?: 0.0
    val by = b["y"] ?: 0.0
    val bw = b["width"] ?: 0.0
    val bh = b["height"] ?: 0.0
    val iw = (minOf(ax + aw, bx + bw) - maxOf(ax, bx)).coerceAtLeast(0.0)
    val ih = (minOf(ay + ah, by + bh) - maxOf(ay, by)).coerceAtLeast(0.0)
    val intersection = iw * ih
    if (intersection <= 0.0) return 0.0
    val union = aw * ah + bw * bh - intersection
    return if (union > 0.0) intersection / union else 0.0
  }

  // ==================================================================
  // Play services Task → coroutine
  // ==================================================================

  private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { value ->
      @Suppress("UNCHECKED_CAST")
      if (continuation.isActive) continuation.resume(value as T)
    }
    addOnFailureListener { error ->
      if (continuation.isActive) continuation.resumeWithException(error)
    }
    addOnCanceledListener {
      if (continuation.isActive) continuation.cancel()
    }
  }
}
