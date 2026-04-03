import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';
import {
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
  BuiltInModel,
  DownloadableModelStatus,
  ModelDownloadProgressEvent,
  ModelStateChangeEvent,
} from './types';

export type ExpoAiKitModuleEvents = {
  onStreamToken: (event: LLMStreamEvent) => void;
  onDownloadProgress: (event: ModelDownloadProgressEvent) => void;
  onModelStateChange: (event: ModelStateChangeEvent) => void;
};

export interface ExpoAiKitNativeModule {
  // Existing inference API
  isAvailable(): boolean;
  sendMessage(
    messages: LLMMessage[],
    systemPrompt: string
  ): Promise<LLMResponse>;
  startStreaming(
    messages: LLMMessage[],
    systemPrompt: string,
    sessionId: string
  ): Promise<void>;
  stopStreaming(sessionId: string): Promise<void>;

  // Model discovery
  getBuiltInModels(): BuiltInModel[];
  getDownloadableModelStatus(modelId: string): DownloadableModelStatus;
  getDeviceRamBytes(): number;

  // Model selection & memory management
  // setModel is async: switching to a downloadable model loads it into memory.
  // Auto-unloads the previous downloadable model (only one loaded at a time).
  setModel(modelId: string): Promise<void>;
  getActiveModel(): string;
  // Explicitly free memory from the loaded downloadable model.
  // Reverts to the platform built-in model.
  unloadModel(): Promise<void>;

  // Model lifecycle (downloadable models only)
  downloadModel(
    modelId: string,
    url: string,
    sha256: string
  ): Promise<void>;
  deleteModel(modelId: string): Promise<void>;

  // Event subscription
  addListener<K extends keyof ExpoAiKitModuleEvents>(
    eventName: K,
    listener: ExpoAiKitModuleEvents[K]
  ): EventSubscription;
}

const ExpoAiKitModule =
  requireNativeModule<ExpoAiKitNativeModule>('ExpoAiKit');

export default ExpoAiKitModule;
