package expo.modules.aikit

/**
 * Contract between the always-compiled module and the optional ML Kit speech
 * backend (android/src/speech, compiled only when the `speech` config-plugin
 * flag adds the genai-speech-recognition dependency at prebuild). The
 * implementation is looked up by reflection, see ExpoAiKitModule.speechBackend
 *, so this main source set never references ML Kit speech classes.
 *
 * All failures use the "CODE:modelId:reason" contract with modelId
 * "mlkit-speech". Locale strings are BCP-47 ('' = device locale); locale
 * SUPPORT is answered by the JS registry (the engine has no enumeration API),
 * the backend only reports device status and the active mode.
 */
interface SpeechBackend {
  /**
   * Device status map for the requested locale ('' = device default):
   * { status: 'available'|'downloadable'|'downloading'|'unavailable',
   *   mode?: 'basic'|'advanced', reason?: string }. Prefers Advanced
   * (Gemini Nano) when it is immediately available, else Basic.
   */
  suspend fun availability(locale: String): Map<String, Any?>

  /**
   * Download the OS-managed speech model for the requested locale ('' = device
   * default) when needed. Progress is 0 at start and 1 on completion (the
   * engine reports bytes downloaded but no total).
   */
  suspend fun prepare(locale: String, onProgress: (Double) -> Unit)

  /**
   * Batch transcription of a local file or base64 payload. Decodes to
   * 16 kHz mono PCM16 and feeds the engine at real-time rate (its documented
   * contract), so wall-clock ≈ audio duration. Returns the transcribe() result
   * map (text, segments: [], language, durationSeconds). Cancellable via
   * coroutine cancellation.
   */
  suspend fun transcribeFile(path: String?, base64: String?, locale: String): Map<String, Any?>

  /**
   * Live microphone session (the engine owns capture). Raw engine updates:
   * partials replace the volatile tail (isFinal=false), finals commit a
   * segment (isFinal=true). onEnd fires when the engine session finishes.
   */
  suspend fun startLive(
    locale: String,
    onUpdate: (text: String, isFinal: Boolean) -> Unit,
    onError: (contract: String) -> Unit,
    onEnd: () -> Unit
  )

  /** Stop the live session; the engine finalizes and onEnd fires. */
  suspend fun stopLive()
}
