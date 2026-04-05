package expo.modules.aikit

import android.app.ActivityManager
import android.content.Context
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.Contents
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
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

  @Volatile
  private var isDownloading = false

  // -------------------------------------------------------------------------
  // Model lifecycle
  // -------------------------------------------------------------------------

  /**
   * Load a model into memory using LiteRT-LM Engine.
   * Unloads any previously loaded model first.
   * Caller is responsible for emitting onModelStateChange events.
   */
  suspend fun loadModel(modelId: String, modelPath: String, minRamBytes: Long = 0, backend: String = "auto") = mutex.withLock {
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
    // load — Engine.initialize() may still succeed. If it truly OOMs, Android's
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

        val newConversation = newEngine.createConversation(ConversationConfig())

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
   * Generate a complete response. Blocks until done.
   * The mutex ensures this cannot run concurrently with load/unload.
   */
  suspend fun generateText(prompt: String, systemPrompt: String): String = mutex.withLock {
    val conv = conversation
      ?: throw RuntimeException("MODEL_NOT_DOWNLOADED:${loadedModelId ?: "unknown"}:No model loaded")

    val fullPrompt = buildFullPrompt(prompt, systemPrompt)

    try {
      withContext(Dispatchers.IO) {
        suspendCancellableCoroutine<String> { continuation ->
          val result = StringBuilder()
          conv.sendMessageAsync(
            Contents.of(fullPrompt),
            object : MessageCallback {
              override fun onMessage(message: Message) {
                result.clear()
                result.append(message.toString())
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
    val conv = conversation
      ?: throw RuntimeException("MODEL_NOT_DOWNLOADED:${loadedModelId ?: "unknown"}:No model loaded")

    val fullPrompt = buildFullPrompt(prompt, systemPrompt)

    try {
      withContext(Dispatchers.IO) {
        suspendCancellableCoroutine<Unit> { continuation ->
          var previousText = ""
          conv.sendMessageAsync(
            Contents.of(fullPrompt),
            object : MessageCallback {
              override fun onMessage(message: Message) {
                val accumulated = message.toString()
                val token = if (accumulated.length > previousText.length) {
                  accumulated.substring(previousText.length)
                } else {
                  ""
                }
                previousText = accumulated
                onChunk(token, accumulated, false)
              }
              override fun onDone() {
                onChunk("", previousText, true)
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
   * Downloads to a .tmp file, atomically renames on success.
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

    try {
      withContext(Dispatchers.IO) {
        val modelsDir = File(context.filesDir, "models")
        modelsDir.mkdirs()

        val targetFile = File(modelsDir, "$modelId.litertlm")
        val tempFile = File(modelsDir, "$modelId.litertlm.tmp")

        try {
          val connection = openConnectionFollowingRedirects(url)

          val totalBytes = connection.contentLengthLong
          var bytesRead = 0L

          connection.inputStream.use { input ->
            FileOutputStream(tempFile).use { output ->
              val buffer = ByteArray(8192)
              var read: Int
              while (input.read(buffer).also { read = it } != -1) {
                output.write(buffer, 0, read)
                bytesRead += read
                if (totalBytes > 0) {
                  onProgress(bytesRead, totalBytes)
                }
              }
            }
          }

          // Verify SHA256 if provided
          if (sha256.isNotEmpty()) {
            val actualHash = computeSha256(tempFile)
            if (!actualHash.equals(sha256, ignoreCase = true)) {
              tempFile.delete()
              throw RuntimeException("DOWNLOAD_CORRUPT:$modelId:SHA256 mismatch: expected $sha256, got $actualHash")
            }
          }

          // Atomic rename
          if (!tempFile.renameTo(targetFile)) {
            tempFile.delete()
            throw IOException("Failed to rename temp file to target")
          }
        } catch (e: Exception) {
          // Always clean up partial file
          tempFile.delete()
          when {
            e is RuntimeException && e.message?.startsWith("DOWNLOAD_CORRUPT") == true -> throw e
            context.filesDir.freeSpace < 100_000_000 ->
              throw RuntimeException("DOWNLOAD_STORAGE_FULL:$modelId:Insufficient disk space")
            else ->
              throw RuntimeException("DOWNLOAD_FAILED:$modelId:${e.message}")
          }
        }
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

  /**
   * Open an HTTP connection, manually following up to 5 redirects across hosts.
   *
   * HttpURLConnection follows redirects by default but only within the same host.
   * HuggingFace LFS redirects from huggingface.co to cdn-lfs-us-1.huggingface.co,
   * which is a cross-host redirect that HttpURLConnection silently does NOT follow —
   * it returns the 302 response as-is (or on some Android versions, returns a small
   * HTML/error body instead of the actual file). This caused downloaded model files
   * to contain garbage instead of the real model weights.
   */
  private fun openConnectionFollowingRedirects(url: String): HttpURLConnection {
    var currentUrl = url
    var redirects = 0
    while (true) {
      val connection = URL(currentUrl).openConnection() as HttpURLConnection
      connection.connectTimeout = 30_000
      connection.readTimeout = 30_000
      connection.instanceFollowRedirects = false
      connection.connect()

      val code = connection.responseCode
      if (code in listOf(
          HttpURLConnection.HTTP_MOVED_PERM,
          HttpURLConnection.HTTP_MOVED_TEMP,
          HttpURLConnection.HTTP_SEE_OTHER,
          307, 308
        )) {
        val location = connection.getHeaderField("Location")
          ?: throw IOException("Redirect with no Location header")
        connection.disconnect()
        redirects++
        if (redirects > 5) throw IOException("Too many redirects")
        currentUrl = location
        continue
      }

      if (code != HttpURLConnection.HTTP_OK) {
        throw IOException("HTTP $code: ${connection.responseMessage}")
      }
      return connection
    }
  }

  private fun computeSha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { fis ->
      val buffer = ByteArray(8192)
      var read: Int
      while (fis.read(buffer).also { read = it } != -1) {
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
