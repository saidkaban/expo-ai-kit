package expo.modules.aikit

import android.os.Build
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

class PromptApiClient {

  private val model by lazy { Generation.getClient() }

  /**
   * Check if on-device AI is available.
   * Returns true if device supports Prompt API (AVAILABLE, DOWNLOADABLE, or DOWNLOADING).
   * Returns false if unsupported or on API < 26.
   */
  suspend fun isAvailable(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false

    return try {
      when (model.checkStatus()) {
        FeatureStatus.AVAILABLE,
        FeatureStatus.DOWNLOADABLE,
        FeatureStatus.DOWNLOADING -> true
        else -> false
      }
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * Non-suspend wrapper for Expo module compatibility.
   */
  fun isAvailableBlocking(): Boolean = runBlocking { isAvailable() }

  /**
   * Download the OS-managed ML Kit model when this device supports it but the
   * asset is not ready yet. No-op when it is already available.
   */
  suspend fun prepareModel() {
    when (model.checkStatus()) {
      FeatureStatus.AVAILABLE -> return
      FeatureStatus.DOWNLOADABLE,
      FeatureStatus.DOWNLOADING -> {
        try {
          model.download().collect { status ->
            if (status is DownloadStatus.DownloadFailed) {
              throw RuntimeException("DOWNLOAD_FAILED:mlkit:${status.e.message}")
            }
          }
        } catch (e: RuntimeException) {
          if (e.message?.startsWith("DOWNLOAD_FAILED:mlkit:") == true) throw e
          throw RuntimeException("DOWNLOAD_FAILED:mlkit:${e.message}")
        } catch (e: Throwable) {
          throw RuntimeException("DOWNLOAD_FAILED:mlkit:${e.message}")
        }
        requireAvailable()
      }
      else -> throw RuntimeException(
        "DEVICE_NOT_SUPPORTED:mlkit:ML Kit Prompt API is not supported on this device"
      )
    }
  }

  /** Fail clearly when inference starts before the OS-managed model is ready. */
  suspend fun requireAvailable() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      throw RuntimeException(
        "DEVICE_NOT_SUPPORTED:mlkit:ML Kit Prompt API requires Android API 26 or later"
      )
    }
    when (model.checkStatus()) {
      FeatureStatus.AVAILABLE -> return
      FeatureStatus.DOWNLOADABLE -> throw RuntimeException(
        "MODEL_NOT_DOWNLOADED:mlkit:The ML Kit model is not ready. Call prepareBuiltInModel() first"
      )
      FeatureStatus.DOWNLOADING -> throw RuntimeException(
        "MODEL_NOT_DOWNLOADED:mlkit:The ML Kit model is still downloading. Await prepareBuiltInModel() first"
      )
      else -> throw RuntimeException(
        "DEVICE_NOT_SUPPORTED:mlkit:ML Kit Prompt API is not supported on this device"
      )
    }
  }

  /**
   * Generate text from a prompt.
   * On Android, we concatenate system prompt + user message since ML Kit
   * doesn't have a separate system prompt API.
   */
  suspend fun generateText(prompt: String, systemPrompt: String): String =
    withContext(Dispatchers.IO) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        throw RuntimeException(
          "DEVICE_NOT_SUPPORTED:mlkit:ML Kit Prompt API requires Android API 26 or later"
        )
      }

      requireAvailable()

      try {
        // Prepend system prompt as context if provided
        val fullPrompt = if (systemPrompt.isNotBlank()) {
          "$systemPrompt\n\nUser: $prompt"
        } else {
          prompt
        }

        val response = model.generateContent(fullPrompt)
        response.candidates.firstOrNull()?.text.orEmpty()
      } catch (e: Throwable) {
        throw RuntimeException("INFERENCE_FAILED:mlkit:${e.message}")
      }
    }

  /**
   * Generate streaming text from a prompt.
   * Returns a Flow that emits chunks of generated text.
   */
  suspend fun generateTextStream(
    prompt: String,
    systemPrompt: String,
    onChunk: (token: String, accumulatedText: String, isDone: Boolean) -> Unit
  ) = withContext(Dispatchers.IO) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      throw RuntimeException(
        "DEVICE_NOT_SUPPORTED:mlkit:ML Kit Prompt API requires Android API 26 or later"
      )
    }

    // Same typed gate as generateText. The module pre-checks before launching the
    // stream, but the status can change between that check and collection time.
    requireAvailable()

    // Prepend system prompt as context if provided
    val fullPrompt = if (systemPrompt.isNotBlank()) {
      "$systemPrompt\n\nUser: $prompt"
    } else {
      prompt
    }

    var accumulatedText = ""

    try {
      model.generateContentStream(fullPrompt).collect { response ->
        val newChunk = response.candidates.firstOrNull()?.text.orEmpty()
        accumulatedText += newChunk
        onChunk(newChunk, accumulatedText, false)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Throwable) {
      throw RuntimeException("INFERENCE_FAILED:mlkit:${e.message}")
    }

    // Send final done event
    onChunk("", accumulatedText, true)
  }
}
