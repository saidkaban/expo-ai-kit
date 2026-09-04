package expo.modules.aikit.embeddings

import android.content.Context
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.text.textembedder.TextEmbedder
import expo.modules.aikit.EmbeddingAssetManager
import expo.modules.aikit.EmbeddingBackend
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * EmbeddingGemma 300M via MediaPipe TextEmbedder, 768 dimensions, max
 * sequence 512 tokens (longer inputs are truncated by the tokenizer), CPU.
 *
 * This file lives in the OPTIONAL src/embeddings source set: it is compiled
 * (and the com.google.mediapipe:tasks-text dependency added) only when the app
 * was prebuilt with ["expo-ai-kit", { "androidEmbeddings": true }]. It is
 * instantiated by reflection from ExpoAiKitModule, which is why nothing in the
 * main source set may import it directly.
 *
 * EmbeddingGemma is natively multilingual with a single vector space, there is
 * no per-language model to select, which is why Android accepts and ignores the
 * embed() `language` option.
 */
class EmbeddingGemmaBackend(private val context: Context) : EmbeddingBackend {

  // TextEmbedder is not documented as safe for concurrent use, so load, embed,
  // and close are serialized behind this mutex. Concurrent embed() calls queue
  // here rather than failing, embeddings stay outside the generation
  // INFERENCE_BUSY guard. Batches embed sequentially: order in == order out.
  private val mutex = Mutex()
  private var embedder: TextEmbedder? = null
  private var loadedModelPath: String? = null

  override suspend fun embed(modelPath: String, texts: List<String>, task: String): List<List<Double>> =
    mutex.withLock {
      withContext(Dispatchers.Default) {
        val active = loadOrGet(modelPath)
        val formatContext = formatContextFor(task)
        texts.map { text ->
          if (text.isEmpty()) {
            // No tokens, zero vector, matching iOS, so output stays aligned
            // with input (callers index embeddings[i] by texts[i]).
            List(EmbeddingAssetManager.EMBEDDING_DIMENSIONS) { 0.0 }
          } else {
            embedOne(active, text, formatContext)
          }
        }
      }
    }

  override suspend fun close(): Unit = mutex.withLock {
    embedder?.close()
    embedder = null
    loadedModelPath = null
  }

  private fun embedOne(
    active: TextEmbedder,
    text: String,
    formatContext: TextEmbedder.TextFormatContext
  ): List<Double> {
    val result = try {
      active.embed(text, formatContext)
    } catch (e: Exception) {
      throw RuntimeException(
        "INFERENCE_FAILED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:${e.message}"
      )
    }
    val vector = result.embeddingResult().embeddings().firstOrNull()?.floatEmbedding()
      ?: throw RuntimeException(
        "INFERENCE_FAILED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:TextEmbedder returned no embedding"
      )
    // The 768-finite-values contract: a wrong-size or NaN/Inf vector would
    // silently poison persisted vector stores, so fail loudly instead.
    if (vector.size != EmbeddingAssetManager.EMBEDDING_DIMENSIONS) {
      throw RuntimeException(
        "INFERENCE_FAILED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:" +
          "Expected ${EmbeddingAssetManager.EMBEDDING_DIMENSIONS} dimensions, got ${vector.size}"
      )
    }
    return vector.map { value ->
      val d = value.toDouble()
      if (!d.isFinite()) {
        throw RuntimeException(
          "INFERENCE_FAILED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:Embedding contains a non-finite value"
        )
      }
      d
    }
  }

  /** Load the embedder for [modelPath], reusing it across calls until the path changes. */
  private fun loadOrGet(modelPath: String): TextEmbedder {
    val current = embedder
    if (current != null && loadedModelPath == modelPath) return current
    current?.close()
    embedder = null
    loadedModelPath = null

    val options = TextEmbedder.TextEmbedderOptions.builder()
      .setBaseOptions(BaseOptions.builder().setModelAssetPath(modelPath).build())
      .build()
    val created = try {
      TextEmbedder.createFromOptions(context, options)
    } catch (e: Exception) {
      throw RuntimeException(
        "MODEL_LOAD_FAILED:${EmbeddingAssetManager.EMBEDDING_MODEL_ID}:${e.message}"
      )
    }
    embedder = created
    loadedModelPath = modelPath
    return created
  }

  /**
   * EmbeddingTask → (EmbeddingType, TextRole), per EmbeddingGemma's prompt
   * templates: QUERY roles render "task: <name> | query: <text>", the DOCUMENT
   * role renders "title: none | text: <text>" (no title, by design). This
   * mapping is the 'tfc1' formatContextProtocol pinned in src/models.ts,
   * changing it changes the vectors, so bump the protocol tag if you touch it.
   */
  private fun formatContextFor(task: String): TextEmbedder.TextFormatContext {
    val builder = TextEmbedder.TextFormatContext.builder()
    return when (task) {
      "retrieval-query" -> builder
        .setTaskType(TextEmbedder.EmbeddingType.RETRIEVAL_QUERY)
        .setRole(TextEmbedder.TextRole.QUERY)
        .build()
      "retrieval-document" -> builder
        .setTaskType(TextEmbedder.EmbeddingType.RETRIEVAL_DOCUMENT)
        .setRole(TextEmbedder.TextRole.DOCUMENT)
        .build()
      // 'semantic-similarity' (the default; JS validates the value up front)
      else -> builder
        .setTaskType(TextEmbedder.EmbeddingType.SEMANTIC_SIMILARITY)
        .setRole(TextEmbedder.TextRole.QUERY)
        .build()
    }
  }
}
