# expo-ai-kit — agent guide

On-device AI for Expo & React Native: run LLMs locally (no API keys, no cloud, no cost) across
**Apple Foundation Models** (iOS 26+), **ML Kit** (Android), and downloadable open models
(**Gemma 4**, **Qwen3**, **Phi-4 Mini**; iOS + Android via LiteRT-LM). Streaming, structured output,
tool calling, embeddings & on-device RAG, cancellation, runtime model switching — all on-device.

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
  settles — even on early abort. Anything that runs inference (including `generateObject` and
  `generateText`) must go through this path; don't add a parallel route around it.
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
- `src/tools.ts` — pure helpers for `generateText` tool calling (tools→prompt, tool-call parsing,
  repair/result formatting); reuses `structured.ts`'s JSON extraction + schema validator.
- `src/rag.ts` — pure, dep-free RAG toolkit: `chunkText`, `cosineSimilarity`, and an in-memory
  `createVectorStore` (add / top-k `search` / `toJSON` snapshot). No native import → unit-tested.
  `embed()` itself lives in `index.ts` (it's the one native call).
- `src/models.ts` — downloadable model registry (curated Gemma 4 / Qwen3 / Phi-4: SHA256, RAM
  requirements, download URLs, license) plus runtime "bring your own model" (`registerModel` +
  in-memory custom store, `fetchModelMetadata` to pull SHA/size from HF). Adding a model is
  registry-only — native loads any non-built-in id generically through LiteRT-LM.
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

## Tool / function calling (shipped in 0.7.0)

`generateText(messages, options)` is the same play as `generateObject`: **orchestrated in JS over
`sendMessage`** (`src/tools.ts` holds the pure helpers). It appends a tool instruction to the system
prompt, and the model requests a call by emitting a JSON envelope `{"tool":"<name>","arguments":{…}}`,
which we parse back out of its text (reusing `extractJson`). The loop: parse → validate args against
the tool's `parameters` (reusing `validateAgainstSchema`) → run `execute` → feed the result back →
repeat until the model answers in plain text or `maxSteps` (default 5) is hit. It's deliberately
defensive because on-device models are weak at tool selection: a malformed call, an unknown tool name,
or schema-invalid args are re-prompted up to `maxRepairAttempts` (default 2), then throw
`INFERENCE_FAILED` rather than execute bad input; a thrown `execute` is caught and fed back as
`{ error }`. A tool with **no `execute`** stops the loop with `finishReason: 'tool-calls'` and returns
the proposed call (human-in-the-loop gate). Native constrained decoding can slot in behind the same
signature later (see substrate facts below).

## Embeddings & RAG (0.10.0)

`embed(texts)` (`src/index.ts`) returns `{ embeddings, dimensions }` — one vector per input. It's the
**one native call** of this feature, and it's **iOS-only**: backed by Apple's `NLContextualEmbedding`
(NaturalLanguage, iOS 17+), a zero-download OS-maintained model that mean-pools per-token vectors into
a sentence vector (`ios/ExpoAiKitModule.swift`). This fits the wedge — zero app-size cost, OS-maintained,
and works even where Apple Intelligence isn't enabled. Android `embed()` throws `DEVICE_NOT_SUPPORTED`
(JS guards the platform; the Kotlin stub mirrors the error contract). **EmbeddingGemma was the original
plan but isn't wireable** — the vendored LiteRT-LM C bindings expose only generation, no embedding entry
point — so Android's real path is MediaPipe Text Embedder (a follow-up). `embed()` is deliberately
**outside the single-flight `INFERENCE_BUSY` guard** (embeddings don't use the generation KV-cache).

The retrieval **toolkit lives in `src/rag.ts`** — pure, dep-free, unit-tested, both platforms, and works
with **any** vector source (built-in `embed`, a cloud embedder, your own module): `chunkText` (overlapping,
sentence-aware splitting), `cosineSimilarity` (magnitude-invariant), and `createVectorStore` (in-memory;
`add`/`addMany`/`search` top-k with `minScore`/`toJSON` snapshot). The store does a linear scan per search
(fine at on-device scale) and owns no I/O — persistence is the caller's (`toJSON()` → AsyncStorage/disk →
`createVectorStore(snapshot)`).

## Downloadable models & bring-your-own (0.8.0 / 0.9.0)

`src/models.ts` is the single source of truth for downloadable models — adding one needs **no native
change** (the native layer loads any non-built-in id generically via LiteRT-LM). **0.8.0** grew the
curated registry into a size ladder across families — Gemma 4 E2B/E4B, Qwen3 0.6B/1.7B/4B, Phi-4 Mini —
each entry carrying a pinned SHA256, conservative RAM/context defaults, and a `license` field now
surfaced on `DownloadableModel`. **0.9.0** opened it up: `registerModel(entry)` adds a custom model at
runtime (in-memory store; re-register on each launch — the on-disk file persists, keyed by id), still
integrity-checked against the dev-supplied `sha256`. `fetchModelMetadata(url)` pulls `{ sha256, sizeBytes }`
from a HuggingFace resolve URL (dev-time convenience — pin the hash for a real supply-chain guarantee;
it otherwise only catches transit corruption). `validateModelEntry` / `parseHuggingFaceUrl` are the
pure, unit-tested building blocks. Curated + native ids are reserved; `registerModel` rejects collisions.

## Roadmap / strategic direction

**Positioning (the wedge):** Expo-first install + **OS-native models** (Apple FM + ML Kit: zero
download, zero app-size bloat, OS-maintained) + robust model management. Don't try to out-breadth
`react-native-executorch` (Stable Diffusion, CV models, Whisper/Kokoro, etc.) — lean into the
zero-download OS path that ExecuTorch-based libraries structurally cannot offer.

- **Done:** structured output — `generateObject` (0.6.0); tool / function calling — `generateText`
  (0.7.0); expanded model registry — Qwen3 + Phi-4 Mini, `license` field (0.8.0); bring-your-own-model
  — `registerModel` / `fetchModelMetadata` (0.9.0); embeddings & on-device RAG — `embed` (iOS) +
  `chunkText`/`cosineSimilarity`/`createVectorStore` toolkit (0.10.0).
- **Next (Tier 1) — open follow-up, do when there's time:** Android `embed()` via MediaPipe Text
  Embedder. `embed()` shipped iOS-only in 0.10.0, so this is the known cross-platform gap to close.
  Why MediaPipe: EmbeddingGemma can't ride the vendored LiteRT-LM bindings (they expose only
  generation — see the embeddings section), and Android has no zero-download OS embedder like Apple's
  `NLContextualEmbedding`. The JS toolkit (`chunkText`/`cosineSimilarity`/`createVectorStore`) and the
  `embed()` signature already work on both platforms, so this is purely the Android native side: add the
  MediaPipe Text Embedder dep, wire an `embed` `AsyncFunction` in the Kotlin module (replacing the
  current `DEVICE_NOT_SUPPORTED` stub), and drop the iOS-only platform guard in `src/index.ts#embed`.
- **Tier 2:** stateful session with KV-cache reuse (perf/battery win); vision input; voice (ASR/TTS).
- **Tier 3:** Vercel AI SDK provider; download hardening (resumable / background / wifi-only).

**Substrate facts that make the roadmap feasible** (verify before relying — checked June 2026):

- LiteRT-LM supports tool/function calling (constrained decoding) and Gemma 3n vision/audio input.
  Tool calling ships in 0.7.0 **JS-orchestrated over `sendMessage`** (`src/tools.ts`); the vendored
  Swift bindings (`ios/Vendor/LiteRTLM/Tool.swift`, `ToolManager.swift`) for *native* constrained
  decoding are still **not wired to the JS API** — they can slot in behind `generateText` later.
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
