package expo.modules.aikit

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Wrapper around MediaPipe LlmInference for Gemma 4 models.
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
  private var llmInference: LlmInference? = null
  private var loadedModelId: String? = null

  @Volatile
  private var isDownloading = false

  // -------------------------------------------------------------------------
  // Model lifecycle
  // -------------------------------------------------------------------------

  /**
   * Load a model into memory. Unloads any previously loaded model first.
   * Caller is responsible for emitting onModelStateChange events.
   */
  suspend fun loadModel(modelId: String, modelPath: String) = mutex.withLock {
    // Unload previous model if different
    if (loadedModelId != null && loadedModelId != modelId) {
      llmInference?.close()
      llmInference = null
      loadedModelId = null
    }

    if (loadedModelId == modelId && llmInference != null) {
      return@withLock // Already loaded
    }

    try {
      val options = LlmInference.LlmInferenceOptions.builder()
        .setModelPath(modelPath)
        .build()
      llmInference = LlmInference.createFromOptions(context, options)
      loadedModelId = modelId
    } catch (e: OutOfMemoryError) {
      llmInference = null
      loadedModelId = null
      throw RuntimeException("INFERENCE_OOM:$modelId:Device does not have enough memory to load model")
    } catch (e: Exception) {
      llmInference = null
      loadedModelId = null
      throw RuntimeException("MODEL_LOAD_FAILED:$modelId:${e.message}")
    }
  }

  /**
   * Unload the current model from memory.
   */
  suspend fun unloadModel() = mutex.withLock {
    llmInference?.close()
    llmInference = null
    loadedModelId = null
  }

  fun getLoadedModelId(): String? = loadedModelId

  fun isModelLoaded(): Boolean = llmInference != null

  // -------------------------------------------------------------------------
  // Inference
  // -------------------------------------------------------------------------

  /**
   * Generate a complete response. Blocks until done.
   * The mutex ensures this cannot run concurrently with load/unload.
   */
  suspend fun generateText(prompt: String, systemPrompt: String): String = mutex.withLock {
    val inference = llmInference
      ?: throw RuntimeException("MODEL_NOT_DOWNLOADED:${loadedModelId ?: "unknown"}:No model loaded")

    val fullPrompt = buildFullPrompt(prompt, systemPrompt)

    try {
      withContext(Dispatchers.IO) {
        inference.generateResponse(fullPrompt)
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
   * MediaPipe's generateResponseAsync passes accumulated text in its partial result
   * listener, so we diff against previousText to extract the delta token.
   *
   * We use a CompletableDeferred to keep the mutex held until streaming completes,
   * preventing concurrent load/unload during active inference.
   */
  suspend fun generateTextStream(
    prompt: String,
    systemPrompt: String,
    onChunk: (token: String, accumulatedText: String, isDone: Boolean) -> Unit
  ) = mutex.withLock {
    val inference = llmInference
      ?: throw RuntimeException("MODEL_NOT_DOWNLOADED:${loadedModelId ?: "unknown"}:No model loaded")

    val fullPrompt = buildFullPrompt(prompt, systemPrompt)

    try {
      withContext(Dispatchers.IO) {
        val completion = CompletableDeferred<String>()
        var previousText = ""

        // MediaPipe streaming: generateResponseAsync calls the listener with
        // accumulated text (not deltas). We normalize to match PromptApiClient's
        // (token=delta, accumulatedText=full, isDone) contract.
        inference.generateResponseAsync(fullPrompt) { partialResult, done ->
          val accumulated = partialResult ?: ""
          val token = if (accumulated.length > previousText.length) {
            accumulated.substring(previousText.length)
          } else {
            ""
          }
          previousText = accumulated
          onChunk(token, accumulated, done)

          if (done) {
            completion.complete(accumulated)
          }
        }

        // Wait until streaming finishes so the mutex stays held
        completion.await()
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

        val targetFile = File(modelsDir, "$modelId.gguf")
        val tempFile = File(modelsDir, "$modelId.gguf.tmp")

        try {
          val connection = URL(url).openConnection() as HttpURLConnection
          connection.connectTimeout = 30_000
          connection.readTimeout = 30_000
          connection.connect()

          if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IOException("HTTP ${connection.responseCode}: ${connection.responseMessage}")
          }

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
      llmInference?.close()
      llmInference = null
      loadedModelId = null
    }

    val modelFile = File(context.filesDir, "models/$modelId.gguf")
    if (modelFile.exists()) {
      modelFile.delete()
    }
    // Also clean up any partial downloads
    val tempFile = File(context.filesDir, "models/$modelId.gguf.tmp")
    if (tempFile.exists()) {
      tempFile.delete()
    }
  }

  /**
   * Check if a model file exists on disk.
   */
  fun isModelFileDownloaded(modelId: String): Boolean {
    return File(context.filesDir, "models/$modelId.gguf").exists()
  }

  /**
   * Get the file path for a downloaded model.
   */
  fun getModelFilePath(modelId: String): String {
    return File(context.filesDir, "models/$modelId.gguf").absolutePath
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
