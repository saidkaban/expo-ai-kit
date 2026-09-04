package expo.modules.aikit

/**
 * Contract between the always-compiled module and the optional ML Kit vision
 * backend (android/src/vision, compiled only when the `vision` config-plugin
 * flag adds the ML Kit dependencies at prebuild). The implementation is looked
 * up by reflection, see ExpoAiKitModule.visionBackend, so this main source
 * set never references ML Kit vision classes.
 *
 * All failures use the "CODE:modelId:reason" contract with modelId
 * "mlkit-vision". Image inputs are `file://` / `content://` URIs or absolute
 * paths. Cutouts are written to the app cache and returned as `file://` URIs so
 * no pixel data crosses the bridge.
 */
interface VisionBackend {
  /**
   * Per-feature availability map:
   * { backgroundRemoval | imageLabeling | textRecognition:
   *     { status: 'available'|'downloadable'|'downloading'|'unavailable', reason?: String } }.
   * Segmentation and OCR are Google Play services modules ('downloadable'
   * until prepare() installs them); the label model is bundled with the app.
   */
  suspend fun availability(): Map<String, Any?>

  /**
   * Install the Play services modules for [features] ('background-removal',
   * 'text-recognition'; 'image-labeling' needs nothing). [languages] are
   * normalized BCP-47 tags selecting the OCR script models (empty = Latin).
   * Progress is 0..1.
   */
  suspend fun prepare(features: List<String>, languages: List<String>, onProgress: (Double) -> Unit)

  /**
   * Subject cutout → removeBackground() result map (uri, sizes, bounds,
   * metrics, maskUri when [includeMask]). [subjectX]/[subjectY] are normalized
   * (-1 = unset) and keep only the subject under that point.
   */
  suspend fun removeBackground(
    uri: String,
    trim: Boolean,
    format: String,
    quality: Double,
    maxPixels: Int,
    subjectX: Double,
    subjectY: Double,
    includeMask: Boolean
  ): Map<String, Any?>

  /** Ranked labels: [{ label, confidence }], highest confidence first. */
  suspend fun labelImage(uri: String, maxResults: Int, minConfidence: Double): List<Map<String, Any?>>

  /** OCR → { text, blocks: [{ text, bounds, lines, language?, cornerPoints? }] }. */
  suspend fun recognizeText(uri: String, languages: List<String>, minTextHeight: Double): Map<String, Any?>
}
