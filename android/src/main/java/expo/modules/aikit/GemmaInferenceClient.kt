package expo.modules.aikit

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.SamplerConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Wrapper around LiteRT-LM Engine for Gemma 4 models.
 *
 * Concurrency model:
 * - A Mutex guards all state transitions (load, unload, inference).
 * - sendMessage/startStreaming block on the mutex if a load is in progress.
 * - deleteModel waits for inference to finish, then unloads and deletes.
 * - A separate isDownloading flag prevents concurrent downloads (checked before
 *   the long-running download, not inside the mutex).
 */
class GemmaInferenceClient(private val context: Context) {

  private val mutex = Mutex()
  private var engine: Engine? = null
  private var conversation: Conversation? = null
  private var loadedModelId: String? = null

  // Sampling config for the session, fixed at load. Kept so each inference call
  // can build a FRESH conversation: the JS layer passes the full history every
  // call (stateless-model contract), so reusing one native conversation would
  // feed the model its own history twice, and a second turn on the same
  // conversation trips LiteRT-LM 0.10.0's chat-template engine on some models
  // (qwen3: "string has no method named strip").
  private var convConfig: ConversationConfig = ConversationConfig()

  @Volatile
  private var isDownloading = false

  @Volatile
  private var cancelDownloadRequested = false

  // -------------------------------------------------------------------------
  // Model lifecycle
  // -------------------------------------------------------------------------

  /**
   * Fail fast on ABIs where LiteRT-LM's native backend is known to crash.
   *
   * litertlm-android ships an x86_64 liblitertlm_jni.so, but the x86_64 backend
   * is unvalidated upstream and SIGSEGVs on emulators, at engine init and
   * during inference (google-ai-edge/LiteRT-LM #2799, #2159; still open as of
   * 0.15.0). A SIGSEGV kills the whole app process and no Kotlin try/catch can
   * contain it, so the only safe behavior is a typed error before any Engine
   * call. Physical devices and arm64 emulator images (Apple Silicon hosts) run
   * the arm64-v8a library and are unaffected. Remove this guard only once a
   * LiteRT-LM release validates x86_64.
   */
  private fun requireSupportedAbi(modelId: String) {
    val primaryAbi = Build.SUPPORTED_ABIS.firstOrNull() ?: return
    if (primaryAbi == "x86_64" || primaryAbi == "x86") {
      throw RuntimeException(
        "DEVICE_NOT_SUPPORTED:$modelId:Downloadable models are not supported on $primaryAbi Android " +
        "(typically an emulator on an Intel/AMD host), LiteRT-LM's native x86 backend crashes the app. " +
        "Use a physical device or an arm64 emulator image."
      )
    }
  }

  /**
   * Load a model into memory using LiteRT-LM Engine.
   * Unloads any previously loaded model first.
   * Caller is responsible for emitting onModelStateChange events.
   */
  suspend fun loadModel(
    modelId: String,
    modelPath: String,
    minRamBytes: Long = 0,
    backend: String = "auto",
    temperature: Double? = null,
    topK: Int? = null,
    topP: Double? = null
  ) = mutex.withLock {
    requireSupportedAbi(modelId)

    // Unload previous model if different
    if (loadedModelId != null && loadedModelId != modelId) {
      conversation?.close()
      engine?.close()
      conversation = null
      engine = null
      loadedModelId = null
    }

    if (loadedModelId == modelId && engine != null) {
      return@withLock // Already loaded
    }

    // Soft memory check. LiteRT-LM memory-maps model weights so actual RSS
    // is much lower than file size. We log a warning but always attempt the
    // load, Engine.initialize() may still succeed. If it truly OOMs, Android's
    // lmkd kills the process (uncatchable signal 9), but that's better than
    // blocking devices that could have worked.
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    if (activityManager != null && minRamBytes > 0) {
      val memInfo = ActivityManager.MemoryInfo()
      activityManager.getMemoryInfo(memInfo)
      if (memInfo.availMem < minRamBytes) {
        android.util.Log.w("ExpoAiKit",
          "Low memory warning for $modelId: " +
          "available ${memInfo.availMem / 1_000_000}MB, recommended ${minRamBytes / 1_000_000}MB. " +
          "Attempting load anyway (LiteRT-LM uses memory-mapped I/O)."
        )
      }
    }

    try {
      withContext(Dispatchers.IO) {
        val newEngine = when (backend) {
          "gpu" -> {
            val config = EngineConfig(modelPath = modelPath, backend = Backend.GPU())
            val eng = Engine(config)
            eng.initialize()
            eng
          }
          "cpu" -> {
            val config = EngineConfig(modelPath = modelPath, backend = Backend.CPU())
            val eng = Engine(config)
            eng.initialize()
            eng
          }
          else -> {
            // "auto": try GPU first, fall back to CPU
            try {
              val gpuConfig = EngineConfig(modelPath = modelPath, backend = Backend.GPU())
              val eng = Engine(gpuConfig)
              eng.initialize()
              eng
            } catch (e: Exception) {
              val cpuConfig = EngineConfig(modelPath = modelPath, backend = Backend.CPU())
              val eng = Engine(cpuConfig)
              eng.initialize()
              eng
            }
          }
        }

        // Sampling knobs are fixed at conversation creation by LiteRT-LM. If any
        // is provided, build a SamplerConfig (filling unspecified values with
        // Gemma-typical defaults); otherwise use the engine/model defaults.
        // Stored so every inference call can create a fresh conversation with
        // the same sampling (see convConfig).
        convConfig = if (temperature != null || topK != null || topP != null) {
          ConversationConfig(
            samplerConfig = SamplerConfig(
              topK = topK ?: 64,
              topP = topP ?: 0.95,
              temperature = temperature ?: 1.0
            )
          )
        } else {
          ConversationConfig()
        }
        val newConversation = newEngine.createConversation(convConfig)

        engine = newEngine
        conversation = newConversation
        loadedModelId = modelId
      }
    } catch (e: OutOfMemoryError) {
      conversation?.close()
      engine?.close()
      conversation = null
      engine = null
      loadedModelId = null
      throw RuntimeException("INFERENCE_OOM:$modelId:Device does not have enough memory to load model")
    } catch (e: Exception) {
      conversation?.close()
      engine?.close()
      conversation = null
      engine = null
      loadedModelId = null
      throw RuntimeException("MODEL_LOAD_FAILED:$modelId:${e.message}")
    }
  }

  /**
   * Unload the current model from memory.
   */
  suspend fun unloadModel() = mutex.withLock {
    conversation?.close()
    engine?.close()
    conversation = null
    engine = null
    loadedModelId = null
  }

  fun getLoadedModelId(): String? = loadedModelId

  fun isModelLoaded(): Boolean = engine != null

  // -------------------------------------------------------------------------
  // Inference
  // -------------------------------------------------------------------------

  /**
   * Replace the current conversation with a fresh one for a single call.
   * Must be called with the mutex held. See [convConfig] for why inference
   * never reuses a conversation across calls.
   */
  private fun freshConversation(): Conversation {
    val eng = engine
      ?: throw RuntimeException("MODEL_NOT_DOWNLOADED:${loadedModelId ?: "unknown"}:No model loaded")
    conversation?.close()
    conversation = null
    val conv = try {
      eng.createConversation(convConfig)
    } catch (e: Exception) {
      throw RuntimeException("INFERENCE_FAILED:${loadedModelId ?: "unknown"}:Failed to create conversation: ${e.message}")
    }
    conversation = conv
    return conv
  }

  /**
   * Generate a complete response. Blocks until done.
   * The mutex ensures this cannot run concurrently with load/unload.
   */
  suspend fun generateText(prompt: String, systemPrompt: String): String = mutex.withLock {
    val conv = freshConversation()

    val fullPrompt = buildFullPrompt(prompt, systemPrompt)

    try {
      withContext(Dispatchers.IO) {
        suspendCancellableCoroutine<String> { continuation ->
          val result = StringBuilder()
          var previousText = ""
          conv.sendMessageAsync(
            Contents.of(fullPrompt),
            object : MessageCallback {
              override fun onMessage(message: Message) {
                // LiteRT-LM may deliver accumulated text or delta tokens
                // (observed: deltas on-device), detect which, exactly like
                // generateTextStream, so the final text isn't just the last chunk.
                val messageText = message.toString()
                if (messageText.startsWith(previousText) && messageText.length >= previousText.length) {
                  result.clear()
                  result.append(messageText)
                } else {
                  result.append(messageText)
                }
                previousText = result.toString()
              }
              override fun onDone() {
                continuation.resume(result.toString())
              }
              override fun onError(throwable: Throwable) {
                continuation.resumeWithException(throwable)
              }
            },
            emptyMap()
          )
        }
      }
    } catch (e: kotlinx.coroutines.CancellationException) {
      // Cooperative cancellation, propagate, don't mask as an inference failure.
      throw e
    } catch (e: OutOfMemoryError) {
      throw RuntimeException("INFERENCE_OOM:${loadedModelId ?: "unknown"}:Out of memory during inference")
    } catch (e: Exception) {
      throw RuntimeException("INFERENCE_FAILED:${loadedModelId ?: "unknown"}:${e.message}")
    }
  }

  /**
   * Generate a streaming response. The onChunk callback receives
   * (token=delta, accumulatedText=full, isDone) matching the PromptApiClient contract.
   *
   * LiteRT-LM 0.10.0 uses a MessageCallback interface. Each onMessage emission
   * contains accumulated text, so we diff against previousText to extract
   * the delta token.
   */
  suspend fun generateTextStream(
    prompt: String,
    systemPrompt: String,
    onChunk: (token: String, accumulatedText: String, isDone: Boolean) -> Unit
  ) = mutex.withLock {
    val conv = freshConversation()

    val fullPrompt = buildFullPrompt(prompt, systemPrompt)

    try {
      withContext(Dispatchers.IO) {
        suspendCancellableCoroutine<Unit> { continuation ->
          val accumulatedBuilder = StringBuilder()
          var previousText = ""
          conv.sendMessageAsync(
            Contents.of(fullPrompt),
            object : MessageCallback {
              override fun onMessage(message: Message) {
                val messageText = message.toString()

                // LiteRT-LM may deliver accumulated text or delta tokens depending
                // on the version. Detect which by checking if messageText extends
                // what we've seen before.
                val token: String
                if (messageText.startsWith(previousText) && messageText.length >= previousText.length) {
                  // Accumulated text, extract delta
                  token = messageText.substring(previousText.length)
                  previousText = messageText
                  accumulatedBuilder.clear()
                  accumulatedBuilder.append(messageText)
                } else {
                  // Delta token, accumulate ourselves
                  token = messageText
                  accumulatedBuilder.append(messageText)
                  previousText = accumulatedBuilder.toString()
                }

                val accumulated = accumulatedBuilder.toString()
                onChunk(token, accumulated, false)
              }
              override fun onDone() {
                val finalText = accumulatedBuilder.toString()
                onChunk("", finalText, true)
                continuation.resume(Unit)
              }
              override fun onError(throwable: Throwable) {
                continuation.resumeWithException(throwable)
              }
            },
            emptyMap()
          )
        }
      }
    } catch (e: kotlinx.coroutines.CancellationException) {
      // Cooperative cancellation, propagate, don't mask as an inference failure.
      throw e
    } catch (e: OutOfMemoryError) {
      throw RuntimeException("INFERENCE_OOM:${loadedModelId ?: "unknown"}:Out of memory during inference")
    } catch (e: Exception) {
      throw RuntimeException("INFERENCE_FAILED:${loadedModelId ?: "unknown"}:${e.message}")
    }
  }

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  /**
   * Download a model file with progress reporting.
   * Prevents concurrent downloads. On failure, deletes partial files.
   *
   * Strategy: restart from scratch on failure (no HTTP Range resumption).
   * Downloads to a .tmp file, verifies SHA-256, atomically renames on success
   * (the mechanics live in [DownloadUtil], shared with the embedding asset).
   */
  suspend fun downloadModelFile(
    modelId: String,
    url: String,
    sha256: String,
    onProgress: (bytesRead: Long, totalBytes: Long) -> Unit
  ) {
    if (isDownloading) {
      throw RuntimeException("DOWNLOAD_FAILED:$modelId:Download already in progress")
    }
    isDownloading = true
    cancelDownloadRequested = false

    try {
      withContext(Dispatchers.IO) {
        val modelsDir = File(context.filesDir, "models")
        modelsDir.mkdirs()

        DownloadUtil.downloadVerified(
          context = context,
          modelId = modelId,
          url = url,
          targetFile = File(modelsDir, "$modelId.litertlm"),
          tempFile = File(modelsDir, "$modelId.litertlm.tmp"),
          sha256 = sha256,
          isCancelled = { cancelDownloadRequested },
          onProgress = onProgress
        )
      }
    } finally {
      isDownloading = false
    }
  }

  /**
   * Delete a model file from disk. If the model is loaded, unloads it first.
   */
  suspend fun deleteModelFile(modelId: String) = mutex.withLock {
    // Unload if this model is currently loaded
    if (loadedModelId == modelId) {
      conversation?.close()
      engine?.close()
      conversation = null
      engine = null
      loadedModelId = null
    }

    val modelFile = File(context.filesDir, "models/$modelId.litertlm")
    if (modelFile.exists()) {
      modelFile.delete()
    }
    // Also clean up any partial downloads
    val tempFile = File(context.filesDir, "models/$modelId.litertlm.tmp")
    if (tempFile.exists()) {
      tempFile.delete()
    }
  }

  /**
   * Request cancellation of the in-flight download, if any. The download loop
   * checks this flag and throws DOWNLOAD_CANCELLED. No-op if nothing is downloading.
   */
  fun cancelDownload(modelId: String) {
    cancelDownloadRequested = true
  }

  /**
   * Check if a model file exists on disk.
   */
  fun isModelFileDownloaded(modelId: String): Boolean {
    return File(context.filesDir, "models/$modelId.litertlm").exists()
  }

  /**
   * Get the file path for a downloaded model.
   */
  fun getModelFilePath(modelId: String): String {
    return File(context.filesDir, "models/$modelId.litertlm").absolutePath
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private fun buildFullPrompt(prompt: String, systemPrompt: String): String {
    return if (systemPrompt.isNotBlank()) {
      "$systemPrompt\n\n$prompt"
    } else {
      prompt
    }
  }
}
