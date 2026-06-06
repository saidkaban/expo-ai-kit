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
  ModelErrorCode,
  SetModelOptions,
} from './types';
import { MODEL_REGISTRY, getRegistryEntry } from './models';

export * from './types';
export * from './models';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful, friendly assistant. Answer the user directly and concisely.';

let streamIdCounter = 0;
function generateSessionId(): string {
  return `gen_${Date.now()}_${++streamIdCounter}`;
}

// The set of codes the native layer encodes in error messages as "CODE:modelId:reason".
const KNOWN_ERROR_CODES = new Set<ModelErrorCode>([
  'MODEL_NOT_FOUND',
  'MODEL_NOT_DOWNLOADED',
  'DOWNLOAD_FAILED',
  'DOWNLOAD_CORRUPT',
  'DOWNLOAD_STORAGE_FULL',
  'DOWNLOAD_CANCELLED',
  'INFERENCE_OOM',
  'INFERENCE_FAILED',
  'INFERENCE_BUSY',
  'INFERENCE_CANCELLED',
  'MODEL_LOAD_FAILED',
  'DEVICE_NOT_SUPPORTED',
]);

/**
 * Normalize an error from the native layer into a {@link ModelError}.
 *
 * The native modules format failures as "CODE:modelId:reason" (see the
 * GemmaError/GemmaInferenceClient contract). Expo surfaces that string as the
 * error's message, so we parse it here and rethrow a typed ModelError with a
 * reliable `.code` and `.modelId`. Anything unrecognized becomes UNKNOWN.
 */
function toModelError(e: unknown): never {
  if (e instanceof ModelError) throw e;
  const message = String((e as any)?.message ?? e ?? '');
  const match = /^([A-Z_]+):([^:]*):([\s\S]*)$/.exec(message);
  if (match && KNOWN_ERROR_CODES.has(match[1] as ModelErrorCode)) {
    throw new ModelError(match[1] as ModelErrorCode, match[2], match[3]);
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

  const platformModels = MODEL_REGISTRY.filter((entry) =>
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
 */
export async function setModel(modelId: string, options?: SetModelOptions): Promise<void> {
  const entry = getRegistryEntry(modelId);
  const minRamBytes = entry?.minRamBytes ?? 0;
  const backend = options?.backend ?? 'auto';
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

