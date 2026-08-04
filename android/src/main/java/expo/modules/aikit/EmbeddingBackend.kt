package expo.modules.aikit

/**
 * Contract between the always-compiled module and the optional EmbeddingGemma
 * backend (android/src/embeddings, compiled only when the androidEmbeddings
 * config-plugin flag adds the MediaPipe tasks-text dependency at prebuild).
 * The implementation is looked up by reflection — see
 * ExpoAiKitModule.embeddingBackend — so this main source set never references
 * MediaPipe classes.
 */
interface EmbeddingBackend {
  /**
   * Embed [texts] with the model at [modelPath], returning one vector per input
   * in input order. [task] is an EmbeddingTask value ('semantic-similarity' |
   * 'retrieval-query' | 'retrieval-document') mapped onto MediaPipe's
   * TextFormatContext. Implementations serialize calls internally (TextEmbedder
   * is not documented as thread-safe).
   */
  suspend fun embed(modelPath: String, texts: List<String>, task: String): List<List<Double>>

  /**
   * Release the loaded embedder (called before the asset file is deleted).
   * Suspends until any in-flight embed finishes — implementations take the same
   * lock as [embed] so the native embedder is never closed mid-inference.
   */
  suspend fun close()
}
