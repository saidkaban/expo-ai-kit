package expo.modules.aikit.llm

import android.content.Context
import android.os.SystemClock
import expo.modules.aikit.LlmBackend
import expo.modules.aikit.LlmEventSink
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * The opt-in Android text backend: ML Kit Prompt API ("mlkit", the built-in)
 * plus downloadable LiteRT-LM models. Compiled only with the `llm` config-plugin
 * flag and instantiated by reflection from ExpoAiKitModule (constructor kept by
 * consumer-rules.pro). Owns model routing, stream jobs, and the download
 * progress throttle; the module stays a thin bridge.
 */
class AndroidLlmBackend(context: Context, private val events: LlmEventSink) : LlmBackend {

  private val promptClient by lazy { PromptApiClient() }
  private val gemmaClient by lazy { GemmaInferenceClient(context) }

  private val activeStreamJobs = mutableMapOf<String, Job>()
  private val streamScope = CoroutineScope(Dispatchers.IO)

  // Android's Expo event bridge retains each event until JS consumes it. The
  // download loop reads 8KB chunks, so emitting one event per chunk overflows
  // ART's global JNI reference table on large model downloads.
  private var lastDownloadProgressAt = 0L
  private var lastDownloadProgress = -1.0

  // Active model routing: "mlkit" (default) or a downloadable model ID
  private var activeModelId: String = "mlkit"

  /**
   * Contract string for stream error events: pass through messages already in
   * "CODE:modelId:reason" form; wrap anything else as INFERENCE_FAILED.
   */
  private fun streamErrorContract(e: Throwable, modelId: String): String {
    val message = e.message ?: e.toString()
    return if (Regex("^[A-Z][A-Z_]*:").containsMatchIn(message)) message
    else "INFERENCE_FAILED:$modelId:$message"
  }

  private fun systemPromptOf(messages: List<Map<String, Any>>, fallbackSystemPrompt: String): String =
    messages
      .firstOrNull { it["role"] == "system" }
      ?.get("content") as? String
      ?: fallbackSystemPrompt.ifBlank { "You are a helpful, friendly assistant." }

  // ML Kit has no conversation API: role-prefixed transcript.
  private fun mlKitPromptOf(messages: List<Map<String, Any>>): String =
    messages.filter { it["role"] != "system" }.joinToString("\n") { msg ->
      val role = (msg["role"] as? String ?: "user").uppercase()
      val content = msg["content"] as? String ?: ""
      "$role: $content"
    } + "\nASSISTANT:"

  // LiteRT-LM's Conversation API formats turns from their roles.
  private fun chatTurnsOf(messages: List<Map<String, Any>>): List<ChatTurn> =
    ChatTurn.from(messages.filter { it["role"] != "system" })

  private fun emitModelState(modelId: String, status: String) {
    events.send("onModelStateChange", mapOf("modelId" to modelId, "status" to status))
  }

  private fun diskStatus(modelId: String): String =
    if (gemmaClient.isModelFileDownloaded(modelId)) "downloaded" else "not-downloaded"

  // ==================================================================
  // Generation
  // ==================================================================

  override fun isBuiltInAvailable(): Boolean = promptClient.isAvailableBlocking()

  override suspend fun prepareBuiltInModel() = promptClient.prepareModel()

  override suspend fun sendMessage(
    messages: List<Map<String, Any>>,
    fallbackSystemPrompt: String
  ): Map<String, Any?> {
    val systemPrompt = systemPromptOf(messages, fallbackSystemPrompt)
    val text = if (activeModelId == "mlkit") {
      promptClient.generateText(mlKitPromptOf(messages), systemPrompt)
    } else {
      gemmaClient.generateText(chatTurnsOf(messages), systemPrompt)
    }
    return mapOf("text" to text)
  }

  override suspend fun startStreaming(
    messages: List<Map<String, Any>>,
    fallbackSystemPrompt: String,
    sessionId: String
  ) {
    val systemPrompt = systemPromptOf(messages, fallbackSystemPrompt)

    // Fail the native promise before launching a detached stream so JS can
    // reject cleanly instead of resolving with an unexplained empty string.
    if (activeModelId == "mlkit") {
      promptClient.requireAvailable()
    }

    val job = streamScope.launch {
      val streamCallback = { token: String, accumulatedText: String, isDone: Boolean ->
        events.send("onStreamToken", mapOf(
          "sessionId" to sessionId,
          "token" to token,
          "accumulatedText" to accumulatedText,
          "isDone" to isDone
        ))
      }

      try {
        if (activeModelId == "mlkit") {
          promptClient.generateTextStream(
            mlKitPromptOf(messages), systemPrompt, streamCallback
          )
        } else {
          gemmaClient.generateTextStream(
            chatTurnsOf(messages), systemPrompt, streamCallback
          )
        }
      } catch (e: CancellationException) {
        // User stop() has already settled the JS side (this event is ignored),
        // but a cancellation from anywhere else (e.g. the Play-services task
        // under ML Kit) would otherwise leave the stream hanging and the
        // single-flight guard locked, always emit terminal done, like iOS.
        events.send("onStreamToken", mapOf(
          "sessionId" to sessionId,
          "token" to "",
          "accumulatedText" to "",
          "isDone" to true
        ))
        throw e
      } catch (e: Throwable) {
        // Reject the JS stream promise with the typed contract instead of
        // resolving successfully with silent empty or "[Error: …]" text.
        events.send("onStreamToken", mapOf(
          "sessionId" to sessionId,
          "token" to "",
          "accumulatedText" to "",
          "isDone" to true,
          "error" to streamErrorContract(e, activeModelId)
        ))
      }
    }

    activeStreamJobs[sessionId] = job
    job.invokeOnCompletion { activeStreamJobs.remove(sessionId) }
  }

  override fun stopStreaming(sessionId: String) {
    activeStreamJobs[sessionId]?.cancel()
    activeStreamJobs.remove(sessionId)
  }

  // ==================================================================
  // Model discovery, selection, and lifecycle
  // ==================================================================

  override fun builtInModels(): List<Map<String, Any?>> = listOf(
    mapOf(
      "id" to "mlkit",
      "name" to "ML Kit Prompt API",
      "available" to promptClient.isAvailableBlocking(),
      "platform" to "android",
      // ML Kit doesn't expose a context window; use a reasonable default
      "contextWindow" to 4096
    )
  )

  override fun downloadableModelStatus(modelId: String): String = when {
    // "ready" if loaded in memory; "downloaded" if the file is on disk but not
    // loaded (survives restarts -- use it to skip a redundant re-download);
    // "not-downloaded" if no file is present.
    gemmaClient.getLoadedModelId() == modelId && gemmaClient.isModelLoaded() -> "ready"
    gemmaClient.isModelFileDownloaded(modelId) -> "downloaded"
    else -> "not-downloaded"
  }

  override suspend fun setModel(
    modelId: String,
    minRamBytes: Long,
    backend: String,
    generation: Map<String, Double>
  ) {
    if (modelId == "mlkit") {
      // setModel is the sole gatekeeper: activating the built-in must verify it
      // can actually serve on this device (DEVICE_NOT_SUPPORTED / MODEL_NOT_DOWNLOADED),
      // just as downloadable models verify their file on disk below.
      promptClient.requireAvailable()
      // Switch to built-in: unload any Gemma model
      if (gemmaClient.isModelLoaded()) {
        gemmaClient.unloadModel()
        val previousId = activeModelId
        if (previousId != "mlkit") {
          emitModelState(previousId, diskStatus(previousId))
        }
      }
      activeModelId = "mlkit"
      return
    }

    // Downloadable model: verify file exists
    if (!gemmaClient.isModelFileDownloaded(modelId)) {
      throw RuntimeException("MODEL_NOT_DOWNLOADED:$modelId:Model file not found on disk")
    }

    emitModelState(modelId, "loading")
    try {
      val modelPath = gemmaClient.getModelFilePath(modelId)
      gemmaClient.loadModel(
        modelId, modelPath, minRamBytes, backend,
        temperature = generation["temperature"],
        topK = generation["topK"]?.toInt(),
        topP = generation["topP"]
      )
      activeModelId = modelId
      emitModelState(modelId, "ready")
    } catch (e: Exception) {
      // Load failed, but the file is still on disk -> "downloaded", not "not-downloaded".
      emitModelState(modelId, diskStatus(modelId))
      throw e
    }
  }

  override fun activeModel(): String = activeModelId

  override suspend fun unloadModel() {
    if (activeModelId != "mlkit" && gemmaClient.isModelLoaded()) {
      val previousId = activeModelId
      gemmaClient.unloadModel()
      activeModelId = "mlkit"
      emitModelState(previousId, diskStatus(previousId))
    }
  }

  override suspend fun downloadModel(modelId: String, url: String, sha256: String) {
    lastDownloadProgressAt = 0L
    lastDownloadProgress = -1.0
    emitModelState(modelId, "downloading")

    try {
      gemmaClient.downloadModelFile(modelId, url, sha256) { bytesRead, totalBytes ->
        val progress = if (totalBytes > 0) bytesRead.toDouble() / totalBytes else 0.0
        val now = SystemClock.elapsedRealtime()
        if (
          progress >= 1.0 ||
          now - lastDownloadProgressAt >= 250L ||
          progress - lastDownloadProgress >= 0.01
        ) {
          lastDownloadProgressAt = now
          lastDownloadProgress = progress
          events.send("onDownloadProgress", mapOf(
            "modelId" to modelId,
            "progress" to progress
          ))
        }
      }

      // Download succeeded: file is on disk, awaiting setModel() to load it.
      emitModelState(modelId, "downloaded")
    } catch (e: Exception) {
      // On failure, report whatever is actually on disk (a prior good copy may remain).
      emitModelState(modelId, diskStatus(modelId))
      throw e
    }
  }

  override fun cancelDownload(modelId: String) = gemmaClient.cancelDownload(modelId)

  override suspend fun deleteModel(modelId: String) {
    // If this model is active, switch back to mlkit first
    if (activeModelId == modelId) {
      activeModelId = "mlkit"
    }
    gemmaClient.deleteModelFile(modelId)
    emitModelState(modelId, "not-downloaded")
  }
}
