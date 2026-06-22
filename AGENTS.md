# expo-ai-kit — agent guide

On-device AI for Expo & React Native: run LLMs locally (no API keys, no cloud, no cost) across
**Apple Foundation Models** (iOS 26+), **ML Kit** (Android), and downloadable **Gemma 4** (E2B/E4B,
iOS + Android via LiteRT-LM). Streaming, structured output, cancellation, runtime model switching —
all on-device.

## Build / test / publish

- `npm run build` — compiles `src/` → `build/` via expo-module-scripts (tsc).
- `npm test` — jest. Tests live in `src/__tests__/` (excluded from the build and the npm tarball).
  Only **pure** logic is testable here — anything importing the native module won't load under jest.
- `npm run lint` — **currently broken**: the repo's `.eslintrc.js` predates ESLint 9, which now wants
  `eslint.config.js`. Pre-existing, not caused by recent changes. Don't be alarmed by the failure.
- Publish: `npm run publish:patch|minor|major` → `npm version X && build && publish`. `npm version`
  needs a clean tree, so commit first. CHANGELOG headings are written for the next version.

## Hard invariants — don't break these

- **Zero runtime dependencies.** `package.json` `dependencies` is empty *by design*. Keep it that way:
  write small dep-free helpers instead of pulling packages.
- **Lean primitives, on purpose.** Prompt helpers, React hooks, and chat-memory were deliberately
  removed in 0.4.0. Add sharp primitives — not sugar or frameworks.
- **Single-flight inference.** A module-level `inferenceInFlight` flag (`src/index.ts`) serializes
  generation: concurrent `sendMessage`/`streamMessage` reject with `INFERENCE_BUSY`. It's set
  synchronously before any `await` (race-free in single-threaded JS) and held until the *native* call
  settles — even on early abort. Anything that runs inference (including `generateObject`) must go
  through this path; don't add a parallel route around it.
- **Stateless models.** Full conversation history is passed every call. Sampling (temperature/topK/…)
  is fixed at `setModel()` time, not per-call — LiteRT-LM builds the sampler at conversation creation.
- **Native error contract.** Native formats failures as `"CODE:modelId:reason"`; the JS layer
  (`toModelError`) parses that into a typed `ModelError` with `.code`/`.modelId`. Keep both sides in
  sync with the `ModelErrorCode` union in `src/types.ts`.
- **Dual routing.** Built-in models (Apple FM / ML Kit — zero download) vs downloadable (Gemma via
  LiteRT-LM) are routed in the native layer at call time. `setModel` is the sole gatekeeper of model
  validity; `sendMessage` never re-checks.

## Layout

- `src/index.ts` — public API (inference + model management), error normalization, single-flight guard.
- `src/types.ts` — all public types. The per-backend `GenerationConfig` capability matrix lives here.
- `src/structured.ts` — pure helpers for `generateObject` (schema→prompt, JSON extraction, validator).
- `src/models.ts` — hardcoded downloadable model registry (SHA256, RAM requirements, download URLs).
- `ios/` — Swift. Apple FM + Gemma via vendored LiteRT-LM (`ios/Vendor/LiteRTLM/`; the C xcframework
  is fetched on `pod install`). `android/` — Kotlin. ML Kit + Gemma via the LiteRT-LM gradle dep.
- `example/` — local dev-harness app. Git-ignored and not published; edits there are for manual testing.

## Structured output (shipped in 0.6.0)

`generateObject(messages, schema, options)` is **orchestrated in JS over `sendMessage`**: it appends a
JSON-Schema instruction to the system prompt, runs the model, extracts JSON from the output (tolerating
surrounding prose and ` ```json ` fences), validates against a pragmatic schema subset, and
repairs-and-retries on a parse/schema mismatch (`maxRepairAttempts`, default 2). Works on all three
backends. This was a deliberate choice over native constrained decoding — it ships safely, is fully
unit-tested, and keeps the call signature stable, so native guided generation can slot in behind the
same function later with no call-site change.

## Roadmap / strategic direction

**Positioning (the wedge):** Expo-first install + **OS-native models** (Apple FM + ML Kit: zero
download, zero app-size bloat, OS-maintained) + robust model management. Don't try to out-breadth
`react-native-executorch` (Stable Diffusion, CV models, Whisper/Kokoro, etc.) — lean into the
zero-download OS path that ExecuTorch-based libraries structurally cannot offer.

- **Done:** structured output — `generateObject` (0.6.0).
- **Next (Tier 1):** tool / function calling; embeddings + on-device RAG (EmbeddingGemma).
- **Tier 2:** stateful session with KV-cache reuse (perf/battery win); vision input; voice (ASR/TTS).
- **Tier 3:** Vercel AI SDK provider; download hardening (resumable / background / wifi-only).

**Substrate facts that make the roadmap feasible** (verify before relying — checked June 2026):

- LiteRT-LM supports tool/function calling (constrained decoding) and Gemma 3n vision/audio input.
  The vendored Swift bindings already ship `ios/Vendor/LiteRTLM/Tool.swift` and `ToolManager.swift` —
  present but **not yet wired to the JS API**.
- Apple Foundation Models support guided generation (`DynamicGenerationSchema`) and a `Tool` protocol
  natively.

**Vercel AI SDK compatibility (decision pending).** Adding an AI-SDK provider is **additive** — a new
export that wraps the same native module; existing functions stay untouched. Ship it as a subpath
export (`expo-ai-kit/ai`) with `@ai-sdk/provider` + `@ai-sdk/provider-utils` as *optional* peer
dependencies (keeps the core zero-dep), or as a separate package. → **minor bump, not a forced 1.0.0**;
reserve 1.0.0 as a deliberate API-stability signal. Caveats: the provider spec is a moving target —
AI SDK 6 uses `LanguageModelV3` (`@ai-sdk/provider` ^3); V2 providers log deprecation warnings.
On-device impedance to document if implemented: per-call sampling (the SDK passes temperature per call,
we fix it at `setModel`), the single-flight `INFERENCE_BUSY` guard, and Apple-executes-tools (so
`maxSteps`/`onStepFinish` won't work, as Callstack's Apple provider documents).
