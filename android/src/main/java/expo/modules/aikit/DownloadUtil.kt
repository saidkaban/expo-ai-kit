package expo.modules.aikit

import android.content.Context
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Shared file-download internals for model artifacts, used by both the
 * generation-model store (GemmaInferenceClient) and the embedding asset
 * (EmbeddingAssetManager): manual cross-host redirect following, streaming
 * download to a temp file, SHA-256 verification, and atomic rename into place.
 */
internal object DownloadUtil {

  /**
   * Download [url] into [targetFile] via [tempFile]: stream to the temp file,
   * verify [sha256] (when non-empty), then atomically rename into place. A
   * partial or corrupt download always fails closed, the temp file is deleted
   * and the target is never touched.
   *
   * Throws RuntimeException with the standard "CODE:modelId:reason" contract:
   * DOWNLOAD_CANCELLED (when [isCancelled] flips true), DOWNLOAD_CORRUPT,
   * DOWNLOAD_STORAGE_FULL, DOWNLOAD_FAILED.
   */
  fun downloadVerified(
    context: Context,
    modelId: String,
    url: String,
    targetFile: File,
    tempFile: File,
    sha256: String,
    isCancelled: () -> Boolean,
    onProgress: (bytesRead: Long, totalBytes: Long) -> Unit
  ) {
    try {
      val connection = openConnectionFollowingRedirects(url)

      val totalBytes = connection.contentLengthLong
      var bytesRead = 0L

      connection.inputStream.use { input ->
        FileOutputStream(tempFile).use { output ->
          val buffer = ByteArray(8192)
          var read: Int
          while (input.read(buffer).also { read = it } != -1) {
            if (isCancelled()) {
              throw RuntimeException("DOWNLOAD_CANCELLED:$modelId:Download cancelled")
            }
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
        e is RuntimeException && e.message?.startsWith("DOWNLOAD_CANCELLED") == true -> throw e
        context.filesDir.freeSpace < 100_000_000 ->
          throw RuntimeException("DOWNLOAD_STORAGE_FULL:$modelId:Insufficient disk space")
        else ->
          throw RuntimeException("DOWNLOAD_FAILED:$modelId:${e.message}")
      }
    }
  }

  /**
   * Open an HTTP connection, manually following up to 5 redirects across hosts.
   *
   * HttpURLConnection follows redirects by default but only within the same host.
   * HuggingFace LFS redirects from huggingface.co to cdn-lfs-us-1.huggingface.co,
   * which is a cross-host redirect that HttpURLConnection silently does NOT follow,
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
