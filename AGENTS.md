# expo-ai-kit — agent guide

This file contains repository-specific working rules. Public API usage belongs in `README.md`,
release history in `CHANGELOG.md`, and implementation details in source comments and tests. Do not
duplicate those records here.

`expo-ai-kit` provides on-device AI for Expo and React Native across Apple Foundation Models, ML Kit,
and downloadable or custom LiteRT-LM models on iOS and Android.

## Build, test, and publish

- `npm run build` — compile `src/` to `build/`.
- `npm test` — run Jest tests for pure TypeScript logic. Modules that import the native module cannot
  run under Jest.
- `npm run lint` — run ESLint using the flat config in `eslint.config.js`.
- CI runs build and tests on Node, compiles Android/Kotlin, and builds iOS/Swift. Native changes are not
  verified by the Node job alone.
- The tracked source under `example/` is the native CI fixture. Its generated `ios/`, `android/`,
  `.expo/`, and `node_modules/` directories are disposable and must remain untracked.
- Version, publish, tag, or push only when explicitly requested. The publish scripts require a clean
  tree and run `npm version` followed by `npm publish`; `prepublishOnly` performs the one-shot build.
  Do not prepend `npm run build`, because `expo-module build` may enter watch mode in an interactive
  terminal. Push version tags with `git push --follow-tags` only when requested.

## Architecture contracts

These describe the current public architecture, not immutable doctrine. Change one deliberately—with
the corresponding API decision, implementation, tests, and documentation—rather than bypassing it as
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
- **The AI SDK provider preserves core behavior.** `src/ai/` must stay a thin adapter over the public
  inference and embedding primitives. Imports from `@ai-sdk/provider` must remain type-only so the
  zero-runtime-dependency contract holds.

## Design preference

Prefer small, composable primitives over framework layers or convenience APIs with hidden state.
React hooks, prompt frameworks, or chat-memory abstractions require an explicit product decision; this
preference is not a ban on a well-designed stateful-session primitive.

## Code map

- `src/index.ts` — public API, native calls, model lifecycle, error normalization, and generation guard.
- `src/types.ts` — public types and backend capability contracts.
- `src/structured.ts`, `src/tools.ts`, `src/rag.ts`, `src/embedding.ts`, `src/errors.ts`, and
  `src/thinking.ts` — pure logic with Jest coverage.
- `src/ai/` — Vercel AI SDK adapter; `ai.js` and `ai.d.ts` are its package-root shims.
- `src/models.ts` — downloadable/custom model registry and Android embedding-model pins.
- `app.plugin.js` — Expo config plugin, including optional Android embeddings.
- `ios/` and `android/` — native backends and model/asset lifecycle code.
- `example/` — tracked development and CI fixture, not part of the published package.

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

- **Next:** add on-device speech-to-text (STT) for iOS and Android.

When the item is complete, clear the `Next` value, report completion, and ask the maintainer for exactly
one next item. Do not retain completed items or release history in this section.
