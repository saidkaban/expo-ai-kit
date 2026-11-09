package expo.modules.aikit.llm

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
import expo.modules.aikit.DownloadUtil
import expo.modules.aikit.LlmModelFiles
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** One non-system message passed to LiteRT-LM with its real role. */
data class ChatTurn(val isAssistant: Boolean, val text: String) {
  companion object {
    /** Chat templates can require alternating roles, so consecutive messages from one side become a single turn. */
    fun from(messages: List<Map<String, Any>>): List<ChatTurn> {
      val turns = mutableListOf<ChatTurn>()
      for (message in messages) {
        val isAssistant = message["role"] == "assistant"
        val text = message["content"] as? String ?: ""
        val last = turns.lastOrNull()
        if (last != null && last.isAssistant == isAssistant) {
          turns[turns.lastIndex] = last.copy(text = last.text + "\n" + text)
        } else {
          turns.add(ChatTurn(isAssistant, text))
        }
      }
      return turns
    }
  }
}

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
   * never reuses a conversation across calls. The system prompt and earlier
   * turns go in as real roles, and the returned text is the last turn, to send
   * on the new conversation.
   */
  private fun freshConversation(
    turns: List<ChatTurn>,
    systemPrompt: String
  ): Pair<Conversation, String> {
    val eng = engine
      ?: throw RuntimeException("MODEL_NOT_DOWNLOADED:${loadedModelId ?: "unknown"}:No model loaded")
    conversation?.close()
    conversation = null
    val config = ConversationConfig(
      systemInstruction = systemPrompt.takeIf { it.isNotBlank() }?.let { Contents.of(it) },
      initialMessages = turns.dropLast(1).map {
        if (it.isAssistant) Message.model(it.text) else Message.user(it.text)
      },
      samplerConfig = convConfig.samplerConfig
    )
    val conv = try {
      eng.createConversation(config)
    } catch (e: Exception) {
      throw RuntimeException("INFERENCE_FAILED:${loadedModelId ?: "unknown"}:Failed to create conversation: ${e.message}")
    }
    conversation = conv
    return conv to (turns.lastOrNull()?.text ?: "")
  }

  /**
   * Run one async inference on [conv] and suspend until LiteRT-LM has actually
   * finished it. Must be called with the mutex held.
   *
   * On cancellation (stopStreaming cancels the stream job), this asks LiteRT-LM
   * to stop with cancelProcess() and keeps waiting for its terminal callback
   * (a kCancelled status arrives as onError) before rethrowing. Returning as
   * soon as the coroutine is cancelled would release the mutex and, through the
   * stream's terminal event, the JS single-flight guard while the old decode is
   * still running; the next call's freshConversation() would then close that
   * conversation under it.
   */
  private suspend fun runInference(
    conv: Conversation,
    prompt: String,
    onText: (String) -> Unit
  ) {
    val finished = CompletableDeferred<Unit>()
    val stopping = AtomicBoolean(false)
    var started = false
    try {
      withContext(Dispatchers.IO) {
        conv.sendMessageAsync(
          Contents.of(prompt),
          object : MessageCallback {
            override fun onMessage(message: Message) {
              if (!stopping.get()) onText(message.toString())
            }
            override fun onDone() {
              finished.complete(Unit)
            }
            override fun onError(throwable: Throwable) {
              finished.completeExceptionally(throwable)
            }
          },
          emptyMap()
        )
        started = true
        finished.await()
      }
    } catch (e: CancellationException) {
      // Also thrown for a native kCancelled we did not request; only drain
      // when this coroutine itself was cancelled after native started.
      if (started && !currentCoroutineContext().isActive) {
        stopping.set(true)
        withContext(NonCancellable) {
          runCatching { conv.cancelProcess() }
          val drained = withTimeoutOrNull(CANCEL_DRAIN_TIMEOUT_MS) { finished.join() }
          if (drained == null) {
            android.util.Log.w(
              "ExpoAiKit",
              "LiteRT-LM did not stop within ${CANCEL_DRAIN_TIMEOUT_MS}ms of cancelProcess()"
            )
          }
        }
      }
      throw e
    }
  }

  /**
   * Generate a complete response. Blocks until done.
   * The mutex ensures this cannot run concurrently with load/unload.
   */
  suspend fun generateText(turns: List<ChatTurn>, systemPrompt: String): String = mutex.withLock {
    val (conv, prompt) = freshConversation(turns, systemPrompt)

    try {
      val result = StringBuilder()
      var previousText = ""
      runInference(conv, prompt) { messageText ->
        // LiteRT-LM may deliver accumulated text or delta tokens
        // (observed: deltas on-device), detect which, exactly like
        // generateTextStream, so the final text isn't just the last chunk.
        if (messageText.startsWith(previousText) && messageText.length >= previousText.length) {
          result.clear()
          result.append(messageText)
        } else {
          result.append(messageText)
        }
        previousText = result.toString()
      }
      result.toString()
    } catch (e: CancellationException) {
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
    turns: List<ChatTurn>,
    systemPrompt: String,
    onChunk: (token: String, accumulatedText: String, isDone: Boolean) -> Unit
  ) = mutex.withLock {
    val (conv, prompt) = freshConversation(turns, systemPrompt)

    try {
      val accumulatedBuilder = StringBuilder()
      var previousText = ""
      runInference(conv, prompt) { messageText ->
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
      onChunk("", accumulatedBuilder.toString(), true)
    } catch (e: CancellationException) {
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
        LlmModelFiles.modelsDirectory(context).mkdirs()

        DownloadUtil.downloadVerified(
          context = context,
          modelId = modelId,
          url = url,
          targetFile = LlmModelFiles.modelFile(context, modelId),
          tempFile = LlmModelFiles.partialFile(context, modelId),
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

    LlmModelFiles.delete(context, modelId)
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
    return LlmModelFiles.modelFile(context, modelId).exists()
  }

  /**
   * Get the file path for a downloaded model.
   */
  fun getModelFilePath(modelId: String): String {
    return LlmModelFiles.modelFile(context, modelId).absolutePath
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private companion object {
    // Upper bound on waiting for LiteRT-LM to acknowledge cancelProcess().
    // Decoding stops within a token, but a long prefill can run to completion
    // first. Past this bound the inference is abandoned as before.
    const val CANCEL_DRAIN_TIMEOUT_MS = 10_000L
  }
}
