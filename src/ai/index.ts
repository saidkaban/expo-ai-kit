import type {
  EmbeddingModelV3,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { Platform } from 'react-native';
import { embed, getActiveModel, sendMessage, setModel, streamMessage } from '../index';
import { ANDROID_EMBEDDING_MODEL } from '../models';
import { ModelError, type EmbeddingTask, type SetModelOptions } from '../types';
import { convertCallOptions, extractOutput, EMPTY_USAGE, newPartId } from './convert';

// ---------------------------------------------------------------------------
// Vercel AI SDK provider for expo-ai-kit — `import { expoAiKit } from 'expo-ai-kit/ai'`.
//
// Implements the LanguageModelV3 spec (AI SDK 6; also accepted by AI SDK 7),
// wrapping the same core sendMessage/streamMessage/embed calls as the rest of
// the library — the single-flight INFERENCE_BUSY guard, stateless-model
// semantics, and typed ModelError contract all apply unchanged.
//
// Zero-dependency by construction: everything imported from '@ai-sdk/provider'
// is a *type* (erased at compile time). The package is only needed by consumers
// who use this entry point, as an optional peer for its typings.
// ---------------------------------------------------------------------------

const PROVIDER = 'expo-ai-kit';

/**
 * Sentinel model id meaning "whatever model is currently active" — the OS
 * built-in by default, or whatever the app last activated via setModel().
 * The provider never switches models for this id.
 */
export const AUTO_MODEL_ID = 'auto';

/** Model id for the iOS embedding backend (Apple NLContextualEmbedding, iOS 17+). */
export const APPLE_EMBEDDING_MODEL_ID = 'apple-nl-contextual';

/**
 * Model id for the Android embedding backend (EmbeddingGemma 300M via MediaPipe
 * TextEmbedder — opt-in via the `androidEmbeddings` config-plugin flag).
 */
export const ANDROID_EMBEDDING_MODEL_ID = ANDROID_EMBEDDING_MODEL.id;

/**
 * @deprecated The embedding model is now platform-specific — this constant only
 * names the iOS one. Use {@link APPLE_EMBEDDING_MODEL_ID} /
 * {@link ANDROID_EMBEDDING_MODEL_ID}, or omit the id to get the platform default.
 */
export const EMBEDDING_MODEL_ID = APPLE_EMBEDDING_MODEL_ID;

/**
 * Per-instance embedding settings. `task` says what the vectors are for
 * (mapped onto EmbeddingGemma's prompt protocol on Android; semantic intent
 * only on iOS) and `language` selects the iOS script model (BCP-47; ignored on
 * Android — EmbeddingGemma is natively multilingual). Both can be overridden
 * per call via `providerOptions['expo-ai-kit']`.
 */
export type ExpoAiKitEmbeddingSettings = {
  task?: EmbeddingTask;
  language?: string;
};

/**
 * Per-instance model settings, applied when this instance activates its model
 * (same shape as {@link setModel}'s options). If the model is already active,
 * it is NOT reloaded — on-device model loads are expensive, so sampling config
 * effectively belongs to whoever activated the model first.
 */
export type ExpoAiKitModelSettings = SetModelOptions;

export interface ExpoAiKitProvider {
  /** Shorthand for {@link ExpoAiKitProvider.languageModel}. */
  (modelId?: string, settings?: ExpoAiKitModelSettings): LanguageModelV3;
  /**
   * A LanguageModelV3 over the on-device model. Pass any model id accepted by
   * setModel() ('apple-fm', 'mlkit', 'gemma-e2b', a registerModel() id, …) to
   * have the provider activate it before generating, or omit / pass 'auto' to
   * use whatever model is already active.
   */
  languageModel(modelId?: string, settings?: ExpoAiKitModelSettings): LanguageModelV3;
  /**
   * An EmbeddingModelV3 over embed(). Omit `modelId` for the platform default —
   * Apple NLContextualEmbedding on iOS, EmbeddingGemma 300M on Android (opt-in
   * via the `androidEmbeddings` config-plugin flag). The instance's `modelId`
   * reports the resolved platform-specific model truthfully.
   */
  embeddingModel(modelId?: string, settings?: ExpoAiKitEmbeddingSettings): EmbeddingModelV3;
  /** @deprecated Spec alias for {@link ExpoAiKitProvider.embeddingModel}. */
  textEmbeddingModel(modelId?: string, settings?: ExpoAiKitEmbeddingSettings): EmbeddingModelV3;
  /** expo-ai-kit has no image models; always throws MODEL_NOT_FOUND. */
  imageModel(modelId: string): never;
}

/**
 * Create an expo-ai-kit provider for the Vercel AI SDK.
 *
 * ```ts
 * import { generateText, streamText } from 'ai';
 * import { expoAiKit } from 'expo-ai-kit/ai';
 *
 * const { text } = await generateText({
 *   model: expoAiKit(),               // the active on-device model
 *   prompt: 'Capital of France?',
 * });
 *
 * const result = streamText({
 *   model: expoAiKit('gemma-e2b'),    // activates gemma-e2b first (must be downloaded)
 *   prompt: 'Write a short story',
 * });
 * ```
 *
 * On-device caveats (all documented in the guide):
 * - One generation at a time — concurrent calls reject with INFERENCE_BUSY.
 * - Per-call sampling (temperature, topK, …) is reported as an unsupported-
 *   setting warning; sampling is fixed when the model is activated.
 * - Tool calling and JSON output ride the same prompt protocol as
 *   generateText()/generateObject() — single-shot here, since the AI SDK owns
 *   the loop. Streaming buffers when tools/JSON are requested (the envelope
 *   must be parsed whole, not surfaced as text deltas).
 * - embeddingModel() resolves per platform: Apple NLContextualEmbedding on iOS,
 *   EmbeddingGemma 300M on Android (opt-in — the `androidEmbeddings` config-
 *   plugin flag plus a prepareEmbeddingModel() download; otherwise it throws a
 *   typed error). Pass { task } for retrieval-quality Android vectors.
 */
export function createExpoAiKit(): ExpoAiKitProvider {
  const languageModel = (
    modelId: string = AUTO_MODEL_ID,
    settings?: ExpoAiKitModelSettings
  ): LanguageModelV3 => createLanguageModel(modelId, settings);

  const embeddingModel = (
    modelId?: string,
    settings?: ExpoAiKitEmbeddingSettings
  ): EmbeddingModelV3 => {
    // Resolve the platform default honestly: one embedding backend per
    // platform, and the instance reports that platform-specific id.
    const platformDefault =
      Platform.OS === 'android' ? ANDROID_EMBEDDING_MODEL_ID : APPLE_EMBEDDING_MODEL_ID;
    const resolved = modelId ?? platformDefault;
    if (resolved !== platformDefault) {
      throw new ModelError(
        'MODEL_NOT_FOUND',
        resolved,
        `expo-ai-kit has one embedding model per platform — "${APPLE_EMBEDDING_MODEL_ID}" on iOS ` +
          `(Apple NLContextualEmbedding), "${ANDROID_EMBEDDING_MODEL_ID}" on Android (EmbeddingGemma). ` +
          'Omit the id to use the current platform\'s model.'
      );
    }
    return createEmbeddingModel(resolved, settings);
  };

  const provider = languageModel as ExpoAiKitProvider;
  provider.languageModel = languageModel;
  provider.embeddingModel = embeddingModel;
  provider.textEmbeddingModel = embeddingModel;
  provider.imageModel = (modelId: string): never => {
    throw new ModelError('MODEL_NOT_FOUND', modelId, 'expo-ai-kit does not provide image models.');
  };
  return provider;
}

/** The default provider instance. */
export const expoAiKit: ExpoAiKitProvider = createExpoAiKit();

// ---------------------------------------------------------------------------
// Language model
// ---------------------------------------------------------------------------

function createLanguageModel(
  modelId: string,
  settings?: ExpoAiKitModelSettings
): LanguageModelV3 {
  /**
   * Make sure this instance's model is the active one. 'auto' never switches.
   * Deliberately skipped when already active: reloading a multi-GB model per
   * call would be catastrophic, so settings apply on activation only.
   */
  const ensureModel = async (): Promise<string> => {
    if (modelId === AUTO_MODEL_ID) {
      try {
        return getActiveModel();
      } catch {
        return AUTO_MODEL_ID; // native module unavailable (e.g. web) — let the call itself fail
      }
    }
    let active: string | undefined;
    try {
      active = getActiveModel();
    } catch {
      active = undefined;
    }
    if (active !== modelId) {
      await setModel(modelId, settings);
    }
    return modelId;
  };

  return {
    specificationVersion: 'v3',
    provider: PROVIDER,
    modelId,
    supportedUrls: {}, // no URLs are consumed natively — text-only models

    async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      const call = convertCallOptions(options);
      const activeModelId = await ensureModel();

      const { text } = await sendMessage(call.messages, { signal: options.abortSignal });
      const output = extractOutput(text, call.toolNames, call.jsonMode);

      const content: LanguageModelV3Content[] = [];
      if (output.reasoning !== '') {
        // Thinking models (Qwen3): surface <think> content as a spec reasoning
        // part instead of polluting the text/tool output.
        content.push({ type: 'reasoning', text: output.reasoning });
      }
      if (output.kind === 'tool-call') {
        content.push({
          type: 'tool-call',
          toolCallId: newPartId('call'),
          toolName: output.toolName,
          input: output.input,
        });
      } else {
        content.push({ type: 'text', text: output.text });
      }

      return {
        content,
        finishReason: {
          unified: output.kind === 'tool-call' ? 'tool-calls' : 'stop',
          raw: undefined,
        },
        usage: EMPTY_USAGE,
        warnings: call.warnings,
        response: { modelId: activeModelId, timestamp: new Date() },
      };
    },

    async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
      if (typeof ReadableStream === 'undefined') {
        throw new Error(
          'expo-ai-kit/ai: streaming needs a ReadableStream polyfill in React Native ' +
            '(e.g. web-streams-polyfill) — the AI SDK requires the same polyfills. See the docs.'
        );
      }

      const call = convertCallOptions(options);
      const activeModelId = await ensureModel();
      const abortSignal = options.abortSignal;

      // Tool calling / JSON mode: the envelope must be parsed as a whole — a
      // half-streamed `{"tool": …` would surface as garbage text deltas — so
      // those runs buffer and emit the parsed result in one go.
      if (call.toolNames.length > 0 || call.jsonMode) {
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          start: async (controller) => {
            controller.enqueue({ type: 'stream-start', warnings: call.warnings });
            controller.enqueue({
              type: 'response-metadata',
              modelId: activeModelId,
              timestamp: new Date(),
            });
            try {
              const { text } = await sendMessage(call.messages, { signal: abortSignal });
              const output = extractOutput(text, call.toolNames, call.jsonMode);
              if (output.reasoning !== '') {
                const rid = newPartId('reasoning');
                controller.enqueue({ type: 'reasoning-start', id: rid });
                controller.enqueue({ type: 'reasoning-delta', id: rid, delta: output.reasoning });
                controller.enqueue({ type: 'reasoning-end', id: rid });
              }
              if (output.kind === 'tool-call') {
                const id = newPartId('call');
                controller.enqueue({ type: 'tool-input-start', id, toolName: output.toolName });
                controller.enqueue({ type: 'tool-input-delta', id, delta: output.input });
                controller.enqueue({ type: 'tool-input-end', id });
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: id,
                  toolName: output.toolName,
                  input: output.input,
                });
                controller.enqueue({
                  type: 'finish',
                  usage: EMPTY_USAGE,
                  finishReason: { unified: 'tool-calls', raw: undefined },
                });
              } else {
                const id = newPartId('text');
                controller.enqueue({ type: 'text-start', id });
                controller.enqueue({ type: 'text-delta', id, delta: output.text });
                controller.enqueue({ type: 'text-end', id });
                controller.enqueue({
                  type: 'finish',
                  usage: EMPTY_USAGE,
                  finishReason: { unified: 'stop', raw: undefined },
                });
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        });
        return { stream };
      }

      // Plain text: real token streaming over streamMessage().
      let handle: ReturnType<typeof streamMessage> | undefined;
      let settled = false;
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start: (controller) => {
          controller.enqueue({ type: 'stream-start', warnings: call.warnings });
          controller.enqueue({
            type: 'response-metadata',
            modelId: activeModelId,
            timestamp: new Date(),
          });

          const textId = newPartId('text');
          let textStarted = false;

          const onAbort = () => {
            if (settled) return;
            settled = true;
            handle?.stop(); // stops native generation; promise resolves with partial text
            controller.error(new ModelError('INFERENCE_CANCELLED', '', 'Aborted by caller'));
          };
          abortSignal?.addEventListener('abort', onAbort, { once: true });

          handle = streamMessage(call.messages, (event) => {
            if (settled) return;
            if (event.token !== '') {
              if (!textStarted) {
                textStarted = true;
                controller.enqueue({ type: 'text-start', id: textId });
              }
              controller.enqueue({ type: 'text-delta', id: textId, delta: event.token });
            }
            if (event.isDone) {
              settled = true;
              abortSignal?.removeEventListener('abort', onAbort);
              if (textStarted) controller.enqueue({ type: 'text-end', id: textId });
              controller.enqueue({
                type: 'finish',
                usage: EMPTY_USAGE,
                finishReason: { unified: 'stop', raw: undefined },
              });
              controller.close();
            }
          });

          handle.promise.catch((error) => {
            if (settled) return;
            settled = true;
            abortSignal?.removeEventListener('abort', onAbort);
            controller.error(error);
          });
        },
        cancel: () => {
          settled = true;
          handle?.stop();
        },
      });
      return { stream };
    },
  };
}

// ---------------------------------------------------------------------------
// Embedding model
// ---------------------------------------------------------------------------

function createEmbeddingModel(
  modelId: string,
  settings?: ExpoAiKitEmbeddingSettings
): EmbeddingModelV3 {
  // Warn (once per instance, dev builds only) when embedding without an
  // explicit task: EmbeddingGemma vectors are task-conditioned, so an implicit
  // 'semantic-similarity' default silently degrades Android retrieval quality.
  let warnedNoTask = false;

  return {
    specificationVersion: 'v3',
    provider: PROVIDER,
    modelId,
    maxEmbeddingsPerCall: Infinity, // embed() batches internally; no API limit
    // Concurrent doEmbed calls are safe: embeddings bypass the single-flight
    // inference guard on both platforms. iOS runs them independently; Android
    // serializes them behind a native mutex (queued, never rejected).
    supportsParallelCalls: true,

    async doEmbed({ values, abortSignal, providerOptions }) {
      if (abortSignal?.aborted) {
        throw new ModelError('INFERENCE_CANCELLED', '', 'Aborted before start');
      }
      const perCall = providerOptions?.[PROVIDER] as ExpoAiKitEmbeddingSettings | undefined;
      const task = perCall?.task ?? settings?.task;
      const language = perCall?.language ?? settings?.language;

      if (task == null && !warnedNoTask && typeof __DEV__ !== 'undefined' && __DEV__) {
        warnedNoTask = true;
        console.warn(
          'expo-ai-kit/ai: embedding without an explicit task — defaulting to ' +
            "'semantic-similarity'. For RAG on Android (EmbeddingGemma), pass " +
            "{ task: 'retrieval-document' } when indexing and { task: 'retrieval-query' } " +
            'for queries (embeddingModel settings or providerOptions["expo-ai-kit"]).'
        );
      }

      const { embeddings } = await embed(values, { task, language });
      return { embeddings, warnings: [] };
    },
  };
}
