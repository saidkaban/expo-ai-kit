const {
  createRunOncePlugin,
  withGradleProperties,
  withInfoPlist,
  withPodfileProperties,
  AndroidConfig,
} = require('expo/config-plugins');
const pkg = require('./package.json');

const LLM_PROP_KEY = 'expoAiKit.llm';
const EMBEDDINGS_PROP_KEY = 'expoAiKit.androidEmbeddings';
const SPEECH_PROP_KEY = 'expoAiKit.speech';
const VISION_PROP_KEY = 'expoAiKit.vision';
const MIN_SDK_PROP_KEY = 'android.minSdkVersion';
// ML Kit GenAI, which the `llm` and `speech` options link, requires API 26.
const REQUIRED_MIN_SDK = 26;
const DEFAULT_MIC_PERMISSION =
  'Allow $(PRODUCT_NAME) to use the microphone for on-device speech recognition';

/**
 * expo-ai-kit config plugin.
 *
 * Every option is off by default: an app compiles and ships only the
 * native code for the options it enables, and the matching JS APIs throw a
 * typed *_NOT_ENABLED error otherwise. Each option writes one gradle property
 * (android/gradle.properties) and, for iOS, one Podfile.properties.json key
 * that the library's build.gradle and podspec read; bare React Native apps set
 * the same keys by hand. Changing an option requires a new native build (dev
 * client / EAS, not OTA).
 *
 * Options:
 * - `llm` (boolean, default `false`): enable text generation, structured
 *   output, tool calling, and the model catalog (sendMessage, streamMessage,
 *   generateObject, generateText, setModel, downloadModel, and the AI SDK
 *   provider). Off by default because it links the LiteRT-LM runtime for
 *   downloadable models (~30 MB of arm64 code on iOS, ~21 MB on Android) and,
 *   on Android, the ML Kit GenAI Prompt API client, which raises minSdkVersion
 *   to 26. On, prebuild writes `expoAiKit.llm` to gradle.properties and
 *   Podfile.properties.json; Android compiles the library's llm source set and
 *   iOS downloads and links the LiteRT-LM xcframework on pod install. Without
 *   the option, isAvailable() is false and the generation, activation, and
 *   download calls throw LLM_NOT_ENABLED. Built-in models (Apple Foundation
 *   Models, ML Kit Prompt API) are OS-provided and add nothing further.
 *
 * - `androidEmbeddings` (boolean, default `false`): compile the Android
 *   embedding backend (EmbeddingGemma 300M via MediaPipe TextEmbedder) into
 *   the app. Off by default, zero bytes added to the APK, and Android
 *   `embed()` throws a typed EMBEDDINGS_NOT_ENABLED error explaining this
 *   flag. On, prebuild writes a gradle property that makes the library's
 *   android/build.gradle add the `com.google.mediapipe:tasks-text` dependency
 *   and compile its embeddings source set (~+25 MB APK on arm64). Enabling
 *   requires a new native build (dev client / EAS, not OTA); the ~184 MB
 *   model itself is downloaded at runtime via `prepareEmbeddingModel()`.
 *   iOS needs no configuration: embeddings ride the OS-managed
 *   NLContextualEmbedding assets.
 *
 * - `speech` (boolean or object, default off): enable on-device speech-to-text.
 *   Off by default because it adds microphone permissions to the app manifest.
 *   On, prebuild:
 *   - Android: writes a gradle property that compiles the library's speech
 *     source set and adds the `com.google.mlkit:genai-speech-recognition`
 *     dependency, adds RECORD_AUDIO to AndroidManifest (the ML Kit speech
 *     engine requires it even for file transcription), and raises
 *     minSdkVersion to 26.
 *   - iOS: adds NSMicrophoneUsageDescription (needed for live transcription
 *     only; file transcription needs no permission). Customize the purpose
 *     string with `{ "speech": { "microphonePermission": "..." } }`.
 *   Without the flag, speech APIs throw a typed SPEECH_NOT_ENABLED error.
 *
 * - `vision` (boolean or array of feature names, default `false`): enable
 *   on-device vision on Android. `true` compiles every feature:
 *   removeBackground() (ML Kit Subject Segmentation), labelImage() (ML Kit
 *   Image Labeling, bundled model), detectFaces() (ML Kit Face Detection,
 *   bundled model), and recognizeText() (ML Kit Text Recognition v2). An
 *   array such as `["face-detection"]` compiles only those features, so an
 *   app pays only for the ML Kit clients and bundled models it uses; the
 *   valid names are "background-removal", "image-labeling",
 *   "text-recognition", and "face-detection". Off by default. On, prebuild
 *   writes the `expoAiKit.vision` gradle property (`true` or the
 *   comma-separated list); the library's build.gradle adds one dependency
 *   set and one source set per feature. The segmentation and OCR models are
 *   Google Play services modules downloaded once at runtime by
 *   prepareVision(). A feature that is not compiled in reports
 *   `{ status: 'unavailable', reason: 'not-enabled' }` and its function throws
 *   VISION_NOT_ENABLED. iOS needs no configuration: the Vision framework ships
 *   with the OS (no permissions are added, the app reads image files it
 *   already has access to).
 *
 * Usage in app.json / app.config.js:
 *   "plugins": [["expo-ai-kit", { "llm": true, "speech": true, "vision": true, "androidEmbeddings": true }]]
 *   "plugins": [["expo-ai-kit", { "vision": ["face-detection"] }]]
 */
const VISION_FEATURES = ['background-removal', 'image-labeling', 'text-recognition', 'face-detection'];

/** `true`, or the comma-separated feature list, or null when vision is off. */
function resolveVisionProperty(value) {
  if (value === true) return 'true';
  if (!Array.isArray(value)) return null;
  const unknown = value.filter((f) => !VISION_FEATURES.includes(f));
  if (unknown.length > 0) {
    throw new Error(
      `expo-ai-kit: unknown vision feature(s) ${JSON.stringify(unknown)}; ` +
        `valid names are ${VISION_FEATURES.map((f) => `"${f}"`).join(', ')}`
    );
  }
  const features = VISION_FEATURES.filter((f) => value.includes(f));
  if (features.length === 0) return null;
  return features.length === VISION_FEATURES.length ? 'true' : features.join(',');
}

/** Raise android.minSdkVersion to the required level. Never lowers it. */
function raiseMinSdk(properties) {
  const existing = properties.find(
    (item) => item.type === 'property' && item.key === MIN_SDK_PROP_KEY
  );
  if (!existing) {
    properties.push({
      type: 'property',
      key: MIN_SDK_PROP_KEY,
      value: String(REQUIRED_MIN_SDK),
    });
  } else if (!(Number(existing.value) >= REQUIRED_MIN_SDK)) {
    existing.value = String(REQUIRED_MIN_SDK);
  }
}

const withExpoAiKit = (config, props = {}) => {
  const llm = props.llm === true;
  const androidEmbeddings = props.androidEmbeddings === true;
  const speech =
    props.speech === true || (typeof props.speech === 'object' && props.speech !== null);
  const vision = resolveVisionProperty(props.vision);
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
        (item.key === LLM_PROP_KEY ||
          item.key === EMBEDDINGS_PROP_KEY ||
          item.key === SPEECH_PROP_KEY ||
          item.key === VISION_PROP_KEY)
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
    if (llm) {
      c.modResults.push(
        {
          type: 'comment',
          value: 'expo-ai-kit: compile the opt-in text backend (ML Kit Prompt API + LiteRT-LM)',
        },
        { type: 'property', key: LLM_PROP_KEY, value: 'true' }
      );
    }
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
    if (vision) {
      c.modResults.push(
        {
          type: 'comment',
          value:
            vision === 'true'
              ? 'expo-ai-kit: compile the opt-in ML Kit vision backend (every feature)'
              : `expo-ai-kit: compile the opt-in ML Kit vision backend (${vision})`,
        },
        { type: 'property', key: VISION_PROP_KEY, value: vision }
      );
    }
    if (llm || speech) {
      raiseMinSdk(c.modResults);
    }
    return c;
  });

  // ios/Podfile.properties.json is read by ExpoAiKit.podspec at pod install.
  // Always visit it so turning the option off removes a stale key.
  config = withPodfileProperties(config, (c) => {
    if (llm) {
      c.modResults[LLM_PROP_KEY] = 'true';
    } else {
      delete c.modResults[LLM_PROP_KEY];
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
module.exports.resolveVisionProperty = resolveVisionProperty;
module.exports.raiseMinSdk = raiseMinSdk;
