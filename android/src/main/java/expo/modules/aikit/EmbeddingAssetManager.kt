package expo.modules.aikit

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * On-disk lifecycle of the EmbeddingGemma model asset (download / status /
 * delete).
 *
 * Deliberately separate from the generation-model store: the asset lives in
 * files/embeddings (not files/models), so it is invisible to setModel() and
 * getDownloadableModels(), it is an embedding asset, not a generation model.
 * The URL and SHA-256 are pinned in JS (src/models.ts, ANDROID_EMBEDDING_MODEL)
 * and passed in, matching the downloadModel(url, sha256) convention.
 *
 * No MediaPipe imports, this class is always compiled. Only the TextEmbedder
 * wrapper behind [EmbeddingBackend] is gated by the androidEmbeddings
 * config-plugin flag.
 *
 * embed() itself never downloads: [download] is only reached from
 * prepareEmbeddingModel().
 */
class EmbeddingAssetManager(private val context: Context) {

  companion object {
    const val EMBEDDING_MODEL_ID = "embedding-gemma-300m"

    /** Output dimensionality of the pinned EmbeddingGemma bundle. */
    const val EMBEDDING_DIMENSIONS = 768
  }

  @Volatile
  private var isDownloading = false

  @Volatile
  private var cancelRequested = false

  private fun assetsDir(): File = File(context.filesDir, "embeddings")

  fun modelFile(): File = File(assetsDir(), "$EMBEDDING_MODEL_ID.task")

  private fun tempFile(): File = File(assetsDir(), "$EMBEDDING_MODEL_ID.task.tmp")

  /**
   * True only for a fully verified, atomically installed asset, a .tmp from a
   * partial or cancelled download never counts (fails closed).
   */
  fun isDownloaded(): Boolean = modelFile().exists()

  fun status(): String = when {
    isDownloading -> "downloading"
    isDownloaded() -> "downloaded"
    else -> "not-downloaded"
  }

  /**
   * Download the pinned bundle: stream to a temp file, verify [sha256],
   * atomically rename into place (shared [DownloadUtil] mechanics). Idempotent
   * when the verified asset is already installed.
   */
  suspend fun download(url: String, sha256: String, onProgress: (bytesRead: Long, totalBytes: Long) -> Unit) {
    if (isDownloaded()) return
    if (isDownloading) {
      throw RuntimeException("DOWNLOAD_FAILED:$EMBEDDING_MODEL_ID:Download already in progress")
    }
    isDownloading = true
    cancelRequested = false

    try {
      withContext(Dispatchers.IO) {
        assetsDir().mkdirs()
        DownloadUtil.downloadVerified(
          context = context,
          modelId = EMBEDDING_MODEL_ID,
          url = url,
          targetFile = modelFile(),
          tempFile = tempFile(),
          sha256 = sha256,
          isCancelled = { cancelRequested },
          onProgress = onProgress
        )
      }
    } finally {
      isDownloading = false
    }
  }

  /**
   * Request cancellation of the in-flight download, if any. The download loop
   * checks this flag and throws DOWNLOAD_CANCELLED (deleting the partial file).
   */
  fun cancelDownload() {
    cancelRequested = true
  }

  /** Delete the installed asset and any partial download. */
  fun delete() {
    modelFile().delete()
    tempFile().delete()
  }
}
