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

  // Embedding asset lifecycle (download/status/delete). Always available — it
  // has no MediaPipe dependency; only the inference backend below is optional.
  private val embeddingAssets by lazy {
    EmbeddingAssetManager(appContext.reactContext ?: throw RuntimeException("React context not available"))
  }

  // Optional EmbeddingGemma inference backend. Present only when the app was
  // prebuilt with ["expo-ai-kit", { "androidEmbeddings": true }], which
  // compiles android/src/embeddings and adds the MediaPipe tasks-text
  // dependency. Resolved by reflection so this module compiles without
  // MediaPipe on the classpath (kept by consumer-rules.pro under R8).
  private val embeddingBackend: EmbeddingBackend? by lazy {
    try {
      Class.forName("expo.modules.aikit.embeddings.EmbeddingGemmaBackend")
        .getDeclaredConstructor(Context::class.java)
        .newInstance(appContext.reactContext ?: throw RuntimeException("React context not available"))
        as EmbeddingBackend
    } catch (e: ReflectiveOperationException) {
      null
    } catch (e: LinkageError) {
      null
    }
  }

  private fun requireEmbeddingBackend(): EmbeddingBackend =
    embeddingBackend ?: throw RuntimeException(
      "EMBEDDINGS_NOT_ENABLED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:" +
        "Android embeddings are opt-in. Add [\"expo-ai-kit\", { \"androidEmbeddings\": true }] to your " +
        "app config plugins and make a new native build (dev client / EAS — not OTA). " +
        "Enabling adds ~25 MB to the APK; the ~184 MB EmbeddingGemma model then downloads via prepareEmbeddingModel()."
    )

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

    AsyncFunction("prepareBuiltInModel") Coroutine { ->
      promptClient.prepareModel()
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

    AsyncFunction("startStreaming") Coroutine { messages: List<Map<String, Any>>, fallbackSystemPrompt: String, sessionId: String ->
      // Extract system prompt from messages, or use fallback
      val systemPrompt = messages
        .firstOrNull { it["role"] == "system" }
        ?.get("content") as? String
        ?: fallbackSystemPrompt.ifBlank { "You are a helpful, friendly assistant." }

      val nonSystemMessages = messages.filter { it["role"] != "system" }

      // Fail the native promise before launching a detached stream so JS can
      // reject cleanly instead of resolving with an unexplained empty string.
      if (activeModelId == "mlkit") {
        promptClient.requireAvailable()
      }

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
    // Embeddings (EmbeddingGemma via MediaPipe TextEmbedder — opt-in)
    // ==================================================================
    // The inference backend is compiled in only when the app enables the
    // config-plugin flag ["expo-ai-kit", { "androidEmbeddings": true }];
    // otherwise the functions below throw EMBEDDINGS_NOT_ENABLED (except
    // cancel/delete, which stay lenient so an app that later disables the flag
    // can still reclaim the ~184 MB asset). embed() NEVER triggers a download —
    // the asset is managed exclusively by prepare/cancel/delete. Deliberately
    // outside the generation path: not routed through setModel(), not guarded
    // by INFERENCE_BUSY (the backend serializes internally instead).

    AsyncFunction("embed") Coroutine { texts: List<String>, task: String, language: String ->
      // `language` is accepted and ignored: EmbeddingGemma is natively
      // multilingual with a single vector space — there is nothing to select.
      val backend = requireEmbeddingBackend()
      if (!embeddingAssets.isDownloaded()) {
        throw RuntimeException(
          "MODEL_NOT_DOWNLOADED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:" +
            "The EmbeddingGemma model (~184 MB) is not on this device. " +
            "Call prepareEmbeddingModel() first — embed() never downloads."
        )
      }
      val embeddings = backend.embed(embeddingAssets.modelFile().absolutePath, texts, task)
      // Identity (id/revision) is attached by the JS layer from its pinned
      // artifacts; native reports the raw vectors and dimensionality.
      mapOf(
        "embeddings" to embeddings,
        "dimensions" to EmbeddingAssetManager.EMBEDDING_DIMENSIONS
      )
    }

    Function("getEmbeddingModelStatus") { language: String ->
      requireEmbeddingBackend()
      embeddingAssets.status()
    }

    AsyncFunction("prepareEmbeddingModel") Coroutine { url: String, sha256: String, language: String ->
      requireEmbeddingBackend()
      if (embeddingAssets.isDownloaded()) return@Coroutine
      sendEvent("onModelStateChange", mapOf(
        "modelId" to EmbeddingAssetManager.EMBEDDING_MODEL_ID,
        "status" to "downloading"
      ))
      try {
        embeddingAssets.download(url, sha256) { bytesRead, totalBytes ->
          sendEvent("onDownloadProgress", mapOf(
            "modelId" to EmbeddingAssetManager.EMBEDDING_MODEL_ID,
            "progress" to if (totalBytes > 0) bytesRead.toDouble() / totalBytes else 0.0
          ))
        }
        sendEvent("onModelStateChange", mapOf(
          "modelId" to EmbeddingAssetManager.EMBEDDING_MODEL_ID,
          "status" to "downloaded"
        ))
      } catch (e: Exception) {
        // Failed or cancelled downloads clean their partial file; report what's
        // actually on disk (a prior verified copy may remain).
        sendEvent("onModelStateChange", mapOf(
          "modelId" to EmbeddingAssetManager.EMBEDDING_MODEL_ID,
          "status" to embeddingAssets.status()
        ))
        throw e
      }
    }

    AsyncFunction("cancelEmbeddingModelDownload") {
      embeddingAssets.cancelDownload()
    }

    AsyncFunction("deleteEmbeddingModel") Coroutine { ->
      embeddingBackend?.close()
      embeddingAssets.delete()
      sendEvent("onModelStateChange", mapOf(
        "modelId" to EmbeddingAssetManager.EMBEDDING_MODEL_ID,
        "status" to "not-downloaded"
      ))
    }

    // Only meaningful on iOS (NLContextualEmbedding catalog); the JS layer
    // answers [] on Android without calling native. Registered for parity.
    Function("getSupportedEmbeddingLanguages") {
      listOf<String>()
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
