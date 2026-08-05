import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

import {
  BuiltInModel,
  DownloadableModelStatus,
  EmbeddingModelAssetStatus,
  EmbeddingModelState,
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
  ModelDownloadProgressEvent,
  ModelStateChangeEvent,
} from './types';

export type ExpoAiKitModuleEvents = {
  onStreamToken: (event: LLMStreamEvent) => void;
  onDownloadProgress: (event: ModelDownloadProgressEvent) => void;
  onModelStateChange: (event: ModelStateChangeEvent) => void;
};

/** Generation parameters passed to native. All fields optional; -1 / absent means "unset". */
export type NativeGenerationConfig = {
  temperature?: number;
  topK?: number;
  topP?: number;
  seed?: number;
  maxTokens?: number;
};

export interface ExpoAiKitNativeModule {
  // Existing inference API
  isAvailable(): boolean;
  // sessionId lets stopStreaming() cancel an in-flight (non-streaming) generation too.
  sendMessage(
    messages: LLMMessage[],
    systemPrompt: string,
    sessionId: string
  ): Promise<LLMResponse>;
  startStreaming(messages: LLMMessage[], systemPrompt: string, sessionId: string): Promise<void>;
  // Cancels either a streaming session or a sendMessage session by id.
  stopStreaming(sessionId: string): Promise<void>;

  // Embeddings. iOS: Apple NLContextualEmbedding — `language` selects the
  // script model, `task` is accepted as semantic intent only, and the result
  // carries the resolved Apple model identity. Android: EmbeddingGemma via
  // MediaPipe TextEmbedder — `task` maps onto TextFormatContext, `language` is
  // ignored (natively multilingual), no `model` in the native result (the JS
  // layer attaches the pinned identity). Web never reaches native (JS guard).
  embed(
    texts: string[],
    task: string,
    language: string
  ): Promise<{
    embeddings: number[][];
    dimensions: number;
    model?: { id: string; revision: string };
  }>;

  // Embedding model asset lifecycle. iOS returns the full state (identity is
  // native — it varies with `language`); Android returns just the status
  // string and the JS layer attaches the pinned size/identity.
  getEmbeddingModelStatus(
    language: string
  ): Promise<EmbeddingModelState | EmbeddingModelAssetStatus>;
  // iOS ignores url/sha256 (OS-managed assets, fetched per language model);
  // Android ignores language and downloads the pinned Google-hosted bundle.
  prepareEmbeddingModel(url: string, sha256: string, language: string): Promise<void>;
  // Cancels the in-flight Android embedding download (no-op on iOS/none in flight).
  cancelEmbeddingModelDownload(): Promise<void>;
  // Deletes the Android embedding asset from disk (no-op on iOS — OS-managed).
  deleteEmbeddingModel(): Promise<void>;
  // iOS: union of languages across the NLContextualEmbedding catalog. Only
  // called on iOS — the JS layer answers [] elsewhere.
  getSupportedEmbeddingLanguages(): Promise<string[]>;

  // Model discovery
  getBuiltInModels(): BuiltInModel[];
  // Async: iOS reads actor-isolated state (so it bridges as a Promise); Android
  // returns synchronously. Callers must await — see getDownloadableModels.
  getDownloadableModelStatus(modelId: string): Promise<DownloadableModelStatus>;
  getDeviceRamBytes(): number;

  // Model selection & memory management
  // setModel is async: switching to a downloadable model loads it into memory.
  // Auto-unloads the previous downloadable model (only one loaded at a time).
  // `generation` carries best-effort sampling defaults for the session.
  setModel(
    modelId: string,
    minRamBytes: number,
    backend: string,
    generation: NativeGenerationConfig
  ): Promise<void>;
  getActiveModel(): string;
  // Explicitly free memory from the loaded downloadable model.
  // Reverts to the platform built-in model.
  unloadModel(): Promise<void>;

  // Model lifecycle (downloadable models only)
  downloadModel(modelId: string, url: string, sha256: string): Promise<void>;
  // Cancels an in-flight download for the given model (no-op if none).
  cancelDownload(modelId: string): Promise<void>;
  deleteModel(modelId: string): Promise<void>;

  // Event subscription
  addListener<K extends keyof ExpoAiKitModuleEvents>(
    eventName: K,
    listener: ExpoAiKitModuleEvents[K]
  ): EventSubscription;
}

const ExpoAiKitModule = requireNativeModule<ExpoAiKitNativeModule>('ExpoAiKit');

export default ExpoAiKitModule;
