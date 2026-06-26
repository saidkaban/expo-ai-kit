/**
 * Hardware backend for on-device model inference.
 *
 * - 'auto': Try GPU first, fall back to CPU (default)
 * - 'gpu': Force GPU — faster (~40-50 tok/s) but needs more memory
 * - 'cpu': Force CPU — slower (~2-5 tok/s) but works on low-RAM devices
 */
export type InferenceBackend = 'auto' | 'gpu' | 'cpu';

/**
 * Sampling / generation parameters applied to a model session.
 *
 * Support is per-backend (on-device runtimes expose different knobs), so these
 * are best-effort — unsupported fields are ignored rather than erroring:
 *
 * | field       | Gemma (LiteRT-LM) | Apple Foundation Models | ML Kit |
 * |-------------|:-----------------:|:-----------------------:|:------:|
 * | temperature | ✓                 | ✓                       | —      |
 * | topK        | ✓                 | —                       | —      |
 * | topP        | ✓                 | —                       | —      |
 * | seed        | ✓ (iOS only)      | —                       | —      |
 * | maxTokens   | —                 | ✓ (max output)          | —      |
 *
 * Notes:
 * - Gemma/LiteRT-LM has no per-generation output-token cap (its `maxNumTokens`
 *   is the total KV-cache size, set at load), so `maxTokens` is not honored
 *   there. Its sampler (topK/topP/temperature[/seed]) is fixed at conversation
 *   creation, which is why generation config lives on setModel() rather than
 *   per-call. `seed` is currently wired on iOS only.
 * - The ML Kit built-in (Android default) does not yet apply generation config;
 *   it uses its own defaults.
 */
export type GenerationConfig = {
  /** Sampling temperature. Lower = more deterministic. Typically 0.0–2.0. */
  temperature?: number;
  /** Nucleus sampling: number of top logits to consider. Must be > 0. */
  topK?: number;
  /** Nucleus sampling: cumulative probability threshold in [0, 1]. */
  topP?: number;
  /** RNG seed for reproducible sampling (Gemma only). */
  seed?: number;
  /** Maximum number of output tokens to generate (Apple FM / ML Kit only). */
  maxTokens?: number;
};

/**
 * Options for setModel.
 */
export type SetModelOptions = {
  /** Hardware backend to use for inference. Defaults to 'auto'. */
  backend?: InferenceBackend;
  /**
   * Default sampling parameters for this model session. Applied when the model
   * is activated and used for all subsequent sendMessage/streamMessage calls
   * until the next setModel(). See {@link GenerationConfig} for per-backend support.
   */
  generation?: GenerationConfig;
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
  /**
   * Abort the request. When the signal fires, the returned promise rejects with
   * an INFERENCE_CANCELLED {@link ModelError}.
   *
   * Note: on-device, non-streaming generation cannot always be interrupted
   * mid-decode — abort always unblocks the caller, but the model may keep
   * computing in the background until it finishes, during which a new
   * sendMessage/streamMessage will throw INFERENCE_BUSY. To truly interrupt a
   * long generation, prefer streamMessage().stop().
   */
  signal?: AbortSignal;
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
 * Handle returned by streamMessage.
 */
export type LLMStreamHandle = {
  /** Resolves with the final text when streaming completes or is stopped. */
  promise: Promise<LLMResponse>;
  /** Stop streaming. Resolves `promise` with the text accumulated so far. */
  stop: () => void;
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
// Structured Output (generateObject)
// ============================================================================

/**
 * The set of JSON Schema primitive `type` values understood by
 * {@link generateObject}'s local validator.
 */
export type JSONSchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

/**
 * A JSON Schema describing the shape you want {@link generateObject} to return.
 *
 * A pragmatic subset is enforced locally — `type`, `properties`, `required`,
 * `items`, and `enum` — which covers most extraction shapes. Any other JSON
 * Schema keywords you include (e.g. `description`, `minLength`) are still sent
 * to the model to guide it, but are not validated on-device. Keep schemas small:
 * on-device models follow flat, shallow shapes far more reliably than deeply
 * nested ones.
 */
export type JSONSchema = {
  /** Expected JSON type (or a union of types). */
  type?: JSONSchemaType | JSONSchemaType[];
  /** Human-readable hint passed through to the model. */
  description?: string;
  /** For `object` schemas: the schema of each named property. */
  properties?: Record<string, JSONSchema>;
  /** For `object` schemas: property names that must be present. */
  required?: string[];
  /** For `array` schemas: the schema each element must satisfy. */
  items?: JSONSchema;
  /** Restrict the value to this set of literals. */
  enum?: ReadonlyArray<string | number | boolean | null>;
  /** Other JSON Schema keywords are accepted and forwarded to the model. */
  [key: string]: unknown;
};

/**
 * Options for {@link generateObject}.
 */
export type GenerateObjectOptions = {
  /**
   * System prompt used when the messages array has no system message. Defaults
   * to a structured-output-oriented instruction. If a system message is present
   * in the array, this is ignored (the schema instruction is appended to it).
   */
  systemPrompt?: string;
  /**
   * Abort the request. Behaves like {@link LLMSendOptions.signal} — the returned
   * promise rejects with an INFERENCE_CANCELLED {@link ModelError}.
   */
  signal?: AbortSignal;
  /**
   * How many times to re-prompt the model when its output is not valid JSON or
   * does not match the schema. Each repair feeds the error back to the model.
   * Defaults to 2 (i.e. up to 3 generations total).
   */
  maxRepairAttempts?: number;
};

/**
 * Result of {@link generateObject}.
 */
export type GenerateObjectResult<T = unknown> = {
  /** The parsed value, validated against the schema. */
  object: T;
  /** The raw model output that produced `object` (useful for debugging). */
  text: string;
};


// ============================================================================
// Tool / Function Calling (generateText)
// ============================================================================

/**
 * A tool (function) the model may call to fetch data or take an action.
 *
 * The model never runs anything itself — it *proposes* a call (a name + JSON
 * arguments), {@link generateText} validates the arguments against `parameters`,
 * and only then invokes your `execute`. The result is fed back into the
 * conversation so the model can use it to produce its final answer.
 *
 * @typeParam TArgs - Shape of the validated arguments passed to `execute`.
 * @typeParam TResult - What `execute` returns (serialized back to the model).
 */
export type Tool<TArgs = any, TResult = any> = {
  /**
   * What the tool does and when to use it. This is how the model decides
   * whether a request matches this tool — make it specific and action-oriented.
   */
  description: string;
  /**
   * JSON Schema for the tool's arguments. The model is told to conform to it,
   * and the args it proposes are validated against it (same pragmatic subset as
   * {@link generateObject}) before `execute` runs. Keep it small and shallow.
   */
  parameters: JSONSchema;
  /**
   * Runs the tool with the validated arguments and returns a result.
   *
   * **Optional on purpose.** If you omit it, {@link generateText} does not run
   * anything — it stops with `finishReason: 'tool-calls'` and hands you the
   * proposed call so you can confirm, gate, or execute it yourself.
   */
  execute?: (args: TArgs) => TResult | Promise<TResult>;
};

/** A map of tool name → {@link Tool}, passed to {@link generateText}. */
export type ToolSet = Record<string, Tool>;

/** A tool invocation the model proposed (name + validated arguments). */
export type ToolCall = {
  /** The tool's key in the {@link ToolSet}. */
  toolName: string;
  /** Arguments the model supplied, validated against the tool's `parameters`. */
  args: unknown;
};

/** The outcome of running a {@link ToolCall} via its `execute`. */
export type ToolResult = {
  /** The tool's key in the {@link ToolSet}. */
  toolName: string;
  /** The arguments that were passed to `execute`. */
  args: unknown;
  /** Whatever `execute` returned (or `{ error }` if it threw). */
  result: unknown;
};

/** One model round-trip in the {@link generateText} loop. */
export type StepResult = {
  /** Assistant text produced this step (empty when the step only called a tool). */
  text: string;
  /** Tool calls proposed this step (at most one in the current protocol). */
  toolCalls: ToolCall[];
  /** Results of the tool calls executed this step. */
  toolResults: ToolResult[];
};

/**
 * Why {@link generateText} stopped.
 *
 * - `'stop'`: the model produced a final text answer.
 * - `'tool-calls'`: stopped because a proposed tool has no `execute` — the call
 *   is returned for you to handle (human-in-the-loop).
 * - `'max-steps'`: hit the `maxSteps` cap while still calling tools. Raise the cap.
 */
export type GenerateTextFinishReason = 'stop' | 'tool-calls' | 'max-steps';

/**
 * Options for {@link generateText}.
 */
export type GenerateTextOptions = {
  /** Tools the model may call. Omit (or pass `{}`) for a plain text generation. */
  tools?: ToolSet;
  /**
   * Maximum number of model round-trips (each call + tool execution is one step).
   * Bounds the tool-calling chain so it can't run away. Defaults to 5.
   */
  maxSteps?: number;
  /**
   * System prompt used when the messages array has no system message. The tool
   * instructions are appended to it (or to the array's system message if present).
   */
  systemPrompt?: string;
  /**
   * Abort the request. Behaves like {@link LLMSendOptions.signal} — the returned
   * promise rejects with an INFERENCE_CANCELLED {@link ModelError}.
   */
  signal?: AbortSignal;
  /**
   * How many times to re-prompt within a step when the model emits a malformed
   * tool call, an unknown tool name, or arguments that fail schema validation.
   * Defaults to 2. If it still can't comply, `generateText` throws INFERENCE_FAILED.
   */
  maxRepairAttempts?: number;
};

/**
 * Result of {@link generateText}.
 */
export type GenerateTextResult = {
  /** The final assistant text (empty if it stopped on a tool call without `execute`). */
  text: string;
  /** Every step taken, in order — useful for tracing or debugging. */
  steps: StepResult[];
  /** All tool calls across every step, flattened. */
  toolCalls: ToolCall[];
  /** All tool results across every step, flattened. */
  toolResults: ToolResult[];
  /** Why generation stopped. See {@link GenerateTextFinishReason}. */
  finishReason: GenerateTextFinishReason;
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
  /** License the weights are distributed under (e.g. 'Apache-2.0', 'MIT', 'Gemma'). */
  license: string;
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
 * - 'downloaded': Model file is on disk but not loaded into memory. Call
 *   setModel() to load it. This survives app restarts, so use it to decide
 *   whether a (re-)download is needed.
 * - 'loading': File is on disk, model is being loaded into memory for inference
 * - 'ready': Model is loaded in memory and ready for inference
 */
export type DownloadableModelStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'downloaded'
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
  | 'DOWNLOAD_CANCELLED'
  | 'INFERENCE_OOM'
  | 'INFERENCE_FAILED'
  | 'INFERENCE_BUSY'
  | 'INFERENCE_CANCELLED'
  | 'MODEL_LOAD_FAILED'
  | 'DEVICE_NOT_SUPPORTED'
  | 'UNKNOWN';

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
