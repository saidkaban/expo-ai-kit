import ExpoAiKitModule, { type NativeGenerationConfig } from './ExpoAiKitModule';
import { Platform } from 'react-native';
import {
  LLMMessage,
  LLMSendOptions,
  LLMResponse,
  LLMStreamOptions,
  LLMStreamEvent,
  LLMStreamCallback,
  LLMStreamHandle,
  BuiltInModel,
  DownloadableModel,
  GenerationConfig,
  ModelError,
  SetModelOptions,
  JSONSchema,
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateTextOptions,
  GenerateTextResult,
  ToolCall,
  ToolResult,
  StepResult,
  EmbedOptions,
  EmbedResult,
  EmbeddingModelState,
} from './types';
import {
  buildSchemaInstruction,
  buildSchemaRepair,
  extractJson,
  validateAgainstSchema,
  REPAIR_INVALID_JSON,
} from './structured';
import {
  buildToolInstruction,
  parseToolCall,
  buildUnknownToolRepair,
  buildToolArgsRepair,
  formatToolResult,
} from './tools';
import {
  ANDROID_EMBEDDING_MODEL,
  composeAndroidEmbeddingRevision,
  filterDownloadedModels,
  getAllModels,
  getRegistryEntry,
} from './models';
import { isValidEmbeddingTask, EMBEDDING_TASKS, normalizeLanguageTag } from './embedding';
import { parseNativeErrorMessage } from './errors';
import { stripThinking } from './thinking';

export * from './types';
export * from './models';
export * from './rag';
export * from './embedding';
export * from './errors';
export * from './thinking';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful, friendly assistant. Answer the user directly and concisely.';

const DEFAULT_OBJECT_SYSTEM_PROMPT =
  'You output structured data as JSON. Follow the provided JSON Schema exactly.';

let streamIdCounter = 0;
function generateSessionId(): string {
  return `gen_${Date.now()}_${++streamIdCounter}`;
}

/**
 * Normalize an error from the native layer into a {@link ModelError}.
 *
 * The native modules format failures as "CODE:modelId:reason" (see the
 * GemmaError/GemmaInferenceClient contract). Depending on the Expo SDK that
 * string is either the whole error message or wrapped by expo-modules-core's
 * exception decorator ("Call to function 'X' has been rejected. → Caused by:
 * java.lang.RuntimeException: CODE:modelId:reason"), so the pure parser in
 * errors.ts handles both. Anything unrecognized becomes UNKNOWN.
 */
function toModelError(e: unknown): never {
  if (e instanceof ModelError) throw e;
  const message = String((e as any)?.message ?? e ?? '');
  const parsed = parseNativeErrorMessage(message);
  if (parsed) {
    throw new ModelError(parsed.code, parsed.modelId, parsed.reason);
  }
  throw new ModelError('UNKNOWN', '', message);
}

/** Run a native promise, normalizing any rejection into a ModelError. */
async function wrapNative<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    toModelError(e);
  }
}

// ---------------------------------------------------------------------------
// Single-flight inference guard
// ---------------------------------------------------------------------------
// On-device models are backed by a single native context + KV cache that is not
// safe for concurrent decodes (interleaving can corrupt the cache and crash the
// native side). JS is single-threaded, so a synchronous check-and-set of this
// flag before any `await` is race-free. The flag is shared by sendMessage and
// streamMessage and is held until the *native* call settles — not until an
// early abort — so a detached-but-still-running generation still blocks a new one.
let inferenceInFlight = false;

function acquireInference(): void {
  if (inferenceInFlight) {
    throw new ModelError(
      'INFERENCE_BUSY',
      '',
      'A generation is already in flight. Wait for it to finish, or stop the active stream first.'
    );
  }
  inferenceInFlight = true;
}

/**
 * Map the public GenerationConfig to the native shape, dropping undefined fields
 * and validating ranges up front so callers get a clear error instead of an
 * opaque native MODEL_LOAD_FAILED from the sampler.
 */
function toNativeGeneration(g?: GenerationConfig): NativeGenerationConfig {
  const out: NativeGenerationConfig = {};
  if (g?.temperature != null) {
    if (g.temperature < 0) {
      throw new Error('generation.temperature must be >= 0');
    }
    out.temperature = g.temperature;
  }
  if (g?.topK != null) {
    if (!Number.isInteger(g.topK) || g.topK <= 0) {
      throw new Error('generation.topK must be a positive integer');
    }
    out.topK = g.topK;
  }
  if (g?.topP != null) {
    if (g.topP < 0 || g.topP > 1) {
      throw new Error('generation.topP must be within [0, 1]');
    }
    out.topP = g.topP;
  }
  if (g?.seed != null) {
    if (!Number.isInteger(g.seed)) {
      throw new Error('generation.seed must be an integer');
    }
    out.seed = g.seed;
  }
  if (g?.maxTokens != null) {
    if (!Number.isInteger(g.maxTokens) || g.maxTokens <= 0) {
      throw new Error('generation.maxTokens must be a positive integer');
    }
    out.maxTokens = g.maxTokens;
  }
  return out;
}

// ============================================================================
// Inference API
// ============================================================================

/**
 * Check if on-device AI is available on the current device.
 * Returns false on unsupported platforms (web, etc.).
 */
export async function isAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return false;
  }
  return ExpoAiKitModule.isAvailable();
}

/**
 * Send messages to the on-device LLM and get a response.
 *
 * @param messages - Array of messages representing the conversation
 * @param options - Optional settings (systemPrompt fallback)
 * @returns Promise with the generated response
 *
 * @example
 * ```ts
 * const response = await sendMessage([
 *   { role: 'user', content: 'What is 2 + 2?' }
 * ]);
 * console.log(response.text); // "4"
 * ```
 *
 * @example
 * ```ts
 * // With system prompt
 * const response = await sendMessage(
 *   [{ role: 'user', content: 'Hello!' }],
 *   { systemPrompt: 'You are a pirate. Respond in pirate speak.' }
 * );
 * ```
 *
 * @example
 * ```ts
 * // Multi-turn conversation
 * const response = await sendMessage([
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'My name is Alice.' },
 *   { role: 'assistant', content: 'Nice to meet you, Alice!' },
 *   { role: 'user', content: 'What is my name?' }
 * ]);
 * ```
 */
export async function sendMessage(
  messages: LLMMessage[],
  options?: LLMSendOptions
): Promise<LLMResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { text: '' };
  }

  if (!messages || messages.length === 0) {
    throw new Error('messages array cannot be empty');
  }

  if (options?.signal?.aborted) {
    throw new ModelError('INFERENCE_CANCELLED', '', 'Aborted before start');
  }

  // Determine system prompt: use from messages array if present, else options, else default
  const hasSystemMessage = messages.some((m) => m.role === 'system');
  const systemPrompt = hasSystemMessage
    ? '' // Native will extract from messages
    : options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  acquireInference(); // throws INFERENCE_BUSY if a generation is already running
  const sessionId = generateSessionId();

  // Hold the single-flight flag until the NATIVE call settles — even if the
  // caller aborts early — because the model may keep computing in the background.
  const native = ExpoAiKitModule.sendMessage(messages, systemPrompt, sessionId);
  const release = () => {
    inferenceInFlight = false;
  };
  native.then(release, release);

  const signal = options?.signal;
  if (!signal) {
    try {
      return await native;
    } catch (e) {
      toModelError(e);
    }
  }

  // Race the native result against the abort signal. On abort we unblock the
  // caller immediately and best-effort ask native to cancel; the flag stays
  // held (via `release` above) until the native call actually finishes.
  return await new Promise<LLMResponse>((resolve, reject) => {
    let done = false;
    const finish = (action: () => void) => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', onAbort);
      action();
    };
    function onAbort() {
      ExpoAiKitModule.stopStreaming(sessionId).catch(() => {});
      finish(() => reject(new ModelError('INFERENCE_CANCELLED', '', 'Aborted by caller')));
    }
    signal.addEventListener('abort', onAbort);
    native.then(
      (r) => finish(() => resolve(r)),
      (e) =>
        finish(() => {
          try {
            toModelError(e);
          } catch (me) {
            reject(me);
          }
        })
    );
  });
}

/**
 * Stream messages to the on-device LLM and receive progressive token updates.
 *
 * @param messages - Array of messages representing the conversation
 * @param onToken - Callback function called for each token/chunk received
 * @param options - Optional settings (systemPrompt fallback)
 * @returns Object with stop() function to cancel streaming and promise that resolves when complete
 *
 * @example
 * ```ts
 * // Basic streaming
 * const { promise } = streamMessage(
 *   [{ role: 'user', content: 'Tell me a story' }],
 *   (event) => {
 *     console.log(event.token); // Each token as it arrives
 *     console.log(event.accumulatedText); // Full text so far
 *   }
 * );
 * await promise;
 * ```
 *
 * @example
 * ```ts
 * // With cancellation
 * const { promise, stop } = streamMessage(
 *   [{ role: 'user', content: 'Write a long essay' }],
 *   (event) => setText(event.accumulatedText)
 * );
 *
 * // Cancel after 5 seconds
 * setTimeout(() => stop(), 5000);
 * ```
 */
export function streamMessage(
  messages: LLMMessage[],
  onToken: LLMStreamCallback,
  options?: LLMStreamOptions
): LLMStreamHandle {
  // Handle unsupported platforms
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return {
      promise: Promise.resolve({ text: '' }),
      stop: () => {},
    };
  }

  if (!messages || messages.length === 0) {
    return {
      promise: Promise.reject(new Error('messages array cannot be empty')),
      stop: () => {},
    };
  }

  if (inferenceInFlight) {
    return {
      promise: Promise.reject(
        new ModelError(
          'INFERENCE_BUSY',
          '',
          'A generation is already in flight. Stop the active stream first.'
        )
      ),
      stop: () => {},
    };
  }
  inferenceInFlight = true; // set synchronously — race-free with other JS

  const sessionId = generateSessionId();

  // Determine system prompt: use from messages array if present, else options, else default
  const hasSystemMessage = messages.some((m) => m.role === 'system');
  const systemPrompt = hasSystemMessage
    ? '' // Native will extract from messages
    : options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  let finalText = '';
  let settled = false;
  let subscription: ReturnType<typeof ExpoAiKitModule.addListener> | undefined;
  let resolveOuter!: (r: LLMResponse) => void;
  let rejectOuter!: (e: unknown) => void;

  // Settle exactly once: remove the listener and release the single-flight flag.
  const settle = (action: () => void) => {
    if (settled) return;
    settled = true;
    subscription?.remove();
    inferenceInFlight = false;
    action();
  };

  const promise = new Promise<LLMResponse>((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  subscription = ExpoAiKitModule.addListener(
    'onStreamToken',
    (event: LLMStreamEvent) => {
      if (event.sessionId !== sessionId) return;
      finalText = event.accumulatedText;
      onToken(event);
      if (event.isDone) settle(() => resolveOuter({ text: finalText }));
    }
  );

  ExpoAiKitModule.startStreaming(messages, systemPrompt, sessionId).catch(
    (error) => {
      settle(() => {
        try {
          toModelError(error);
        } catch (me) {
          rejectOuter(me);
        }
      });
    }
  );

  const stop = () => {
    // Best-effort native cancel (native also emits a terminal isDone on cancel),
    // but resolve immediately with the text so far so `promise` can never hang.
    ExpoAiKitModule.stopStreaming(sessionId).catch(() => {});
    settle(() => resolveOuter({ text: finalText }));
  };

  return { promise, stop };
}

/**
 * Generate a typed object instead of free text.
 *
 * You describe the shape you want with a JSON Schema. expo-ai-kit appends a
 * strict instruction to the system prompt, runs the on-device model, extracts
 * the JSON from its output (tolerating prose and ```json fences), validates it
 * against the schema, and — on a parse error or schema mismatch — feeds the
 * error back and re-prompts up to `maxRepairAttempts` times.
 *
 * Works on every backend (Apple Foundation Models, ML Kit, Gemma) because it is
 * orchestrated over {@link sendMessage}: it honors the same single-flight guard,
 * `AbortSignal`, and `systemPrompt` semantics. Keep schemas small and shallow —
 * on-device models follow flat shapes far more reliably than deeply nested ones.
 *
 * @param messages - The conversation, same shape as {@link sendMessage}.
 * @param schema - A JSON Schema describing the desired result.
 * @param options - Optional settings (systemPrompt, signal, maxRepairAttempts).
 * @returns `{ object, text }` — the validated value and the raw output.
 * @throws {ModelError} INFERENCE_FAILED if no schema-valid JSON is produced
 *   after the repair attempts. Also propagates INFERENCE_BUSY / INFERENCE_CANCELLED
 *   from the underlying generation.
 *
 * @example
 * ```ts
 * type Recipe = { title: string; minutes: number; ingredients: string[] };
 *
 * const { object } = await generateObject<Recipe>(
 *   [{ role: 'user', content: 'A quick weeknight pasta.' }],
 *   {
 *     type: 'object',
 *     properties: {
 *       title: { type: 'string' },
 *       minutes: { type: 'integer' },
 *       ingredients: { type: 'array', items: { type: 'string' } },
 *     },
 *     required: ['title', 'minutes', 'ingredients'],
 *   },
 * );
 * object.title; // typed Recipe
 * ```
 */
export async function generateObject<T = unknown>(
  messages: LLMMessage[],
  schema: JSONSchema,
  options?: GenerateObjectOptions
): Promise<GenerateObjectResult<T>> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new ModelError(
      'DEVICE_NOT_SUPPORTED',
      '',
      'generateObject is only available on iOS and Android'
    );
  }
  if (!messages || messages.length === 0) {
    throw new Error('messages array cannot be empty');
  }
  if (!schema || typeof schema !== 'object') {
    throw new Error('schema must be a JSON Schema object');
  }

  const maxRepairAttempts = Math.max(0, options?.maxRepairAttempts ?? 2);
  const instruction = buildSchemaInstruction(schema);

  // Inject the schema instruction. If the caller supplied a system message we
  // append to it (sendMessage reads system from the array); otherwise we carry
  // the instruction via the systemPrompt option, which sendMessage applies when
  // the array has no system message — including on the repair turns we append.
  const sysIdx = messages.findIndex((m) => m.role === 'system');
  let working: LLMMessage[];
  let systemPrompt: string | undefined;
  if (sysIdx >= 0) {
    working = messages.map((m, i) =>
      i === sysIdx ? { role: m.role, content: `${m.content}\n\n${instruction}` } : m
    );
    systemPrompt = undefined; // the array carries the system message
  } else {
    working = [...messages];
    systemPrompt = `${options?.systemPrompt ?? DEFAULT_OBJECT_SYSTEM_PROMPT}\n\n${instruction}`;
  }

  let lastText = '';
  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    const { text } = await sendMessage(working, { systemPrompt, signal: options?.signal });
    lastText = text;

    // Thinking models (Qwen3) reason in <think> blocks that can contain
    // JSON-looking text — parse only the answer, and feed only the answer back
    // on repair turns (reasoning is model-internal, not conversation history).
    const { text: answer } = stripThinking(text);

    const parsed = extractJson(answer);
    if (parsed.ok) {
      const errors = validateAgainstSchema(parsed.value, schema);
      if (errors.length === 0) {
        return { object: parsed.value as T, text };
      }
      if (attempt < maxRepairAttempts) {
        working = [
          ...working,
          { role: 'assistant', content: answer },
          { role: 'user', content: buildSchemaRepair(errors) },
        ];
      }
    } else if (attempt < maxRepairAttempts) {
      working = [
        ...working,
        { role: 'assistant', content: answer },
        { role: 'user', content: REPAIR_INVALID_JSON },
      ];
    }
  }

  throw new ModelError(
    'INFERENCE_FAILED',
    getActiveModel(),
    `generateObject: model did not return schema-valid JSON after ${maxRepairAttempts + 1} attempt(s). ` +
      `Last output: ${lastText.slice(0, 200)}`
  );
}

/**
 * Generate text, optionally letting the model call tools (functions) you provide.
 *
 * Unlike {@link generateObject} (where the JSON *is* the answer), tool calling is
 * a loop: the model proposes a call, expo-ai-kit validates the arguments against
 * the tool's `parameters`, runs your `execute`, feeds the result back, and lets
 * the model continue — until it produces a plain-text answer or the `maxSteps`
 * budget is reached. With no `tools`, this is a single text generation.
 *
 * Orchestrated in JS over {@link sendMessage}, so it works on every backend
 * (Apple Foundation Models, ML Kit, Gemma) and inherits the single-flight guard,
 * `AbortSignal`, and `systemPrompt` semantics. On-device models are imperfect at
 * tool selection, so the loop is defensive: malformed calls, unknown tool names,
 * and schema-invalid arguments are re-prompted up to `maxRepairAttempts` times,
 * and a tool with no `execute` stops the loop and returns the proposed call for
 * you to gate. Keep tool sets small and `parameters` flat for best reliability.
 *
 * @param messages - The conversation, same shape as {@link sendMessage}.
 * @param options - Tools, `maxSteps`, `systemPrompt`, `signal`, `maxRepairAttempts`.
 * @returns `{ text, steps, toolCalls, toolResults, finishReason }`.
 * @throws {ModelError} INFERENCE_FAILED if the model keeps proposing an unknown
 *   tool or schema-invalid arguments after the repair attempts. Also propagates
 *   INFERENCE_BUSY / INFERENCE_CANCELLED from the underlying generation.
 *
 * @example
 * ```ts
 * const { text } = await generateText(
 *   [{ role: 'user', content: 'What should I wear in Paris today?' }],
 *   {
 *     tools: {
 *       getWeather: {
 *         description: 'Get the current weather for a city.',
 *         parameters: {
 *           type: 'object',
 *           properties: { city: { type: 'string' } },
 *           required: ['city'],
 *         },
 *         execute: async ({ city }: { city: string }) => fetchWeather(city),
 *       },
 *     },
 *   },
 * );
 * ```
 *
 * @example
 * ```ts
 * // Human-in-the-loop: omit `execute` to gate the call yourself.
 * const res = await generateText(messages, {
 *   tools: { deleteAccount: { description: '…', parameters: { type: 'object' } } },
 * });
 * if (res.finishReason === 'tool-calls') {
 *   const call = res.toolCalls[0]; // confirm with the user before running
 * }
 * ```
 */
export async function generateText(
  messages: LLMMessage[],
  options?: GenerateTextOptions
): Promise<GenerateTextResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new ModelError(
      'DEVICE_NOT_SUPPORTED',
      '',
      'generateText is only available on iOS and Android'
    );
  }
  if (!messages || messages.length === 0) {
    throw new Error('messages array cannot be empty');
  }

  const tools = options?.tools ?? {};
  const toolNames = Object.keys(tools);
  const maxSteps = Math.max(1, options?.maxSteps ?? 5);
  const maxRepairAttempts = Math.max(0, options?.maxRepairAttempts ?? 2);

  // Inject the tool instruction the same way generateObject injects its schema
  // instruction: into the array's system message if present, else via the
  // systemPrompt option. With no tools, this is a plain single-shot generation.
  const instruction = toolNames.length > 0 ? buildToolInstruction(tools) : '';
  const sysIdx = messages.findIndex((m) => m.role === 'system');
  let working: LLMMessage[];
  let systemPrompt: string | undefined;
  if (instruction === '') {
    working = [...messages];
    systemPrompt = options?.systemPrompt;
  } else if (sysIdx >= 0) {
    working = messages.map((m, i) =>
      i === sysIdx ? { role: m.role, content: `${m.content}\n\n${instruction}` } : m
    );
    systemPrompt = undefined; // the array carries the system message
  } else {
    working = [...messages];
    systemPrompt = `${options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}\n\n${instruction}`;
  }

  const steps: StepResult[] = [];
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];

  for (let step = 0; step < maxSteps; step++) {
    // One model round-trip, with an inner repair loop for malformed/invalid calls.
    let call: ToolCall | null = null;
    let text = '';

    for (let repair = 0; ; repair++) {
      const r = await sendMessage(working, { systemPrompt, signal: options?.signal });
      // Thinking models (Qwen3) reason in <think> blocks — the answer is what
      // remains, and only the answer goes into results and repair history.
      text = stripThinking(r.text).text;

      if (toolNames.length === 0) break; // no tools → this is the final answer

      const parsed = parseToolCall(text, toolNames);
      if (parsed.kind === 'text') break; // plain answer, no tool call

      if (parsed.kind === 'unknown-tool') {
        if (repair >= maxRepairAttempts) {
          throw new ModelError(
            'INFERENCE_FAILED',
            getActiveModel(),
            `generateText: model called unknown tool "${parsed.toolName}" after ${maxRepairAttempts + 1} attempt(s).`
          );
        }
        working = [
          ...working,
          { role: 'assistant', content: text },
          { role: 'user', content: buildUnknownToolRepair(parsed.toolName, toolNames) },
        ];
        continue;
      }

      // parsed.kind === 'tool' — validate the proposed args before executing.
      const errors = validateAgainstSchema(parsed.args, tools[parsed.toolName].parameters);
      if (errors.length === 0) {
        call = { toolName: parsed.toolName, args: parsed.args };
        break;
      }
      if (repair >= maxRepairAttempts) {
        throw new ModelError(
          'INFERENCE_FAILED',
          getActiveModel(),
          `generateText: arguments for "${parsed.toolName}" failed schema validation after ` +
            `${maxRepairAttempts + 1} attempt(s): ${errors.slice(0, 4).join('; ')}`
        );
      }
      working = [
        ...working,
        { role: 'assistant', content: text },
        { role: 'user', content: buildToolArgsRepair(parsed.toolName, errors) },
      ];
    }

    // No tool call this step → the model produced its final text answer.
    if (!call) {
      steps.push({ text, toolCalls: [], toolResults: [] });
      return {
        text,
        steps,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        finishReason: 'stop',
      };
    }

    allToolCalls.push(call);
    const tool = tools[call.toolName];

    // No execute → hand the proposed call back to the caller (human-in-the-loop).
    if (typeof tool.execute !== 'function') {
      steps.push({ text, toolCalls: [call], toolResults: [] });
      return {
        text,
        steps,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        finishReason: 'tool-calls',
      };
    }

    // Run the tool. A thrown error is fed back as the result so the model can recover.
    let result: unknown;
    try {
      result = await tool.execute(call.args);
    } catch (e) {
      result = { error: String((e as any)?.message ?? e) };
    }
    const toolResult: ToolResult = { toolName: call.toolName, args: call.args, result };
    allToolResults.push(toolResult);
    steps.push({ text, toolCalls: [call], toolResults: [toolResult] });

    // Feed the call + result back into the conversation for the next step.
    working = [
      ...working,
      { role: 'assistant', content: text },
      { role: 'user', content: formatToolResult(call.toolName, result) },
    ];
  }

  // Step budget exhausted while still calling tools — no final answer was
  // produced. Signal it via finishReason so the caller can raise maxSteps.
  return {
    text: '',
    steps,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    finishReason: 'max-steps',
  };
}

// ============================================================================
// Embeddings API
// ============================================================================

/** The identity embed() reports for every Android result (all pins, one string). */
const ANDROID_EMBEDDING_IDENTITY = {
  id: ANDROID_EMBEDDING_MODEL.id,
  revision: composeAndroidEmbeddingRevision(ANDROID_EMBEDDING_MODEL),
};

/** Validate and normalize EmbedOptions into the (task, language) native args. */
function resolveEmbedOptions(options?: EmbedOptions): { task: string; language: string } {
  const task = options?.task ?? 'semantic-similarity';
  if (!isValidEmbeddingTask(task)) {
    throw new Error(`options.task must be one of: ${EMBEDDING_TASKS.join(', ')}`);
  }
  return { task, language: normalizeLanguageTag(options?.language ?? 'en') };
}

/**
 * Turn text into embedding vectors for semantic search / on-device RAG.
 *
 * Returns one vector per input string (in order), which you can compare with
 * {@link cosineSimilarity} or store in a {@link createVectorStore} to retrieve
 * the most relevant chunks before a {@link sendMessage} / {@link generateText}
 * call. Pair with {@link chunkText} to split documents first.
 *
 * Backends:
 * - **iOS** (17+): Apple's `NLContextualEmbedding` — zero-download, OS-managed
 *   script models (Latin / Cyrillic / CJK), selected by `options.language`
 *   (BCP-47, default `'en'`). An unsupported language throws a typed
 *   LANGUAGE_NOT_SUPPORTED error naming it — never a silent Latin fallback.
 * - **Android**: EmbeddingGemma 300M via MediaPipe TextEmbedder — natively
 *   multilingual (single vector space; `language` is ignored), 768 dimensions,
 *   max sequence 512 tokens, CPU. **Opt-in**: enable the config plugin flag
 *   `["expo-ai-kit", { "androidEmbeddings": true }]` and rebuild, then download
 *   the ~184 MB model with {@link prepareEmbeddingModel} — embed() itself NEVER
 *   triggers a download (throws MODEL_NOT_DOWNLOADED instead).
 *
 * Pass `options.task` to say what the vectors are for (`'retrieval-query'` vs
 * `'retrieval-document'` vs the default `'semantic-similarity'`) — it maps onto
 * EmbeddingGemma's prompt protocol on Android and measurably improves retrieval.
 *
 * The result's `model` identity ({@link EmbeddingModelIdentity}) tells you which
 * exact model produced the vectors. **Vectors are only comparable under
 * identical model identity** — never across platforms or iOS script models.
 *
 * Embeddings don't use the generation KV-cache, so `embed()` is **not** subject
 * to the single-flight `INFERENCE_BUSY` guard — it can run alongside generation.
 * (On Android, concurrent embed() calls serialize behind a native mutex.)
 *
 * @param texts - Non-empty array of strings to embed. Empty strings produce a
 *   zero vector (both platforms), keeping output aligned with input.
 * @param options - Optional `{ task, language }`. See {@link EmbedOptions}.
 * @returns `{ embeddings, dimensions, model }` — `embeddings[i]` is the vector
 *   for `texts[i]`.
 * @throws {ModelError} DEVICE_NOT_SUPPORTED on web / iOS < 17;
 *   EMBEDDINGS_NOT_ENABLED on Android when built without the config-plugin flag;
 *   MODEL_NOT_DOWNLOADED on Android before {@link prepareEmbeddingModel};
 *   LANGUAGE_NOT_SUPPORTED on iOS for a language with no on-device model.
 *
 * @example
 * ```ts
 * import { embed, chunkText, createVectorStore } from 'expo-ai-kit';
 *
 * const chunks = chunkText(document);
 * const { embeddings, model } = await embed(chunks, { task: 'retrieval-document' });
 *
 * const store = createVectorStore<{ text: string }>();
 * store.addMany(chunks.map((text, i) => ({ id: `c${i}`, vector: embeddings[i], metadata: { text } })));
 *
 * const { embeddings: [q] } = await embed([question], { task: 'retrieval-query' });
 * const context = store.search(q, { topK: 4 }).map((h) => h.metadata!.text).join('\n\n');
 * const { text } = await sendMessage([
 *   { role: 'system', content: `Answer using only this context:\n${context}` },
 *   { role: 'user', content: question },
 * ]);
 * ```
 */
export async function embed(texts: string[], options?: EmbedOptions): Promise<EmbedResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new ModelError('DEVICE_NOT_SUPPORTED', '', 'embed() is only available on iOS and Android');
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('texts array cannot be empty');
  }
  if (!texts.every((t) => typeof t === 'string')) {
    throw new Error('texts must be an array of strings');
  }
  const { task, language } = resolveEmbedOptions(options);
  const result = await wrapNative(() => ExpoAiKitModule.embed(texts, task, language));
  // iOS reports the resolved Apple model identity natively (it varies with
  // language); Android identity is composed in JS from the pinned artifacts.
  if (result.model) {
    return result as EmbedResult;
  }
  return { ...result, model: ANDROID_EMBEDDING_IDENTITY };
}

/**
 * Check whether the embedding model is ready on this device.
 *
 * - **Android**: reports the EmbeddingGemma asset's download state plus its
 *   pinned size (~184 MB) and identity. Requires the `androidEmbeddings`
 *   config-plugin flag (throws EMBEDDINGS_NOT_ENABLED otherwise).
 * - **iOS**: reports whether the OS has the `NLContextualEmbedding` assets for
 *   `options.language` (default `'en'`) — the asset is OS-managed, so
 *   `sizeBytes` is 0. Throws LANGUAGE_NOT_SUPPORTED for unsupported languages.
 *
 * @throws {ModelError} DEVICE_NOT_SUPPORTED on web.
 */
export async function getEmbeddingModelStatus(options?: {
  language?: string;
}): Promise<EmbeddingModelState> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new ModelError(
      'DEVICE_NOT_SUPPORTED',
      '',
      'getEmbeddingModelStatus() is only available on iOS and Android'
    );
  }
  const language = normalizeLanguageTag(options?.language ?? 'en');
  const state = await wrapNative(() => ExpoAiKitModule.getEmbeddingModelStatus(language));
  if (typeof state === 'string') {
    // Android natively reports only the status; size and identity are JS pins.
    return {
      status: state,
      sizeBytes: ANDROID_EMBEDDING_MODEL.sizeBytes,
      model: ANDROID_EMBEDDING_IDENTITY,
    };
  }
  return state;
}

/**
 * Make the embedding model ready for {@link embed} — the ONLY call that
 * downloads embedding assets.
 *
 * - **Android**: downloads the pinned Google-hosted EmbeddingGemma bundle
 *   (~184 MB, stored per-app), verifies its SHA-256, and installs it atomically
 *   (temp file → verify → rename) — a partial or corrupt download fails closed
 *   and leaves nothing usable behind. `onProgress` receives 0–1.
 * - **iOS**: asks the OS to fetch the `NLContextualEmbedding` assets for
 *   `options.language` (default `'en'`) — the same on-demand flow embed() uses,
 *   just ahead of time. No progress granularity is available from the OS.
 *
 * Resolves when the model is ready. No-op if already prepared.
 *
 * @throws {ModelError} EMBEDDINGS_NOT_ENABLED (Android, plugin flag off),
 *   DOWNLOAD_FAILED / DOWNLOAD_CORRUPT / DOWNLOAD_STORAGE_FULL /
 *   DOWNLOAD_CANCELLED (Android), LANGUAGE_NOT_SUPPORTED (iOS),
 *   DEVICE_NOT_SUPPORTED (web).
 */
export async function prepareEmbeddingModel(options?: {
  language?: string;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new ModelError(
      'DEVICE_NOT_SUPPORTED',
      '',
      'prepareEmbeddingModel() is only available on iOS and Android'
    );
  }
  const language = normalizeLanguageTag(options?.language ?? 'en');

  let subscription: ReturnType<typeof ExpoAiKitModule.addListener> | undefined;
  if (options?.onProgress) {
    subscription = ExpoAiKitModule.addListener('onDownloadProgress', (event) => {
      if (event.modelId === ANDROID_EMBEDDING_MODEL.id) {
        options.onProgress!(event.progress);
      }
    });
  }
  try {
    await wrapNative(() =>
      ExpoAiKitModule.prepareEmbeddingModel(
        ANDROID_EMBEDDING_MODEL.downloadUrl,
        ANDROID_EMBEDDING_MODEL.sha256,
        language
      )
    );
  } finally {
    subscription?.remove();
  }
}

/**
 * Cancel an in-flight {@link prepareEmbeddingModel} download.
 *
 * Android only — the pending prepare rejects with DOWNLOAD_CANCELLED and the
 * partial file is removed. No-op on iOS (the OS owns its asset downloads) and
 * when nothing is downloading.
 */
export async function cancelEmbeddingModelDownload(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return;
  }
  await wrapNative(() => ExpoAiKitModule.cancelEmbeddingModelDownload());
}

/**
 * Delete the downloaded embedding model from the device.
 *
 * Android only — unloads the embedder if loaded and removes the ~184 MB asset
 * (plus any partial download). No-op on iOS: the `NLContextualEmbedding` assets
 * are OS-managed and cannot be deleted by the app.
 */
export async function deleteEmbeddingModel(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return;
  }
  await wrapNative(() => ExpoAiKitModule.deleteEmbeddingModel());
}

/**
 * List the BCP-47 languages the on-device embedding backend supports.
 *
 * - **iOS**: enumerates the `NLContextualEmbedding` catalog (the Latin /
 *   Cyrillic / CJK script models) and returns the union of their languages.
 * - **Android**: returns `[]` — EmbeddingGemma is natively multilingual with a
 *   single vector space, so `language` is ignored rather than selected.
 * - Web: returns `[]`.
 */
export async function getSupportedEmbeddingLanguages(): Promise<string[]> {
  if (Platform.OS !== 'ios') {
    return [];
  }
  return wrapNative(() => ExpoAiKitModule.getSupportedEmbeddingLanguages());
}

// ============================================================================
// Model Management API
// ============================================================================

/**
 * Get all built-in models available on the current platform.
 *
 * Built-in models are provided by the OS and require no download.
 * On iOS this returns Apple Foundation Models; on Android, ML Kit.
 *
 * @returns Array of built-in models with availability status
 */
export async function getBuiltInModels(): Promise<BuiltInModel[]> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return [];
  }
  return ExpoAiKitModule.getBuiltInModels();
}

/**
 * Get all downloadable models from the registry, enriched with on-device status.
 *
 * Reads from the hardcoded MODEL_REGISTRY and queries the native layer
 * for the current download/load status of each model.
 *
 * @returns Array of downloadable models with their current status
 */
export async function getDownloadableModels(): Promise<DownloadableModel[]> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return [];
  }

  const platformModels = getAllModels().filter((entry) =>
    entry.supportedPlatforms.includes(Platform.OS as 'ios' | 'android')
  );

  let deviceRamBytes = 0;
  try {
    deviceRamBytes = ExpoAiKitModule.getDeviceRamBytes();
  } catch {
    // Native call unavailable -- default to 0 (all models will show meetsRequirements: false)
  }

  return Promise.all(
    platformModels.map(async (entry) => {
      // Await: on iOS this bridges as a Promise (reads actor state); on Android
      // it's synchronous and awaiting a plain value is a no-op.
      const status = await ExpoAiKitModule.getDownloadableModelStatus(entry.id);
      return {
        id: entry.id,
        name: entry.name,
        parameterCount: entry.parameterCount,
        license: entry.license,
        sizeBytes: entry.sizeBytes,
        contextWindow: entry.contextWindow,
        minRamBytes: entry.minRamBytes,
        meetsRequirements: deviceRamBytes >= entry.minRamBytes,
        status,
      };
    })
  );
}

/**
 * Get all downloaded models available on the current device.
 *
 * @returns Array of downloadable models whose status is `downloaded`, `loading`, or `ready`.
 */
export async function getDownloadedModels(): Promise<DownloadableModel[]> {
  const models = await getDownloadableModels();

  return filterDownloadedModels(models);
}

/**
 * Pick the best downloadable model the current device can run.
 *
 * Returns the most capable model (largest, by RAM requirement) whose
 * `meetsRequirements` is true — e.g. Gemma 4 E4B on high-spec phones, falling
 * back to E2B on more constrained ones — or `null` if the device can't run any.
 *
 * This is a convenience over {@link getDownloadableModels}; the caller still
 * downloads + activates explicitly. Pass `platform` is implicit (current OS).
 *
 * @example
 * ```ts
 * const best = await getRecommendedModel();
 * if (best) {
 *   await downloadModel(best.id, { onProgress });
 *   await setModel(best.id);
 * }
 * ```
 */
export async function getRecommendedModel(): Promise<DownloadableModel | null> {
  const models = await getDownloadableModels();
  const runnable = models.filter((m) => m.meetsRequirements);
  if (runnable.length === 0) return null;
  // Higher RAM requirement ⇒ larger/more capable model. Prefer the biggest that fits.
  return runnable.sort((a, b) => b.minRamBytes - a.minRamBytes)[0];
}

/**
 * Download a model to the device.
 *
 * Looks up the model in the registry, validates platform support and
 * device requirements, then initiates the download with integrity verification.
 *
 * @param modelId - ID of the model to download (e.g. 'gemma-e2b')
 * @param options - Optional download configuration
 * @param options.onProgress - Callback with download progress (0-1)
 * @throws {ModelError} MODEL_NOT_FOUND if modelId is not in the registry
 * @throws {ModelError} DEVICE_NOT_SUPPORTED if platform is not supported
 * @throws {ModelError} DOWNLOAD_FAILED on network error
 * @throws {ModelError} DOWNLOAD_STORAGE_FULL if insufficient disk space
 * @throws {ModelError} DOWNLOAD_CORRUPT if SHA256 hash doesn't match
 */
export async function downloadModel(
  modelId: string,
  options?: { onProgress?: (progress: number) => void }
): Promise<void> {
  const entry = getRegistryEntry(modelId);
  if (!entry) {
    throw new ModelError('MODEL_NOT_FOUND', modelId);
  }

  if (!entry.supportedPlatforms.includes(Platform.OS as 'ios' | 'android')) {
    throw new ModelError(
      'DEVICE_NOT_SUPPORTED',
      modelId,
      `Model ${modelId} is not supported on ${Platform.OS}`
    );
  }

  try {
    const deviceRamBytes = ExpoAiKitModule.getDeviceRamBytes();
    if (deviceRamBytes < entry.minRamBytes) {
      throw new ModelError(
        'DEVICE_NOT_SUPPORTED',
        modelId,
        `Device has ${Math.round(deviceRamBytes / 1e9)}GB RAM, model requires ${Math.round(entry.minRamBytes / 1e9)}GB`
      );
    }
  } catch (e) {
    if (e instanceof ModelError) throw e;
    // If getDeviceRamBytes is unavailable, skip the check
  }

  let subscription: ReturnType<typeof ExpoAiKitModule.addListener> | undefined;
  if (options?.onProgress) {
    subscription = ExpoAiKitModule.addListener(
      'onDownloadProgress',
      (event) => {
        if (event.modelId === modelId) {
          options.onProgress!(event.progress);
        }
      }
    );
  }

  try {
    await wrapNative(() =>
      ExpoAiKitModule.downloadModel(modelId, entry.downloadUrl, entry.sha256)
    );
  } finally {
    subscription?.remove();
  }
}

/**
 * Cancel an in-flight download for a model.
 *
 * The in-progress {@link downloadModel} promise rejects with a
 * DOWNLOAD_CANCELLED {@link ModelError}. No-op if the model isn't downloading.
 *
 * @param modelId - ID of the model whose download should be cancelled
 */
export async function cancelDownload(modelId: string): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return;
  }
  await wrapNative(() => ExpoAiKitModule.cancelDownload(modelId));
}

/**
 * Delete a downloaded model from the device.
 *
 * If the model is currently loaded, it will be unloaded first.
 *
 * @param modelId - ID of the model to delete
 * @throws {ModelError} MODEL_NOT_FOUND if modelId is not in the registry
 */
export async function deleteModel(modelId: string): Promise<void> {
  const entry = getRegistryEntry(modelId);
  if (!entry) {
    throw new ModelError('MODEL_NOT_FOUND', modelId);
  }

  await wrapNative(() => ExpoAiKitModule.deleteModel(modelId));
}

/**
 * Set the active model for inference.
 *
 * This is the sole gatekeeper for model validity. If setModel succeeds,
 * the model is loaded and ready -- sendMessage never needs its own check.
 *
 * For downloadable models, this loads the model into memory (status
 * transitions: loading -> ready). Only one downloadable model can be
 * loaded at a time; the previous one is auto-unloaded.
 *
 * For built-in models, this simply switches the active backend.
 *
 * If setModel was never called, sendMessage uses the platform built-in
 * model (today's behavior, no error).
 *
 * @param modelId - ID of the model to activate (e.g. 'gemma-e2b', 'apple-fm', 'mlkit')
 * @param options - Optional configuration for model loading
 * @param options.backend - Hardware backend: 'auto' (default, GPU with CPU fallback), 'gpu', or 'cpu'
 * @throws {ModelError} MODEL_NOT_FOUND if modelId is invalid
 * @throws {ModelError} MODEL_NOT_DOWNLOADED if the downloadable model file is not on disk
 * @throws {ModelError} MODEL_LOAD_FAILED if loading into memory fails
 * @throws {ModelError} INFERENCE_OOM if device can't fit model in memory
 * @throws {ModelError} DEVICE_NOT_SUPPORTED for downloadable models on x86/x86_64
 *   Android (emulators on Intel/AMD hosts) — LiteRT-LM's native x86 backend
 *   crashes the app process, so activation fails fast instead. Use a physical
 *   device or an arm64 emulator image; built-in models are unaffected.
 */
export async function setModel(modelId: string, options?: SetModelOptions): Promise<void> {
  if (modelId === ANDROID_EMBEDDING_MODEL.id) {
    throw new ModelError(
      'MODEL_NOT_FOUND',
      modelId,
      `"${modelId}" is the embedding model asset, not a generation model — ` +
        'it cannot be activated with setModel(). Use embed() / prepareEmbeddingModel().'
    );
  }
  const entry = getRegistryEntry(modelId);
  const minRamBytes = entry?.minRamBytes ?? 0;
  // Explicit caller choice wins; otherwise honor the registry's per-model hint
  // (e.g. Qwen3 pins 'cpu' — its GPU path is broken in LiteRT-LM 0.10.0).
  const backend = options?.backend ?? entry?.preferredBackend ?? 'auto';
  const generation = toNativeGeneration(options?.generation);
  await wrapNative(() =>
    ExpoAiKitModule.setModel(modelId, minRamBytes, backend, generation)
  );
}

/**
 * Get the ID of the currently active model.
 *
 * @returns The active model ID (e.g. 'apple-fm', 'mlkit', 'gemma-e2b')
 */
export function getActiveModel(): string {
  return ExpoAiKitModule.getActiveModel();
}

/**
 * Explicitly unload the current downloadable model from memory.
 *
 * Frees memory and reverts to the platform built-in model.
 * No-op if no downloadable model is currently loaded.
 */
export async function unloadModel(): Promise<void> {
  await wrapNative(() => ExpoAiKitModule.unloadModel());
}

