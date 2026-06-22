# Changelog

## 0.6.0

> Headline: **structured output** — `generateObject()` returns a typed object
> validated against a JSON Schema, on every backend. Additive — no breaking changes.

### Added

- **`generateObject(messages, schema, options?)`** — get a typed object back instead of a string. You describe the shape with a JSON Schema; expo-ai-kit appends a strict instruction to the system prompt, runs the on-device model, extracts the JSON from its output (tolerating surrounding prose and ` ```json ` code fences), validates it against the schema, and — on a parse error or schema mismatch — feeds the error back and re-prompts up to `maxRepairAttempts` times (default 2). Returns `{ object, text }`; throws `INFERENCE_FAILED` if no schema-valid JSON is produced after the attempts. Works across Apple Foundation Models, ML Kit, and Gemma.
- **New public types**: `JSONSchema`, `JSONSchemaType`, `GenerateObjectOptions`, `GenerateObjectResult`.

### Notes

- The local validator enforces a pragmatic JSON Schema subset (`type`, `properties`, `required`, `items`, `enum`, type unions) and is intentionally lenient about unknown keywords and extra properties — enough to catch structural mistakes worth re-prompting over. Keep schemas small and shallow; on-device models follow flat shapes far more reliably than deeply nested ones.
- Structured output is orchestrated in the JS layer over `sendMessage`, so it honors the same single-flight inference guard, `systemPrompt`, and `AbortSignal` semantics. This keeps the call signature stable so native constrained decoding (Apple guided generation / LiteRT-LM) can slot in behind it later without changing call sites.

## 0.5.0

> Headline: **downloadable Gemma 4 (E2B / E4B) now runs on iOS**, not just Android,
> via LiteRT-LM. Plus sampling controls, cancellation, and a typed error surface.
> All additive — no breaking changes.

### Added

- **iOS downloadable Gemma 4.** `downloadModel` / `setModel` / `sendMessage` / `streamMessage` now run Gemma 4 E2B and E4B on iOS through LiteRT-LM, alongside the built-in Apple Foundation Model. The LiteRT-LM C xcframework is fetched automatically during `pod install`.
- **`GenerationConfig` sampling controls.** `setModel(id, { generation: { temperature, topK, topP, seed, maxTokens } })` sets per-session sampling. Support is best-effort per backend (see the capability matrix in the `GenerationConfig` docs): Gemma honors temperature/topK/topP[/seed]; Apple FM honors temperature/maxTokens.
- **`getRecommendedModel()`** — returns the most capable downloadable model the device can actually run (e.g. E4B on high-RAM phones, E2B otherwise), or `null`.
- **`cancelDownload(modelId)`** — aborts an in-flight download; the `downloadModel` promise rejects with `DOWNLOAD_CANCELLED`.
- **`AbortSignal` support in `sendMessage`** via `options.signal`. (To truly interrupt a long generation, prefer `streamMessage().stop()`.)
- **New model status `'downloaded'`** — `getDownloadableModelStatus` now distinguishes a file that's on disk but not loaded from one that was never downloaded, so a re-download isn't triggered after an app restart.
- **New `ModelError` codes**: `INFERENCE_BUSY`, `INFERENCE_CANCELLED`, `DOWNLOAD_CANCELLED`, `UNKNOWN`.

### Changed

- **Native errors are normalized to `ModelError`.** Failures thrown by the native layer now surface as a `ModelError` with a reliable `.code` and `.modelId`, instead of a raw string message — so `catch (e) { if (e.code === 'MODEL_NOT_DOWNLOADED') … }` works.
- **Single-flight inference.** Concurrent `sendMessage`/`streamMessage` calls (which would corrupt the shared on-device KV cache) are rejected with `INFERENCE_BUSY` instead of running in parallel.
- **`isAvailable()` is accurate on iOS.** It now reflects `SystemLanguageModel` availability (Apple Intelligence enabled and ready), not merely "iOS 26+".
- **Gemma downloads are integrity-checked.** E2B/E4B registry entries now ship real SHA256 hashes, so a corrupted or truncated download is rejected.
- **Packaging.** Stopped shipping the ~122 MB LiteRT-LM xcframework in the npm tarball — it's downloaded on `pod install` anyway. The package drops to ~68 KB / 43 files.

### Fixed

- **`streamMessage().stop()` no longer hangs.** The returned `promise` now always settles (resolving with the text so far) and the event listener is removed on done/error/stop — previously `stop()` could leave the promise pending forever and leak a subscription. Native now also emits a terminal event on cancellation.
- **iOS `getDownloadableModelStatus` contract.** It is async on iOS (reads actor state); the JS layer now awaits it, so `DownloadableModel.status` is a string rather than an unresolved Promise.

## 0.4.1

### Fixed

- **Packaging: stopped shipping `android/build/` artifacts.** The `files` allowlist in `package.json` included the entire `android` directory, dragging stale native build output (`.dex`/`.jar` files, Kotlin compile caches) into the published tarball. Narrowed it to `android/src` and `android/build.gradle` — the package drops from ~190 files / 1.7 MB to 31 files / 132 KB unpacked.

## 0.4.0

> **Breaking change.** Prompt helpers, smart suggestions, React hooks, and the
> chat-memory utilities have been removed. The core inference and model-management
> APIs are unchanged.

### Removed

- **Prompt helpers** — `summarize`, `translate`, `rewrite`, `extractKeyPoints`, `answerQuestion` and their `stream*` variants.
- **Smart suggestions** — `suggest`, `smartReply`, `autocomplete`, `parseSuggestResponse` and their `stream*` variants.
- **React hooks** (`hooks.ts`) — `useChat`, `useCompletion`, `useOnDeviceAI`, `useModel`, `useAvailableModels`.
- **Chat memory** (`memory.ts`) — `ChatMemoryManager` and `buildPrompt`.
- All associated option/return types (`LLMSummarizeOptions`, `LLMSuggestOptions`, `UseChatOptions`, `ChatMemoryOptions`, etc.).

### Changed

- **README rewritten** — trimmed from 515 to ~130 lines and reorganised for a quick scan. Added a "Downloadable models (Gemma 4)" section documenting the previously undocumented model-management API.

### Migration

Call `sendMessage` / `streamMessage` directly with your own system prompt in place
of the removed helpers. For conversation history, keep your own message array and
pass it on each call. The inference API (`isAvailable`, `sendMessage`,
`streamMessage`) and the model API (`getBuiltInModels`, `getDownloadableModels`,
`downloadModel`, `deleteModel`, `setModel`, `unloadModel`, `getActiveModel`) are
unchanged.

## 0.3.6

### Fixed

- **Android: stopped double-formatting Gemma prompts.** The Gemma path was sending `USER: ...\nASSISTANT:` markers to the LiteRT-LM Conversation API, which already wraps messages in Gemma's turn format internally — producing garbled, badly-spaced output. ML Kit and Gemma paths now format prompts independently (ML Kit keeps role prefixes, Gemma passes raw content). Streaming token extraction is also now robust to both accumulated and delta `onMessage` behavior.

## 0.3.5

### Fixed

- **Android: `accumulatedText` now holds the full text.** Native clients were sending only the latest token as `accumulatedText` in `onStreamToken` events, violating the JS API contract. Tokens are now properly accumulated.

## 0.3.4

### Added

- **`setModel` backend option.** `setModel(id, { backend })` accepts `'auto'` (default — GPU with CPU fallback), `'gpu'`, or `'cpu'`. CPU is slower (~2-5 tok/s) but runs on low-RAM devices where GPU would trigger OOM kills. Added a soft RAM pre-check that logs a warning when available memory is below the model minimum but still attempts the load (LiteRT-LM uses memory-mapped I/O).

### Changed

- **Android: upgraded LiteRT-LM to 0.10.0.** 0.8.0 could not parse the current `.litertlm` model files on Hugging Face (SIGABRT, "Unknown model type"). 0.10.0 supports the current format. Added `-Xskip-metadata-version-check` to bridge the Kotlin metadata mismatch.
- **Lowered `minRamBytes` for Gemma 4 models.** LiteRT-LM memory-maps weights, so real usage is far below file size. E2B: 4GB → 2GB, E4B: 6GB → 3GB. Verified E2B runs on a Samsung A16 (~3GB available) with the CPU backend.

### Fixed

- **Android: Hugging Face model downloads.** `HttpURLConnection` doesn't follow cross-host redirects (`huggingface.co` → `cdn-lfs-us-1.huggingface.co`), so downloaded files could contain garbage. Added manual redirect handling.

## 0.3.3

### Fixed

- **Android: adapted `GemmaInferenceClient` to the LiteRT-LM 0.8.0 API** — `Backend.GPU()` → `Backend.GPU`, and `sendMessage`/`sendMessageAsync` now use `Message.of()` instead of raw strings.

## 0.3.2

### Fixed

- **Android: pinned `litertlm-android` to 0.8.0** for Kotlin 2.1 compatibility. The version range resolved to 0.10.0, which requires Kotlin 2.2+ (metadata 2.3.0) and is incompatible with Expo's Kotlin 2.1 compiler. Also fixed a coroutine overload ambiguity in `unloadModel`.

## 0.3.1

Maintenance release — version bump only, no functional changes.

## 0.3.0

### Changed

- **Android: Migrated from MediaPipe to LiteRT-LM** for downloadable model inference. MediaPipe LLM Inference is deprecated by Google; LiteRT-LM is its successor with better model support, GPU/NPU acceleration, and active development.
- **Model registry updated to `.litertlm` format.** Gemma 4 E2B and E4B models now point to `litert-community/gemma-4-E2B-it-litert-lm` and `gemma-4-E4B-it-litert-lm` on Hugging Face. File sizes updated (2.58GB / 3.65GB).
- **ML Kit bumped to `1.0.0-beta2`** (from `1.0.0-alpha1`) for built-in model support.
- **Downloadable models are Android-only for now.** `supportedPlatforms` narrowed to `['android']`. iOS downloadable model support is planned for when Google ships LiteRT-LM Swift APIs.

### Removed

- `com.google.mediapipe:tasks-genai` dependency (replaced by LiteRT-LM)
- llama.cpp submodule and all C bridge plans (no longer needed)

### Note

iOS continues to work with Apple Foundation Models (iOS 26+). Downloadable model APIs (`downloadModel`, `setModel` with Gemma models) are functional on Android only. On iOS, these throw descriptive "not yet supported" errors — no crashes.

## 0.2.1

### Fixed

- **iOS crash fix**: Added native stubs for all model abstraction API functions (`getBuiltInModels`, `getDownloadableModelStatus`, `getDeviceRamBytes`, `setModel`, `getActiveModel`, `unloadModel`, `downloadModel`, `deleteModel`) to `ExpoAiKitModule.swift`. Without these, any call to the new model APIs would crash on iOS at runtime. Built-in model (`apple-fm`) selection works; downloadable model operations throw descriptive "not yet supported" errors until Phase 3 (llama.cpp) lands.
- **Device capability gating**: Added `meetsRequirements` field to `DownloadableModel` type. `getDownloadableModels()` now checks device RAM and `downloadModel()` rejects downloads on devices that don't meet minimum RAM requirements.

## 0.2.0

### Added

- **Model abstraction layer** with two-tier model system separating built-in (OS-provided) models from downloadable models
  - `BuiltInModel` type for OS-provided models (Apple Foundation Models, ML Kit)
  - `DownloadableModel` type with full lifecycle tracking (`not-downloaded` -> `downloading` -> `loading` -> `ready`)
- **Model registry** (`src/models.ts`) with metadata for Gemma 4 E2B and E4B models (download URL, SHA256, size, context window, min RAM, supported platforms)
- **Model management API**: `getBuiltInModels()`, `getDownloadableModels()`, `downloadModel()`, `deleteModel()`, `setModel()`, `getActiveModel()`, `unloadModel()`
- **React hooks**: `useModel(modelId)` for managing downloadable model lifecycle (status, progress, download, delete) and `useAvailableModels()` for discovering all models
- **`ModelError`** class with typed error codes (`MODEL_NOT_FOUND`, `MODEL_NOT_DOWNLOADED`, `DOWNLOAD_CORRUPT`, `INFERENCE_OOM`, etc.)
- **Context window support** in `ChatMemoryManager`: new `contextWindow` option and `setContextWindow()` method. History is now trimmed by both turn count and token budget (whichever limit is hit first)

### Note

Native backends for downloadable models (MediaPipe, llama.cpp) are not yet implemented. The new TypeScript APIs are available and fully typed, but `setModel()`, `downloadModel()`, and related native calls will throw until native support lands in a future release. Built-in model behavior is unchanged.
