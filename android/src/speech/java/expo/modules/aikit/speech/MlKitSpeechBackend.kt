package expo.modules.aikit.speech

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Base64
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.audio.AudioSource
import com.google.mlkit.genai.speechrecognition.SpeechRecognition
import com.google.mlkit.genai.speechrecognition.SpeechRecognizer
import com.google.mlkit.genai.speechrecognition.SpeechRecognizerOptions
import com.google.mlkit.genai.speechrecognition.SpeechRecognizerResponse
import com.google.mlkit.genai.speechrecognition.speechRecognizerOptions
import com.google.mlkit.genai.speechrecognition.speechRecognizerRequest
import expo.modules.aikit.SpeechBackend
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * ML Kit GenAI Speech Recognition backend (genai-speech-recognition
 * 1.0.0-alpha1). Verified behavior on-device (Galaxy A16, 2026-08-06):
 * - RECORD_AUDIO is required even for file/PFD input (undocumented).
 * - Non-mic audio must be a PIPE fed at real-time rate (~32 KB/s of 16 kHz
 *   mono PCM16); seekable descriptors and full-speed feeds fail with
 *   ERROR_TYPE_INVALID_REQUEST.
 * - Responses are text-only; long audio emits multiple FinalTextResponses.
 */
class MlKitSpeechBackend(private val context: Context) : SpeechBackend {

  companion object {
    const val MODEL_ID = "mlkit-speech"
    private const val TARGET_SAMPLE_RATE = 16_000
    private const val BYTES_PER_SECOND = TARGET_SAMPLE_RATE * 2 // mono PCM16
    private const val FEED_CHUNK_MS = 100L
  }

  // SupervisorJob so a failed live session can never take the scope (or, via
  // an unhandled coroutine exception, the process) down with it.
  private val liveScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var liveRecognizer: SpeechRecognizer? = null
  private var liveJob: Job? = null

  private fun fail(code: String, reason: String): Nothing =
    throw RuntimeException("$code:$MODEL_ID:$reason")

  private inline fun safely(block: () -> Unit) {
    try {
      block()
    } catch (_: Throwable) {}
  }

  private fun requireApiLevel() {
    if (Build.VERSION.SDK_INT < 31) {
      fail("DEVICE_NOT_SUPPORTED", "ML Kit speech recognition requires Android 12 (API 31) or later")
    }
  }

  private fun requireRecordAudioPermission() {
    val granted =
      context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
    if (!granted) {
      fail(
        "MIC_PERMISSION_DENIED",
        "Microphone permission is required — the ML Kit speech engine checks RECORD_AUDIO " +
          "even for file input. Call requestSpeechPermissionsAsync() first"
      )
    }
  }

  private fun newRecognizer(locale: Locale, mode: Int): SpeechRecognizer =
    SpeechRecognition.getClient(
      speechRecognizerOptions {
        this.locale = locale
        preferredMode = mode
        executor = Executors.newSingleThreadExecutor()
      }
    )

  private fun resolveLocale(locale: String): Locale =
    if (locale.isEmpty()) Locale.getDefault() else Locale.forLanguageTag(locale)

  /** Prefer Advanced (Gemini Nano) when immediately available, else Basic. */
  private suspend fun detectMode(locale: Locale): Pair<Int, Int> {
    try {
      val advanced = newRecognizer(locale, SpeechRecognizerOptions.Mode.MODE_ADVANCED)
      val status = try {
        advanced.checkStatus()
      } finally {
        try {
          advanced.close()
        } catch (_: Throwable) {}
      }
      if (status == FeatureStatus.AVAILABLE) {
        return SpeechRecognizerOptions.Mode.MODE_ADVANCED to status
      }
    } catch (_: Throwable) {
      // Advanced probing must never take Basic down with it.
    }
    val basic = newRecognizer(locale, SpeechRecognizerOptions.Mode.MODE_BASIC)
    val status = try {
      basic.checkStatus()
    } finally {
      try {
        basic.close()
      } catch (_: Throwable) {}
    }
    return SpeechRecognizerOptions.Mode.MODE_BASIC to status
  }

  private fun requireReady(status: Int) {
    when (status) {
      FeatureStatus.AVAILABLE -> return
      FeatureStatus.DOWNLOADABLE, FeatureStatus.DOWNLOADING -> fail(
        "MODEL_NOT_DOWNLOADED",
        "The speech model is not ready. Call prepareSpeechRecognition() first"
      )
      else -> fail(
        "DEVICE_NOT_SUPPORTED",
        "ML Kit speech recognition is not supported on this device"
      )
    }
  }

  // ==================================================================
  // Availability & preparation
  // ==================================================================

  override suspend fun availability(locale: String): Map<String, Any?> {
    if (Build.VERSION.SDK_INT < 31) {
      return mapOf("status" to "unavailable", "reason" to "os-version")
    }
    return try {
      val (mode, status) = detectMode(resolveLocale(locale))
      val modeName =
        if (mode == SpeechRecognizerOptions.Mode.MODE_ADVANCED) "advanced" else "basic"
      when (status) {
        FeatureStatus.AVAILABLE -> mapOf("status" to "available", "mode" to modeName)
        FeatureStatus.DOWNLOADABLE -> mapOf("status" to "downloadable", "mode" to modeName)
        FeatureStatus.DOWNLOADING -> mapOf("status" to "downloading", "mode" to modeName)
        else -> mapOf("status" to "unavailable", "reason" to "device")
      }
    } catch (_: Throwable) {
      mapOf("status" to "unavailable", "reason" to "device")
    }
  }

  override suspend fun prepare(locale: String, onProgress: (Double) -> Unit) {
    requireApiLevel()
    val recognizer = newRecognizer(resolveLocale(locale), SpeechRecognizerOptions.Mode.MODE_BASIC)
    try {
      when (recognizer.checkStatus()) {
        FeatureStatus.AVAILABLE -> {
          onProgress(1.0)
          return
        }
        FeatureStatus.DOWNLOADABLE, FeatureStatus.DOWNLOADING -> {
          onProgress(0.0)
          try {
            recognizer.download().collect { status ->
              if (status is DownloadStatus.DownloadFailed) {
                fail("DOWNLOAD_FAILED", "Speech model download failed: ${status.e.message}")
              }
            }
          } catch (e: CancellationException) {
            throw e
          } catch (e: RuntimeException) {
            if (e.message?.startsWith("DOWNLOAD_FAILED:") == true) throw e
            fail("DOWNLOAD_FAILED", "Speech model download failed: ${e.message}")
          } catch (e: Throwable) {
            fail("DOWNLOAD_FAILED", "Speech model download failed: ${e.message}")
          }
          requireReady(recognizer.checkStatus())
          onProgress(1.0)
        }
        else -> fail(
          "DEVICE_NOT_SUPPORTED",
          "ML Kit speech recognition is not supported on this device"
        )
      }
    } finally {
      try {
        recognizer.close()
      } catch (_: Throwable) {}
    }
  }

  // ==================================================================
  // Batch file transcription
  // ==================================================================

  override suspend fun transcribeFile(
    path: String?,
    base64: String?,
    locale: String
  ): Map<String, Any?> = withContext(Dispatchers.IO) {
    requireApiLevel()
    requireRecordAudioPermission()

    val bytes = when {
      !path.isNullOrEmpty() -> try {
        File(path).readBytes()
      } catch (e: Throwable) {
        fail("AUDIO_DECODE_FAILED", "Could not read audio file: ${e.message}")
      }
      !base64.isNullOrEmpty() -> try {
        Base64.decode(base64, Base64.DEFAULT)
      } catch (e: Throwable) {
        fail("AUDIO_DECODE_FAILED", "Invalid base64 audio payload")
      }
      else -> fail("AUDIO_DECODE_FAILED", "No audio input provided")
    }

    val pcm = decodeToPcm16Mono16k(bytes)
    val durationSeconds = pcm.size.toDouble() / BYTES_PER_SECOND
    val resolvedLocale = resolveLocale(locale)
    val (mode, status) = detectMode(resolvedLocale)
    requireReady(status)

    val recognizer = newRecognizer(resolvedLocale, mode)
    try {
      val pipe = ParcelFileDescriptor.createPipe()
      val feeder = launch {
        try {
          ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { out ->
            // The engine's documented contract: real-time rate (~32 KB/s of
            // 16 kHz mono PCM16). Full-speed feeds fail ERROR_TYPE_INVALID_REQUEST.
            val chunk = (BYTES_PER_SECOND * FEED_CHUNK_MS / 1000L).toInt()
            var offset = 0
            while (offset < pcm.size) {
              val n = minOf(chunk, pcm.size - offset)
              out.write(pcm, offset, n)
              offset += n
              delay(FEED_CHUNK_MS)
            }
          }
        } catch (_: Throwable) {
          // Collector-side failures close the pipe; the collect loop reports them.
        }
      }

      val finals = StringBuilder()
      val timeoutMs = (durationSeconds * 1000).toLong() + 30_000
      val completed = try {
        withTimeoutOrNull(timeoutMs) {
          recognizer
            .startRecognition(speechRecognizerRequest { audioSource = AudioSource.fromPfd(pipe[0]) })
            .collect { response ->
              when (response) {
                is SpeechRecognizerResponse.FinalTextResponse -> {
                  finals.append(response.text).append(' ')
                }
                is SpeechRecognizerResponse.ErrorResponse ->
                  fail("TRANSCRIPTION_FAILED", response.e.message ?: response.e.toString())
                is SpeechRecognizerResponse.CompletedResponse -> recognizer.stopRecognition()
                else -> {}
              }
            }
          true
        }
      } finally {
        // Unblock a feeder stuck on a full pipe (writes fail with EPIPE once
        // the read end closes) and avoid leaking descriptors on error paths.
        try {
          pipe[0].close()
        } catch (_: Throwable) {}
        feeder.cancel()
      }
      if (completed == null) {
        try {
          recognizer.stopRecognition()
        } catch (_: Throwable) {}
        fail("TRANSCRIPTION_FAILED", "Transcription timed out")
      }

      mapOf(
        "text" to finals.toString().replace(Regex("\\s+"), " ").trim(),
        // The engine is text-only: no timestamps/confidence. iOS provides real
        // segments; here the AI SDK layer reports a warning instead.
        "segments" to emptyList<Map<String, Any>>(),
        "language" to resolvedLocale.toLanguageTag(),
        "durationSeconds" to durationSeconds
      )
    } finally {
      try {
        recognizer.close()
      } catch (_: Throwable) {}
    }
  }

  // ==================================================================
  // Live microphone transcription
  // ==================================================================

  override suspend fun startLive(
    locale: String,
    onUpdate: (String, Boolean) -> Unit,
    onError: (String) -> Unit,
    onEnd: () -> Unit
  ) {
    requireApiLevel()
    requireRecordAudioPermission()
    val resolvedLocale = resolveLocale(locale)
    val (mode, status) = detectMode(resolvedLocale)
    requireReady(status)

    val recognizer = newRecognizer(resolvedLocale, mode)
    liveRecognizer = recognizer
    liveJob = liveScope.launch {
      try {
        recognizer
          .startRecognition(speechRecognizerRequest { audioSource = AudioSource.fromMic() })
          .collect { response ->
            when (response) {
              is SpeechRecognizerResponse.PartialTextResponse -> onUpdate(response.text, false)
              is SpeechRecognizerResponse.FinalTextResponse -> onUpdate(response.text, true)
              is SpeechRecognizerResponse.ErrorResponse ->
                onError("TRANSCRIPTION_FAILED:$MODEL_ID:${response.e.message ?: response.e}")
              is SpeechRecognizerResponse.CompletedResponse -> {}
              else -> {}
            }
          }
        safely { onEnd() }
      } catch (e: CancellationException) {
        safely { onEnd() }
        throw e
      } catch (e: Throwable) {
        val message = e.message ?: e.toString()
        // A throw from the callback itself (e.g. the event emitter) must not
        // escape this coroutine — that would be an app-level crash.
        safely {
          if (Regex("^[A-Z][A-Z_]*:").containsMatchIn(message)) {
            onError(message)
          } else {
            onError("TRANSCRIPTION_FAILED:$MODEL_ID:$message")
          }
        }
      } finally {
        try {
          recognizer.close()
        } catch (_: Throwable) {}
        if (liveRecognizer === recognizer) liveRecognizer = null
      }
    }
  }

  override suspend fun stopLive() {
    val recognizer = liveRecognizer ?: return
    try {
      recognizer.stopRecognition()
    } catch (_: Throwable) {
      // The collect loop ends (or the job dies) either way; onEnd handles JS.
      liveJob?.cancel()
    }
  }

  // ==================================================================
  // Audio decode: anything -> 16 kHz mono PCM16 bytes
  // ==================================================================

  private fun decodeToPcm16Mono16k(bytes: ByteArray): ByteArray {
    // WAV fast path: RIFF/WAVE with a PCM16 fmt chunk needs no MediaCodec.
    if (bytes.size > 44 && bytes.copyOfRange(0, 4).contentEquals("RIFF".toByteArray()) &&
      bytes.copyOfRange(8, 12).contentEquals("WAVE".toByteArray())
    ) {
      decodeWavPcm16(bytes)?.let { (samples, sampleRate, channels) ->
        return toPcmBytes(resampleLinear(downmixToMono(samples, channels), sampleRate))
      }
      // Non-PCM16 WAV (float, ADPCM, …) falls through to MediaCodec.
    }
    return decodeWithMediaCodec(bytes)
  }

  /** Parse a PCM16 WAV: returns (interleaved samples, sampleRate, channels) or null. */
  private fun decodeWavPcm16(bytes: ByteArray): Triple<ShortArray, Int, Int>? {
    var offset = 12
    var sampleRate = 0
    var channels = 0
    var bitsPerSample = 0
    var audioFormat = 0
    while (offset + 8 <= bytes.size) {
      val id = String(bytes, offset, 4, Charsets.US_ASCII)
      val size = ByteBuffer.wrap(bytes, offset + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
      val body = offset + 8
      when (id) {
        "fmt " -> {
          if (body + 16 > bytes.size) return null
          val fmt = ByteBuffer.wrap(bytes, body, 16).order(ByteOrder.LITTLE_ENDIAN)
          audioFormat = fmt.short.toInt()
          channels = fmt.short.toInt()
          sampleRate = fmt.int
          fmt.int // byte rate
          fmt.short // block align
          bitsPerSample = fmt.short.toInt()
        }
        "data" -> {
          if (audioFormat != 1 || bitsPerSample != 16 || channels < 1 || sampleRate <= 0) {
            return null
          }
          val end = minOf(body + size, bytes.size)
          val sampleCount = (end - body) / 2
          val samples = ShortArray(sampleCount)
          ByteBuffer.wrap(bytes, body, sampleCount * 2)
            .order(ByteOrder.LITTLE_ENDIAN)
            .asShortBuffer()
            .get(samples)
          return Triple(samples, sampleRate, channels)
        }
      }
      offset = body + size + (size % 2)
    }
    return null
  }

  /** Decode any container/codec Android supports (M4A/AAC, MP3, OGG, FLAC, …). */
  private fun decodeWithMediaCodec(bytes: ByteArray): ByteArray {
    val temp = File.createTempFile("expo-ai-kit-audio", ".bin", context.cacheDir)
    try {
      temp.writeBytes(bytes)
      val extractor = MediaExtractor()
      try {
        extractor.setDataSource(temp.absolutePath)
        var trackIndex = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
          val f = extractor.getTrackFormat(i)
          if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
            trackIndex = i
            format = f
            break
          }
        }
        if (trackIndex < 0 || format == null) {
          fail("AUDIO_DECODE_FAILED", "No audio track found in the provided data")
        }
        extractor.selectTrack(trackIndex)
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        val codec = MediaCodec.createDecoderByType(mime)
        try {
          codec.configure(format, null, null, 0)
          codec.start()
          val samples = ArrayList<ShortArray>()
          var outputRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          var outputChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          val info = MediaCodec.BufferInfo()
          var inputDone = false
          var outputDone = false
          // A decoder that never signals end-of-stream must not hang the call
          // (the loop has no suspension point, so cancellation can't reach it).
          val decodeDeadline = System.currentTimeMillis() + 120_000
          while (!outputDone) {
            if (System.currentTimeMillis() > decodeDeadline) {
              fail("AUDIO_DECODE_FAILED", "Audio decoding timed out")
            }
            if (!inputDone) {
              val inIndex = codec.dequeueInputBuffer(10_000)
              if (inIndex >= 0) {
                val buffer = codec.getInputBuffer(inIndex)!!
                val sampleSize = extractor.readSampleData(buffer, 0)
                if (sampleSize < 0) {
                  codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                  inputDone = true
                } else {
                  codec.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                  extractor.advance()
                }
              }
            }
            val outIndex = codec.dequeueOutputBuffer(info, 10_000)
            when {
              outIndex >= 0 -> {
                if (info.size > 0) {
                  val buffer = codec.getOutputBuffer(outIndex)!!
                  buffer.position(info.offset)
                  buffer.limit(info.offset + info.size)
                  val chunk = ShortArray(info.size / 2)
                  buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(chunk)
                  samples.add(chunk)
                }
                codec.releaseOutputBuffer(outIndex, false)
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
              }
              outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                val out = codec.outputFormat
                outputRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                outputChannels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              }
            }
          }
          val total = samples.sumOf { it.size }
          if (total == 0) fail("AUDIO_DECODE_FAILED", "Decoder produced no audio samples")
          val all = ShortArray(total)
          var pos = 0
          for (chunk in samples) {
            chunk.copyInto(all, pos)
            pos += chunk.size
          }
          return toPcmBytes(resampleLinear(downmixToMono(all, outputChannels), outputRate))
        } finally {
          try {
            codec.stop()
          } catch (_: Throwable) {}
          codec.release()
        }
      } finally {
        extractor.release()
      }
    } catch (e: RuntimeException) {
      if (e.message?.startsWith("AUDIO_DECODE_FAILED:") == true) throw e
      fail("AUDIO_DECODE_FAILED", "Could not decode audio: ${e.message}")
    } catch (e: Throwable) {
      fail("AUDIO_DECODE_FAILED", "Could not decode audio: ${e.message}")
    } finally {
      temp.delete()
    }
  }

  private fun downmixToMono(input: ShortArray, channels: Int): ShortArray {
    if (channels <= 1) return input
    val frames = input.size / channels
    val mono = ShortArray(frames)
    for (frame in 0 until frames) {
      var sum = 0
      for (ch in 0 until channels) sum += input[frame * channels + ch]
      mono[frame] = (sum / channels).toShort()
    }
    return mono
  }

  private fun resampleLinear(input: ShortArray, fromRate: Int): ShortArray {
    if (fromRate == TARGET_SAMPLE_RATE || input.isEmpty()) return input
    val outLength = ((input.size.toLong() * TARGET_SAMPLE_RATE) / fromRate).toInt()
    val output = ShortArray(outLength)
    val ratio = fromRate.toDouble() / TARGET_SAMPLE_RATE
    for (i in 0 until outLength) {
      val position = i * ratio
      val index = position.toInt()
      val fraction = position - index
      val a = input[minOf(index, input.size - 1)].toInt()
      val b = input[minOf(index + 1, input.size - 1)].toInt()
      output[i] = (a + (b - a) * fraction).toInt().toShort()
    }
    return output
  }

  private fun toPcmBytes(samples: ShortArray): ByteArray {
    val bytes = ByteArray(samples.size * 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(samples)
    return bytes
  }
}
