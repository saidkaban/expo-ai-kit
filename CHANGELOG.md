# Changelog

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
