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
// Prompt Helper Types
// ============================================================================

/**
 * Options for the summarize helper.
 */
export type LLMSummarizeOptions = {
  /**
   * Target length for the summary.
   * @default 'medium'
   */
  length?: 'short' | 'medium' | 'long';
  /**
   * Style of summary to generate.
   * @default 'paragraph'
   */
  style?: 'paragraph' | 'bullets' | 'tldr';
};

/**
 * Options for the translate helper.
 */
export type LLMTranslateOptions = {
  /**
   * Target language to translate to.
   */
  to: string;
  /**
   * Source language (auto-detected if not provided).
   */
  from?: string;
  /**
   * Tone/formality of the translation.
   * @default 'neutral'
   */
  tone?: 'formal' | 'informal' | 'neutral';
};

/**
 * Options for the rewrite helper.
 */
export type LLMRewriteOptions = {
  /**
   * Style to rewrite in.
   */
  style:
    | 'formal'
    | 'casual'
    | 'professional'
    | 'friendly'
    | 'concise'
    | 'detailed'
    | 'simple'
    | 'academic';
};

/**
 * Options for the extractKeyPoints helper.
 */
export type LLMExtractKeyPointsOptions = {
  /**
   * Maximum number of key points to extract.
   * @default 5
   */
  maxPoints?: number;
};

/**
 * Options for the answerQuestion helper.
 */
export type LLMAnswerQuestionOptions = {
  /**
   * How detailed the answer should be.
   * @default 'medium'
   */
  detail?: 'brief' | 'medium' | 'detailed';
};

// ============================================================================
// Smart Suggestions Types
// ============================================================================

/**
 * Options for the suggest helper.
 */
export type LLMSuggestOptions = {
  /**
   * Number of suggestions to generate.
   * @default 3
   */
  count?: number;
  /**
   * Optional context to inform the suggestions (e.g., surrounding text, app context).
   */
  context?: string;
  /**
   * Tone of the suggestions.
   * @default 'neutral'
   */
  tone?: 'formal' | 'casual' | 'professional' | 'friendly' | 'neutral';
};

/**
 * A single suggestion item.
 */
export type LLMSuggestion = {
  /** The suggested text */
  text: string;
};

/**
 * Response from suggest/smartReply containing multiple suggestions.
 */
export type LLMSuggestResponse = {
  /** Array of generated suggestions */
  suggestions: LLMSuggestion[];
  /** Raw response text from the model */
  raw: string;
};

/**
 * Options for the smartReply helper.
 */
export type LLMSmartReplyOptions = {
  /**
   * Number of reply suggestions to generate.
   * @default 3
   */
  count?: number;
  /**
   * Tone of the reply suggestions.
   * @default 'neutral'
   */
  tone?: 'formal' | 'casual' | 'professional' | 'friendly' | 'neutral';
  /**
   * Optional persona/context for the replier (e.g., "customer support agent", "friendly colleague").
   */
  persona?: string;
};

/**
 * Options for the autocomplete helper.
 */
export type LLMAutocompleteOptions = {
  /**
   * Number of completions to generate.
   * @default 3
   */
  count?: number;
  /**
   * Maximum length of each completion in words.
   * @default 10
   */
  maxWords?: number;
  /**
   * Optional context to inform the completions (e.g., what the user is writing about).
   */
  context?: string;
};

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Options for the useChat hook.
 */
export type UseChatOptions = {
  /** System prompt for the AI assistant */
  systemPrompt?: string;
  /** Maximum conversation turns to keep in memory (default: 10) */
  maxTurns?: number;
  /** Initial messages to populate the chat */
  initialMessages?: LLMMessage[];
  /** Callback when a response is complete */
  onFinish?: (response: LLMResponse) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
};

/**
 * Return type for the useChat hook.
 */
export type UseChatReturn = {
  /** All messages in the conversation */
  messages: LLMMessage[];
  /** Current input text value */
  input: string;
  /** Set the input text value */
  setInput: (input: string) => void;
  /** Send the current input (or provided text) as a message */
  sendMessage: (text?: string) => Promise<void>;
  /** Whether the AI is currently streaming a response */
  isStreaming: boolean;
  /** Stop the current streaming response */
  stop: () => void;
  /** Clear all messages and reset the conversation */
  clear: () => void;
  /** The most recent error, if any */
  error: Error | null;
};

/**
 * Options for the useCompletion hook.
 */
export type UseCompletionOptions = {
  /** System prompt for the AI */
  systemPrompt?: string;
  /** Callback when completion is done */
  onFinish?: (response: LLMResponse) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
};

/**
 * Return type for the useCompletion hook.
 */
export type UseCompletionReturn = {
  /** The current completion text */
  completion: string;
  /** Whether a completion is in progress */
  isLoading: boolean;
  /** Request a completion for the given prompt */
  complete: (prompt: string) => Promise<string>;
  /** Stop the current completion */
  stop: () => void;
  /** The most recent error, if any */
  error: Error | null;
};

/**
 * Return type for the useOnDeviceAI hook.
 */
export type UseOnDeviceAIReturn = {
  /** Whether on-device AI is available */
  isAvailable: boolean;
  /** Whether the availability check is still in progress */
  isChecking: boolean;
};

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

// ============================================================================
// Chat Memory Types
// ============================================================================

/**
 * Options for creating a ChatMemoryManager.
 */
export type ChatMemoryOptions = {
  /**
   * Maximum number of conversation turns to keep in memory.
   * A turn is one user message + one assistant response.
   * @default 10
   */
  maxTurns?: number;
  /**
   * Optional system prompt to prepend to every generated prompt.
   */
  systemPrompt?: string;
  /**
   * Maximum context window in tokens. When set, trimHistory will also
   * trim messages that exceed this token budget (in addition to maxTurns).
   * Whichever limit is hit first triggers trimming.
   * @default Infinity (no token-based trimming)
   */
  contextWindow?: number;
};

/**
 * A snapshot of the current chat memory state.
 */
export type ChatMemorySnapshot = {
  /** All messages currently in memory */
  messages: LLMMessage[];
  /** The system prompt (if any) */
  systemPrompt: string | undefined;
  /** Current number of turns stored */
  turnCount: number;
  /** Maximum turns allowed */
  maxTurns: number;
};
