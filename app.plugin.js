const { createRunOncePlugin, withGradleProperties } = require('expo/config-plugins');
const pkg = require('./package.json');

const GRADLE_PROP_KEY = 'expoAiKit.androidEmbeddings';

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
 *
 * iOS needs no configuration: embeddings ride the OS-managed
 * NLContextualEmbedding assets.
 *
 * Usage in app.json / app.config.js:
 *   "plugins": [["expo-ai-kit", { "androidEmbeddings": true }]]
 */
const withExpoAiKit = (config, props = {}) => {
  const androidEmbeddings = props.androidEmbeddings === true;
  return withGradleProperties(config, (c) => {
    // Drop any stale entry first so toggling the option off actually disables
    // the backend on the next prebuild.
    c.modResults = c.modResults.filter(
      (item) => !(item.type === 'property' && item.key === GRADLE_PROP_KEY)
    );
    if (androidEmbeddings) {
      c.modResults.push(
        {
          type: 'comment',
          value: 'expo-ai-kit: compile the opt-in EmbeddingGemma embedding backend',
        },
        { type: 'property', key: GRADLE_PROP_KEY, value: 'true' }
      );
    }
    return c;
  });
};

module.exports = createRunOncePlugin(withExpoAiKit, pkg.name, pkg.version);
