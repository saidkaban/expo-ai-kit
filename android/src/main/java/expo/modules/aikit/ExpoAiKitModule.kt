package expo.modules.aikit

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.os.SystemClock
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel

class ExpoAiKitModule : Module() {

  // Existing ML Kit client -- unchanged
  private val promptClient by lazy { PromptApiClient() }

  // Gemma client -- lazy-initialized with app context
  private val gemmaClient by lazy {
    GemmaInferenceClient(appContext.reactContext ?: throw RuntimeException("React context not available"))
  }

  // Embedding asset lifecycle (download/status/delete). Always available, it
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

  // Optional ML Kit speech backend. Present only when the app was prebuilt
  // with ["expo-ai-kit", { "speech": true }], which compiles android/src/speech
  // and adds the genai-speech-recognition dependency. Resolved by reflection so
  // this module compiles without ML Kit speech on the classpath.
  private val speechBackend: SpeechBackend? by lazy {
    try {
      Class.forName("expo.modules.aikit.speech.MlKitSpeechBackend")
        .getDeclaredConstructor(Context::class.java)
        .newInstance(appContext.reactContext ?: throw RuntimeException("React context not available"))
        as SpeechBackend
    } catch (e: ReflectiveOperationException) {
      null
    } catch (e: LinkageError) {
      null
    }
  }

  // Optional ML Kit vision backend. Present only when the app was prebuilt
  // with ["expo-ai-kit", { "vision": true }], which compiles android/src/vision
  // and adds the ML Kit vision dependencies. Resolved by reflection so this
  // module compiles without ML Kit vision on the classpath.
  private val visionBackend: VisionBackend? by lazy {
    try {
      Class.forName("expo.modules.aikit.vision.MlKitVisionBackend")
        .getDeclaredConstructor(Context::class.java)
        .newInstance(appContext.reactContext ?: throw RuntimeException("React context not available"))
        as VisionBackend
    } catch (e: ReflectiveOperationException) {
      null
    } catch (e: LinkageError) {
      null
    }
  }

  private fun requireVisionBackend(): VisionBackend =
    visionBackend ?: throw RuntimeException(
      "VISION_NOT_ENABLED:mlkit-vision:" +
        "Vision is opt-in. Add [\"expo-ai-kit\", { \"vision\": true }] to your app config plugins " +
        "and make a new native build (dev client / EAS, not OTA)."
    )

  private fun requireSpeechBackend(): SpeechBackend =
    speechBackend ?: throw RuntimeException(
      "SPEECH_NOT_ENABLED:mlkit-speech:" +
        "Speech is opt-in. Add [\"expo-ai-kit\", { \"speech\": true }] to your app config plugins " +
        "and make a new native build (dev client / EAS, not OTA)."
    )

  // SupervisorJob is load-bearing: with a plain Job, one failed transcription
  // would cancel the scope forever and every later call would surface as
  // INFERENCE_CANCELLED instead of its real typed error.
  private val speechScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val activeSpeechJobs = mutableMapOf<String, Deferred<Map<String, Any?>>>()
  private var activeLiveSpeechSessionId: String? = null

  private fun requireEmbeddingBackend(): EmbeddingBackend =
    embeddingBackend ?: throw RuntimeException(
      "EMBEDDINGS_NOT_ENABLED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:" +
        "Android embeddings are opt-in. Add [\"expo-ai-kit\", { \"androidEmbeddings\": true }] to your " +
        "app config plugins and make a new native build (dev client / EAS, not OTA). " +
        "Enabling adds ~25 MB to the APK; the ~184 MB EmbeddingGemma model then downloads via prepareEmbeddingModel()."
    )

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

  override fun definition() = ModuleDefinition {
    Name("ExpoAiKit")

    Events("onStreamToken", "onDownloadProgress", "onModelStateChange", "onTranscriptionUpdate")

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
        // Gemma/LiteRT-LM: pass raw content, the Conversation API handles
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
        }

        try {
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
            // Gemma/LiteRT-LM: pass raw content, Conversation API handles turn formatting
            val conversationPrompt = nonSystemMessages
              .joinToString("\n") { msg ->
                msg["content"] as? String ?: ""
              }
            gemmaClient.generateTextStream(conversationPrompt, systemPrompt, streamCallback)
          }
        } catch (e: CancellationException) {
          // User stop() has already settled the JS side (this event is ignored),
          // but a cancellation from anywhere else (e.g. the Play-services task
          // under ML Kit) would otherwise leave the stream hanging and the
          // single-flight guard locked, always emit terminal done, like iOS.
          sendEvent("onStreamToken", mapOf(
            "sessionId" to sessionId,
            "token" to "",
            "accumulatedText" to "",
            "isDone" to true
          ))
          throw e
        } catch (e: Throwable) {
          // Reject the JS stream promise with the typed contract instead of
          // resolving successfully with silent empty or "[Error: …]" text.
          sendEvent("onStreamToken", mapOf(
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
      // Last expression must be Unit: Coroutine { } infers the JS return value
      // from it, and a DisposableHandle would fail JS-value conversion and
      // reject every startStreaming promise.
      Unit
    }

    AsyncFunction("stopStreaming") { sessionId: String ->
      activeStreamJobs[sessionId]?.cancel()
      activeStreamJobs.remove(sessionId)
      // Last expression must be Unit, a Job? return would fail JS-value
      // conversion and reject the promise (see startStreaming).
      Unit
    }

    // ==================================================================
    // Embeddings (EmbeddingGemma via MediaPipe TextEmbedder, opt-in)
    // ==================================================================
    // The inference backend is compiled in only when the app enables the
    // config-plugin flag ["expo-ai-kit", { "androidEmbeddings": true }];
    // otherwise the functions below throw EMBEDDINGS_NOT_ENABLED (except
    // cancel/delete, which stay lenient so an app that later disables the flag
    // can still reclaim the ~184 MB asset). embed() NEVER triggers a download,
    // the asset is managed exclusively by prepare/cancel/delete. Deliberately
    // outside the generation path: not routed through setModel(), not guarded
    // by INFERENCE_BUSY (the backend serializes internally instead).

    AsyncFunction("embed") Coroutine { texts: List<String>, task: String, language: String ->
      // `language` is accepted and ignored: EmbeddingGemma is natively
      // multilingual with a single vector space, there is nothing to select.
      val backend = requireEmbeddingBackend()
      if (!embeddingAssets.isDownloaded()) {
        throw RuntimeException(
          "MODEL_NOT_DOWNLOADED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:" +
            "The EmbeddingGemma model (~184 MB) is not on this device. " +
            "Call prepareEmbeddingModel() first, embed() never downloads."
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
      lastDownloadProgressAt = 0L
      lastDownloadProgress = -1.0
      sendEvent("onModelStateChange", mapOf(
        "modelId" to EmbeddingAssetManager.EMBEDDING_MODEL_ID,
        "status" to "downloading"
      ))
      try {
        embeddingAssets.download(url, sha256) { bytesRead, totalBytes ->
          val progress = if (totalBytes > 0) bytesRead.toDouble() / totalBytes else 0.0
          val now = SystemClock.elapsedRealtime()
          if (
            progress >= 1.0 ||
            now - lastDownloadProgressAt >= 250L ||
            progress - lastDownloadProgress >= 0.01
          ) {
            lastDownloadProgressAt = now
            lastDownloadProgress = progress
            sendEvent("onDownloadProgress", mapOf(
              "modelId" to EmbeddingAssetManager.EMBEDDING_MODEL_ID,
              "progress" to progress
            ))
          }
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
        // setModel is the sole gatekeeper: activating the built-in must verify it
        // can actually serve on this device (DEVICE_NOT_SUPPORTED / MODEL_NOT_DOWNLOADED),
        // just as downloadable models verify their file on disk below.
        promptClient.requireAvailable()
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
      lastDownloadProgressAt = 0L
      lastDownloadProgress = -1.0
      sendEvent("onModelStateChange", mapOf(
        "modelId" to modelId,
        "status" to "downloading"
      ))

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
            sendEvent("onDownloadProgress", mapOf(
              "modelId" to modelId,
              "progress" to progress
            ))
          }
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

    // ==================================================================
    // Speech-to-text (ML Kit GenAI Speech Recognition, opt-in)
    // ==================================================================
    // Compiled only with ["expo-ai-kit", { "speech": true }]; without the flag
    // the backend is null and calls throw SPEECH_NOT_ENABLED. Independent of
    // the generation single-flight; the JS layer enforces the speech one.

    AsyncFunction("getSpeechAvailability") Coroutine { locale: String ->
      // Availability never throws for the flag: it *reports* not-enabled.
      val backend = speechBackend
        ?: return@Coroutine mapOf("status" to "unavailable", "reason" to "not-enabled")
      backend.availability(locale)
    }

    AsyncFunction("prepareSpeechRecognition") Coroutine { locale: String ->
      requireSpeechBackend().prepare(locale) { progress ->
        sendEvent("onDownloadProgress", mapOf(
          "modelId" to "mlkit-speech",
          "progress" to progress
        ))
      }
    }

    AsyncFunction("getSupportedSpeechLocalesNative") Coroutine { ->
      // The engine has no locale-enumeration API; the JS registry answers.
      emptyList<String>()
    }

    AsyncFunction("getSpeechPermissions") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(
        appContext.permissions, promise, Manifest.permission.RECORD_AUDIO
      )
    }

    AsyncFunction("requestSpeechPermissions") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions, promise, Manifest.permission.RECORD_AUDIO
      )
    }

    AsyncFunction("transcribeAudio") Coroutine {
      uri: String, base64: String, mediaType: String, locale: String, sessionId: String ->
      val unused = mediaType // Android decodes by content (MediaExtractor sniffs)
      val backend = requireSpeechBackend()
      // file:// URIs can carry percent-escapes (expo-audio recordings do);
      // Uri.parse().path decodes them, a raw prefix-strip would not.
      val path = when {
        uri.isEmpty() -> null
        uri.startsWith("file://") -> android.net.Uri.parse(uri).path ?: uri.removePrefix("file://")
        else -> uri
      }
      val payload = if (base64.isEmpty()) null else base64
      val work = speechScope.async { backend.transcribeFile(path, payload, locale) }
      activeSpeechJobs[sessionId] = work
      try {
        work.await()
      } catch (e: CancellationException) {
        throw RuntimeException("INFERENCE_CANCELLED:mlkit-speech:Transcription was cancelled")
      } finally {
        activeSpeechJobs.remove(sessionId)
      }
    }

    AsyncFunction("startTranscription") Coroutine { locale: String, sessionId: String ->
      activeLiveSpeechSessionId = sessionId
      requireSpeechBackend().startLive(
        locale,
        onUpdate = { text, isFinal ->
          sendEvent("onTranscriptionUpdate", mapOf(
            "sessionId" to sessionId,
            "text" to text,
            "isFinal" to isFinal
          ))
        },
        onError = { contract ->
          sendEvent("onTranscriptionUpdate", mapOf(
            "sessionId" to sessionId,
            "text" to "",
            "isFinal" to true,
            "error" to contract
          ))
        },
        onEnd = {
          sendEvent("onTranscriptionUpdate", mapOf(
            "sessionId" to sessionId,
            "text" to "",
            "isFinal" to false,
            "isSessionEnd" to true
          ))
        }
      )
    }

    AsyncFunction("stopTranscription") Coroutine { sessionId: String ->
      // Scope teardown to the session that was asked for: cancelling an
      // aborted batch transcription must not kill an unrelated live session.
      val batch = activeSpeechJobs.remove(sessionId)
      if (batch != null) {
        batch.cancel()
      } else if (sessionId == activeLiveSpeechSessionId) {
        activeLiveSpeechSessionId = null
        speechBackend?.stopLive()
      }
      // Last expression must be Unit, see startStreaming.
      Unit
    }

    // ==================================================================
    // Vision (ML Kit, opt-in)
    // ==================================================================
    // Compiled only with ["expo-ai-kit", { "vision": true }]; without the flag
    // the backend is null, availability reports 'not-enabled', and the other
    // calls throw VISION_NOT_ENABLED. Independent of the generation and speech
    // guards. prepareVision() is the only call that downloads (Google Play
    // services modules); the analysis calls throw MODEL_NOT_DOWNLOADED instead.

    AsyncFunction("getVisionAvailability") Coroutine { ->
      val backend = visionBackend
      if (backend == null) {
        val notEnabled = mapOf("status" to "unavailable", "reason" to "not-enabled")
        return@Coroutine mapOf(
          "backgroundRemoval" to notEnabled,
          "imageLabeling" to notEnabled,
          "textRecognition" to notEnabled
        )
      }
      backend.availability()
    }

    AsyncFunction("prepareVision") Coroutine { features: List<String>, languages: List<String> ->
      requireVisionBackend().prepare(features, languages) { progress ->
        sendEvent("onDownloadProgress", mapOf(
          "modelId" to "mlkit-vision",
          "progress" to progress
        ))
      }
    }

    AsyncFunction("getSupportedTextRecognitionLanguagesNative") Coroutine { ->
      // ML Kit has no enumeration API; the JS registry answers on Android.
      emptyList<String>()
    }

    AsyncFunction("removeBackground") Coroutine {
      uri: String, trim: Boolean, format: String, quality: Double, maxPixels: Int,
      subjectX: Double, subjectY: Double, includeMask: Boolean ->
      requireVisionBackend().removeBackground(
        uri, trim, format, quality, maxPixels, subjectX, subjectY, includeMask
      )
    }

    AsyncFunction("labelImage") Coroutine { uri: String, maxResults: Int, minConfidence: Double ->
      requireVisionBackend().labelImage(uri, maxResults, minConfidence)
    }

    AsyncFunction("recognizeText") Coroutine {
      uri: String, languages: List<String>, recognitionLevel: String, usesLanguageCorrection: Boolean,
      customWords: List<String>, minTextHeight: Double ->
      // recognitionLevel, usesLanguageCorrection, and customWords are Vision
      // (iOS) knobs; ML Kit runs a single model with no equivalents.
      val unusedLevel = recognitionLevel
      val unusedCorrection = usesLanguageCorrection
      val unusedWords = customWords
      requireVisionBackend().recognizeText(uri, languages, minTextHeight)
    }
  }
}
