const {
  createRunOncePlugin,
  withGradleProperties,
  withInfoPlist,
  AndroidConfig,
} = require('expo/config-plugins');
const pkg = require('./package.json');

const EMBEDDINGS_PROP_KEY = 'expoAiKit.androidEmbeddings';
const SPEECH_PROP_KEY = 'expoAiKit.speech';
const DEFAULT_MIC_PERMISSION =
  'Allow $(PRODUCT_NAME) to use the microphone for on-device speech recognition';

/**
 * expo-ai-kit config plugin.
 *
 * Options:
 * - `androidEmbeddings` (boolean, default `false`): compile the Android
 *   embedding backend (EmbeddingGemma 300M via MediaPipe TextEmbedder) into
 *   the app. Off by default — zero bytes added to the APK, and Android
 *   `embed()` throws a typed EMBEDDINGS_NOT_ENABLED error explaining this
 *   flag. On, prebuild writes a gradle property that makes the library's
 *   android/build.gradle add the `com.google.mediapipe:tasks-text` dependency
 *   and compile its embeddings source set (~+25 MB APK on arm64). Enabling
 *   requires a new native build (dev client / EAS — not OTA); the ~184 MB
 *   model itself is downloaded at runtime via `prepareEmbeddingModel()`.
 *   iOS needs no configuration: embeddings ride the OS-managed
 *   NLContextualEmbedding assets.
 *
 * - `speech` (boolean or object, default off): enable on-device speech-to-text.
 *   Off by default because it adds microphone permissions to the app manifest.
 *   On, prebuild:
 *   - Android: writes a gradle property that compiles the library's speech
 *     source set and adds the `com.google.mlkit:genai-speech-recognition`
 *     dependency, and adds RECORD_AUDIO to AndroidManifest (the ML Kit speech
 *     engine requires it even for file transcription).
 *   - iOS: adds NSMicrophoneUsageDescription (needed for live transcription
 *     only; file transcription needs no permission). Customize the purpose
 *     string with `{ "speech": { "microphonePermission": "..." } }`.
 *   Without the flag, speech APIs throw a typed SPEECH_NOT_ENABLED error.
 *
 * Usage in app.json / app.config.js:
 *   "plugins": [["expo-ai-kit", { "androidEmbeddings": true, "speech": true }]]
 */
const withExpoAiKit = (config, props = {}) => {
  const androidEmbeddings = props.androidEmbeddings === true;
  const speech =
    props.speech === true || (typeof props.speech === 'object' && props.speech !== null);
  const explicitMicPermission =
    typeof props.speech === 'object' && props.speech !== null
      ? props.speech.microphonePermission
      : undefined;

  config = withGradleProperties(config, (c) => {
    // Drop any stale entries first so toggling an option off actually disables
    // it on the next prebuild.
    c.modResults = c.modResults.filter((item) => {
      if (
        item.type === 'property' &&
        (item.key === EMBEDDINGS_PROP_KEY || item.key === SPEECH_PROP_KEY)
      ) {
        return false;
      }
      // Also drop our comment lines so repeated non-clean prebuilds don't
      // accumulate duplicates.
      if (item.type === 'comment' && item.value.startsWith('expo-ai-kit:')) {
        return false;
      }
      return true;
    });
    if (androidEmbeddings) {
      c.modResults.push(
        {
          type: 'comment',
          value: 'expo-ai-kit: compile the opt-in EmbeddingGemma embedding backend',
        },
        { type: 'property', key: EMBEDDINGS_PROP_KEY, value: 'true' }
      );
    }
    if (speech) {
      c.modResults.push(
        {
          type: 'comment',
          value: 'expo-ai-kit: compile the opt-in ML Kit speech-recognition backend',
        },
        { type: 'property', key: SPEECH_PROP_KEY, value: 'true' }
      );
    }
    return c;
  });

  if (speech) {
    config = AndroidConfig.Permissions.withPermissions(config, [
      'android.permission.RECORD_AUDIO',
    ]);
    config = withInfoPlist(config, (c) => {
      c.modResults.NSMicrophoneUsageDescription =
        explicitMicPermission ??
        c.modResults.NSMicrophoneUsageDescription ??
        DEFAULT_MIC_PERMISSION;
      return c;
    });
  }

  return config;
};

module.exports = createRunOncePlugin(withExpoAiKit, pkg.name, pkg.version);
