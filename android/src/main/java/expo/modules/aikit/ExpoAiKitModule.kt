package expo.modules.aikit

import android.app.ActivityManager
import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel

class ExpoAiKitModule : Module() {

  // Existing ML Kit client -- unchanged
  private val promptClient by lazy { PromptApiClient() }

  // Gemma client -- lazy-initialized with app context
  private val gemmaClient by lazy {
    GemmaInferenceClient(appContext.reactContext ?: throw RuntimeException("React context not available"))
  }

  private val activeStreamJobs = mutableMapOf<String, Job>()
  private val streamScope = CoroutineScope(Dispatchers.IO)

  // Active model routing: "mlkit" (default) or a downloadable model ID
  private var activeModelId: String = "mlkit"

  override fun definition() = ModuleDefinition {
    Name("ExpoAiKit")

    Events("onStreamToken", "onDownloadProgress", "onModelStateChange")

    // ==================================================================
    // Existing inference API -- ML Kit path completely untouched
    // ==================================================================

    Function("isAvailable") {
      promptClient.isAvailableBlocking()
    }

    // sessionId is accepted for API parity with iOS. Non-streaming generation on
    // Android isn't separately cancellable (best-effort), so the id is unused here.
    AsyncFunction("sendMessage") Coroutine { messages: List<Map<String, Any>>, fallbackSystemPrompt: String, sessionId: String ->
      // Extract system prompt from messages, or use fallback
      val systemPrompt = messages
        .firstOrNull { it["role"] == "system" }
        ?.get("content") as? String
        ?: fallbackSystemPrompt.ifBlank { "You are a helpful, friendly assistant." }

      // Build conversation history prompt from all non-system messages
      // On-device models are stateless, so we must include full history in each request
      val nonSystemMessages = messages.filter { it["role"] != "system" }

      // Route to active model
      val text = if (activeModelId == "mlkit") {
        // ML Kit: use role-prefixed format since it has no conversation API
        val conversationPrompt = nonSystemMessages
          .joinToString("\n") { msg ->
            val role = (msg["role"] as? String ?: "user").uppercase()
            val content = msg["content"] as? String ?: ""
            "$role: $content"
          } + "\nASSISTANT:"
        promptClient.generateText(conversationPrompt, systemPrompt)
      } else {
        // Gemma/LiteRT-LM: pass raw content — the Conversation API handles
        // turn formatting internally. Adding "USER:"/"ASSISTANT:" markers
        // causes double-formatting and garbled output.
        val conversationPrompt = nonSystemMessages
          .joinToString("\n") { msg ->
            msg["content"] as? String ?: ""
          }
        gemmaClient.generateText(conversationPrompt, systemPrompt)
      }
      mapOf("text" to text)
    }

    AsyncFunction("startStreaming") { messages: List<Map<String, Any>>, fallbackSystemPrompt: String, sessionId: String ->
      // Extract system prompt from messages, or use fallback
      val systemPrompt = messages
        .firstOrNull { it["role"] == "system" }
        ?.get("content") as? String
        ?: fallbackSystemPrompt.ifBlank { "You are a helpful, friendly assistant." }

      val nonSystemMessages = messages.filter { it["role"] != "system" }

      // Launch streaming in a coroutine that can be cancelled
      val job = streamScope.launch {
        val streamCallback = { token: String, accumulatedText: String, isDone: Boolean ->
          sendEvent("onStreamToken", mapOf(
            "sessionId" to sessionId,
            "token" to token,
            "accumulatedText" to accumulatedText,
            "isDone" to isDone
          ))

          if (isDone) {
            activeStreamJobs.remove(sessionId)
          }
        }

        // Route to active model
        if (activeModelId == "mlkit") {
          // ML Kit: use role-prefixed format since it has no conversation API
          val conversationPrompt = nonSystemMessages
            .joinToString("\n") { msg ->
              val role = (msg["role"] as? String ?: "user").uppercase()
              val content = msg["content"] as? String ?: ""
              "$role: $content"
            } + "\nASSISTANT:"
          promptClient.generateTextStream(conversationPrompt, systemPrompt, streamCallback)
        } else {
          // Gemma/LiteRT-LM: pass raw content — Conversation API handles turn formatting
          val conversationPrompt = nonSystemMessages
            .joinToString("\n") { msg ->
              msg["content"] as? String ?: ""
            }
          gemmaClient.generateTextStream(conversationPrompt, systemPrompt, streamCallback)
        }
      }

      activeStreamJobs[sessionId] = job
    }

    AsyncFunction("stopStreaming") { sessionId: String ->
      activeStreamJobs[sessionId]?.cancel()
      activeStreamJobs.remove(sessionId)
    }

    // ==================================================================
    // Model discovery
    // ==================================================================

    Function("getBuiltInModels") {
      listOf(
        mapOf(
          "id" to "mlkit",
          "name" to "ML Kit Prompt API",
          "available" to promptClient.isAvailableBlocking(),
          "platform" to "android",
          // ML Kit doesn't expose a context window; use a reasonable default
          "contextWindow" to 4096
        )
      )
    }

    Function("getDownloadableModelStatus") { modelId: String ->
      // "ready" if loaded in memory; "downloaded" if the file is on disk but not
      // loaded (survives restarts -- use it to skip a redundant re-download);
      // "not-downloaded" if no file is present.
      when {
        gemmaClient.getLoadedModelId() == modelId && gemmaClient.isModelLoaded() -> "ready"
        gemmaClient.isModelFileDownloaded(modelId) -> "downloaded"
        else -> "not-downloaded"
      }
    }

    Function("getDeviceRamBytes") {
      val activityManager = appContext.reactContext?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      if (activityManager != null) {
        val memInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memInfo)
        memInfo.totalMem
      } else {
        0L
      }
    }

    // ==================================================================
    // Model selection & memory management
    // ==================================================================

    AsyncFunction("setModel") Coroutine { modelId: String, minRamBytes: Long, backend: String, generation: Map<String, Double> ->
      if (modelId == "mlkit") {
        // Switch to built-in: unload any Gemma model
        if (gemmaClient.isModelLoaded()) {
          gemmaClient.unloadModel()
          val previousId = activeModelId
          if (previousId != "mlkit") {
            sendEvent("onModelStateChange", mapOf(
              "modelId" to previousId,
              "status" to if (gemmaClient.isModelFileDownloaded(previousId)) "downloaded" else "not-downloaded"
            ))
          }
        }
        activeModelId = "mlkit"
        return@Coroutine
      }

      // Downloadable model: verify file exists
      if (!gemmaClient.isModelFileDownloaded(modelId)) {
        throw RuntimeException("MODEL_NOT_DOWNLOADED:$modelId:Model file not found on disk")
      }

      // Emit loading state
      sendEvent("onModelStateChange", mapOf(
        "modelId" to modelId,
        "status" to "loading"
      ))

      try {
        val modelPath = gemmaClient.getModelFilePath(modelId)
        gemmaClient.loadModel(
          modelId, modelPath, minRamBytes, backend,
          temperature = generation["temperature"],
          topK = generation["topK"]?.toInt(),
          topP = generation["topP"]
        )
        activeModelId = modelId

        // Emit ready state
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to "ready"
        ))
      } catch (e: Exception) {
        // Load failed, but the file is still on disk -> "downloaded", not "not-downloaded".
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to if (gemmaClient.isModelFileDownloaded(modelId)) "downloaded" else "not-downloaded"
        ))
        throw e
      }
    }

    Function("getActiveModel") {
      activeModelId
    }

    AsyncFunction("unloadModel") Coroutine { ->
      if (activeModelId != "mlkit" && gemmaClient.isModelLoaded()) {
        val previousId = activeModelId
        gemmaClient.unloadModel()
        activeModelId = "mlkit"
        sendEvent("onModelStateChange", mapOf(
          "modelId" to previousId,
          "status" to if (gemmaClient.isModelFileDownloaded(previousId)) "downloaded" else "not-downloaded"
        ))
      }
    }

    // ==================================================================
    // Model lifecycle (downloadable models only)
    // ==================================================================

    AsyncFunction("downloadModel") Coroutine { modelId: String, url: String, sha256: String ->
      sendEvent("onModelStateChange", mapOf(
        "modelId" to modelId,
        "status" to "downloading"
      ))

      try {
        gemmaClient.downloadModelFile(modelId, url, sha256) { bytesRead, totalBytes ->
          sendEvent("onDownloadProgress", mapOf(
            "modelId" to modelId,
            "progress" to if (totalBytes > 0) bytesRead.toDouble() / totalBytes else 0.0
          ))
        }

        // Download succeeded: file is on disk, awaiting setModel() to load it.
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to "downloaded"
        ))
      } catch (e: Exception) {
        // On failure, report whatever is actually on disk (a prior good copy may remain).
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to if (gemmaClient.isModelFileDownloaded(modelId)) "downloaded" else "not-downloaded"
        ))
        throw e
      }
    }

    AsyncFunction("cancelDownload") Coroutine { modelId: String ->
      gemmaClient.cancelDownload(modelId)
    }

    AsyncFunction("deleteModel") Coroutine { modelId: String ->
      // If this model is active, switch back to mlkit first
      if (activeModelId == modelId) {
        activeModelId = "mlkit"
      }

      gemmaClient.deleteModelFile(modelId)

      sendEvent("onModelStateChange", mapOf(
        "modelId" to modelId,
        "status" to "not-downloaded"
      ))
    }
  }
}
