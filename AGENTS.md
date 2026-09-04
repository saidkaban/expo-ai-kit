# expo-ai-kit, agent guide

This file contains repository-specific working rules. Public API usage belongs in `README.md`,
release history in `CHANGELOG.md`, and implementation details in source comments and tests. Do not
duplicate those records here.

`expo-ai-kit` provides on-device AI for Expo and React Native as a set of capabilities, currently
text generation, speech-to-text, vision (background removal, image labels, OCR), and embeddings,
across Apple Foundation Models, Apple SpeechAnalyzer, Apple Vision, ML Kit (Prompt API, GenAI Speech
Recognition, Vision), and downloadable or custom LiteRT-LM models on iOS and Android. Developer-facing
material (README, docs site, npm metadata, `llms.txt`) presents the capabilities in that order and
never hard-codes their count; a new capability gets its own group in each of those places.

## Build, test, and publish

- `npm run build`, compile `src/` to `build/`.
- `npm test`, run Jest tests. Pure TypeScript logic is tested directly; behavior that reaches the
  native module is tested with `jest.mock('../ExpoAiKitModule')` and a mocked `react-native`
  (see `src/__tests__/inference.test.ts`). Real native behavior is verified by CI platform builds
  and on-device gates.
- `npm run lint`, run ESLint using the flat config in `eslint.config.js`.
- CI routes by changed path: `docs/`-only changes run the docs checks; other changes run Node tests and
  the Android/Kotlin and iOS/Swift builds; mixed changes run both. Native changes are not verified by
  the Node job alone.
- The tracked source under `example/` is the native CI fixture. Its generated `ios/`, `android/`,
  `.expo/`, and `node_modules/` directories are disposable and must remain untracked.
- Version, publish, tag, or push only when explicitly requested. The publish scripts require a clean
  tree and run `npm version` followed by `npm publish`; `prepublishOnly` performs the one-shot build.
  Do not prepend `npm run build`, because `expo-module build` may enter watch mode in an interactive
  terminal. Push version tags with `git push --follow-tags` only when requested.

## Architecture contracts

These describe the current public architecture, not immutable doctrine. Change one deliberately, with
the corresponding API decision, implementation, tests, and documentation, rather than bypassing it as
a side effect of unrelated work.

- **Zero runtime dependencies.** Keep `package.json#dependencies` empty. Development and optional peer
  dependencies do not change this rule.
- **Single-flight generation.** `sendMessage` and `streamMessage` share one generation guard and reject
  overlap with `INFERENCE_BUSY`. Any higher-level generation API must use that guarded path or the same
  guard; do not introduce an uncoordinated native inference route.
- **Existing message APIs are stateless.** Callers pass the complete history to every `sendMessage` or
  `streamMessage` call, so LiteRT-LM creates a fresh native conversation for each call. Reusing a global
  conversation here would duplicate history and mix unrelated or branched calls. Conversation and
  KV-cache reuse should be introduced through an explicit stateful-session API that owns an isolated
  lifecycle and accepts incremental turns.
- **Native errors are typed across the bridge.** Native failures use `CODE:modelId:reason`; JS parses
  them into `ModelError`. Keep native codes, `parseNativeErrorMessage`, and the `ModelErrorCode` union
  synchronized, including wrapped Expo exceptions.
- **Model activation is centralized.** `setModel` validates and activates built-in, downloadable, and
  custom models. Native code routes built-ins versus LiteRT-LM models at call time; generation should
  not maintain a second model-validity policy.
- **Embeddings are independent of generation.** `embed()` does not use the generation single-flight
  guard and never downloads a model implicitly. Persisted vectors are compatible only when their model
  identities match exactly.
- **Speech is opt-in and independent.** The config plugin's `speech` flag compiles the Android speech
  backend (reflection-resolved, like embeddings) and adds microphone permissions; without it, speech
  APIs throw `SPEECH_NOT_ENABLED`. Speech has its own single-flight (`SPEECH_BUSY`) and never touches
  the generation guard. Native layers forward raw engine updates (with an `error` event channel); the
  JS layer assembles transcripts. Android's engine ingests non-mic audio at real-time rate by
  contract and requires `RECORD_AUDIO` even for file input.
- **Vision is opt-in on Android and independent.** The config plugin's `vision` flag compiles the
  Android ML Kit vision backend (reflection-resolved, like embeddings and speech) and adds no
  permissions; without it, Android vision APIs throw `VISION_NOT_ENABLED` and availability reports
  `not-enabled`. iOS always compiles the Vision client. `prepareVision()` is the only vision call
  that downloads (Google Play services models); `removeBackground`/`recognizeText` throw
  `MODEL_NOT_DOWNLOADED` instead of downloading. Vision never holds the generation or speech
  guards. Cutouts are written to the app cache and returned as `file://` URIs, pixel buffers do
  not cross the bridge. Coordinates in results are normalized (origin top-left, 0–1).
- **The AI SDK provider preserves core behavior.** `src/ai/` must stay a thin adapter over the public
  inference and embedding primitives. Imports from `@ai-sdk/provider` must remain type-only so the
  zero-runtime-dependency contract holds.

## Design preference

Prefer small, composable primitives over framework layers or convenience APIs with hidden state.
React hooks, prompt frameworks, or chat-memory abstractions require an explicit product decision; this
preference is not a ban on a well-designed stateful-session primitive.

## Code map

- `src/index.ts`, public API, native calls, model lifecycle, error normalization, and generation guard.
- `src/types.ts`, public types and backend capability contracts.
- `src/structured.ts`, `src/tools.ts`, `src/rag.ts`, `src/embedding.ts`, `src/errors.ts`,
  `src/speech.ts`, `src/vision.ts`, and `src/thinking.ts`, pure logic with Jest coverage.
- `src/ai/`, Vercel AI SDK adapter; `ai.js` and `ai.d.ts` are its package-root shims.
- `src/models.ts`, downloadable/custom model registry and Android embedding-model pins.
- `app.plugin.js`, Expo config plugin: opt-in Android embeddings, opt-in speech (permissions +
  conditional native source set), and opt-in Android vision (conditional native source set).
- `ios/` and `android/`, native backends and model/asset lifecycle code; speech lives in
  `ios/SpeechRecognitionClient.swift` and the conditionally compiled `android/src/speech/`; vision in
  `ios/VisionClient.swift` and the conditionally compiled `android/src/vision/`.
- `docs/`, the Next.js documentation site (`docs/lib/navigation.ts` is the sidebar and search
  index, grouped by capability). `docs/public/llms.txt` is the agent-facing summary.
- `example/`, tracked development and CI fixture, not part of the published package.

## Change checklist

- Preserve unrelated work and keep the runtime dependency list empty.
- Add or update pure tests when changing parsing, validation, prompting protocols, registries, or other
  TypeScript logic that does not import the native module.
- Keep public types, JS/native payloads, native error codes, and platform implementations synchronized.
- For native changes, run the relevant local platform compilation when available and use CI as the
  authoritative cross-platform gate.
- Run `npm run lint`, `npm run build`, `npm test`, and `git diff --check` in proportion to the change.

## Current roadmap

Keep exactly one roadmap item active. Do not start or add a later item while it is active.

- **Next:** _(none, awaiting the maintainer's next item)_

When the item is complete, clear the `Next` value, report completion, and ask the maintainer for exactly
one next item. Do not retain completed items or release history in this section.
