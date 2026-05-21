/**
 * Hardware backend for on-device model inference.
 *
 * - 'auto': Try GPU first, fall back to CPU (default)
 * - 'gpu': Force GPU — faster (~40-50 tok/s) but needs more memory
 * - 'cpu': Force CPU — slower (~2-5 tok/s) but works on low-RAM devices
 */
export type InferenceBackend = 'auto' | 'gpu' | 'cpu';

/**
 * Options for setModel.
 */
export type SetModelOptions = {
  /** Hardware backend to use for inference. Defaults to 'auto'. */
  backend?: InferenceBackend;
};

/**
 * Role in a conversation message.
 */
export type LLMRole = 'system' | 'user' | 'assistant';

/**
 * A single message in a conversation.
 */
export type LLMMessage = {
  role: LLMRole;
  content: string;
};

/**
 * Options for sendMessage.
 */
export type LLMSendOptions = {
  /**
   * Default system prompt to use if no system message is provided in the messages array.
   * If a system message exists in the array, this is ignored.
   */
  systemPrompt?: string;
};

/**
 * Response from sendMessage.
 */
export type LLMResponse = {
  /** The generated response text */
  text: string;
};

/**
 * Options for streamMessage.
 */
export type LLMStreamOptions = {
  /**
   * Default system prompt to use if no system message is provided in the messages array.
   * If a system message exists in the array, this is ignored.
   */
  systemPrompt?: string;
};

/**
 * Event payload for streaming tokens.
 */
export type LLMStreamEvent = {
  /** Unique identifier for this streaming session */
  sessionId: string;
  /** The token/chunk of text received */
  token: string;
  /** Accumulated text so far */
  accumulatedText: string;
  /** Whether this is the final chunk */
  isDone: boolean;
};

/**
 * Callback function for streaming events.
 */
export type LLMStreamCallback = (event: LLMStreamEvent) => void;


// ============================================================================
// Model Types
// ============================================================================

/**
 * A built-in model provided by the OS (e.g. Apple Foundation Models, ML Kit).
 * These are always available on supported devices -- no download needed.
 */
export type BuiltInModel = {
  /** Unique model identifier (e.g. 'apple-fm', 'mlkit') */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Whether this model is available on the current device/OS */
  available: boolean;
  /** Platform this model is associated with */
  platform: 'ios' | 'android';
  /** Maximum context window in tokens */
  contextWindow: number;
};

/**
 * A downloadable model that the user manages (download, load, delete).
 * These require explicit download before use.
 */
export type DownloadableModel = {
  /** Unique model identifier (e.g. 'gemma-e2b', 'gemma-e4b') */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Parameter count label (e.g. '2.3B') */
  parameterCount: string;
  /** Download file size in bytes */
  sizeBytes: number;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Minimum device RAM in bytes required to run */
  minRamBytes: number;
  /** Whether this device meets the model's minimum RAM requirement */
  meetsRequirements: boolean;
  /** Current lifecycle status */
  status: DownloadableModelStatus;
};

/**
 * Lifecycle status of a downloadable model.
 *
 * - 'not-downloaded': Model file is not on disk
 * - 'downloading': Model file is being downloaded
 * - 'loading': File is on disk, model is being loaded into memory for inference
 * - 'ready': Model is loaded in memory and ready for inference
 */
export type DownloadableModelStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'loading'
  | 'ready';

/**
 * Error codes for model-related operations.
 */
export type ModelErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'MODEL_NOT_DOWNLOADED'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_CORRUPT'
  | 'DOWNLOAD_STORAGE_FULL'
  | 'INFERENCE_OOM'
  | 'INFERENCE_FAILED'
  | 'MODEL_LOAD_FAILED'
  | 'DEVICE_NOT_SUPPORTED';

/**
 * Structured error for model operations.
 */
export class ModelError extends Error {
  code: ModelErrorCode;
  modelId: string;

  constructor(code: ModelErrorCode, modelId: string, message?: string) {
    super(message ?? `${code}: ${modelId}`);
    this.name = 'ModelError';
    this.code = code;
    this.modelId = modelId;
  }
}

/**
 * Event payload for model download progress.
 */
export type ModelDownloadProgressEvent = {
  /** Model being downloaded */
  modelId: string;
  /** Download progress from 0 to 1 */
  progress: number;
};

/**
 * Event payload for model state changes.
 */
export type ModelStateChangeEvent = {
  /** Model whose state changed */
  modelId: string;
  /** New status */
  status: DownloadableModelStatus;
};
