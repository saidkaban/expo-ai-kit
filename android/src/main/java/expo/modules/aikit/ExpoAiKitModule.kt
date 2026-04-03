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

    AsyncFunction("sendMessage") Coroutine { messages: List<Map<String, Any>>, fallbackSystemPrompt: String ->
      // Extract system prompt from messages, or use fallback
      val systemPrompt = messages
        .firstOrNull { it["role"] == "system" }
        ?.get("content") as? String
        ?: fallbackSystemPrompt.ifBlank { "You are a helpful, friendly assistant." }

      // Build conversation history prompt from all non-system messages
      // On-device models are stateless, so we must include full history in each request
      val conversationPrompt = messages
        .filter { it["role"] != "system" }
        .joinToString("\n") { msg ->
          val role = (msg["role"] as? String ?: "user").uppercase()
          val content = msg["content"] as? String ?: ""
          "$role: $content"
        } + "\nASSISTANT:"

      // Route to active model
      val text = if (activeModelId == "mlkit") {
        promptClient.generateText(conversationPrompt, systemPrompt)
      } else {
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

      // Build conversation history prompt from all non-system messages
      // On-device models are stateless, so we must include full history in each request
      val conversationPrompt = messages
        .filter { it["role"] != "system" }
        .joinToString("\n") { msg ->
          val role = (msg["role"] as? String ?: "user").uppercase()
          val content = msg["content"] as? String ?: ""
          "$role: $content"
        } + "\nASSISTANT:"

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
          promptClient.generateTextStream(conversationPrompt, systemPrompt, streamCallback)
        } else {
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
      // Status reflects runtime state: "ready" if loaded in memory,
      // "not-downloaded" otherwise (even if file is on disk -- setModel
      // is the gatekeeper that transitions through loading -> ready).
      when {
        gemmaClient.getLoadedModelId() == modelId && gemmaClient.isModelLoaded() -> "ready"
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

    AsyncFunction("setModel") Coroutine { modelId: String ->
      if (modelId == "mlkit") {
        // Switch to built-in: unload any Gemma model
        if (gemmaClient.isModelLoaded()) {
          gemmaClient.unloadModel()
          val previousId = activeModelId
          if (previousId != "mlkit") {
            sendEvent("onModelStateChange", mapOf(
              "modelId" to previousId,
              "status" to "not-downloaded"
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
        gemmaClient.loadModel(modelId, modelPath)
        activeModelId = modelId

        // Emit ready state
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to "ready"
        ))
      } catch (e: Exception) {
        // Emit failure -- revert status
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to "not-downloaded"
        ))
        throw e
      }
    }

    Function("getActiveModel") {
      activeModelId
    }

    AsyncFunction("unloadModel") Coroutine {
      if (activeModelId != "mlkit" && gemmaClient.isModelLoaded()) {
        val previousId = activeModelId
        gemmaClient.unloadModel()
        activeModelId = "mlkit"
        sendEvent("onModelStateChange", mapOf(
          "modelId" to previousId,
          "status" to "not-downloaded"
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

        // Download complete -- file is on disk but not loaded
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to "not-downloaded"
        ))
      } catch (e: Exception) {
        sendEvent("onModelStateChange", mapOf(
          "modelId" to modelId,
          "status" to "not-downloaded"
        ))
        throw e
      }
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
