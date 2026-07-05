import type {
  EmbeddingModelV3,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { embed, getActiveModel, sendMessage, setModel, streamMessage } from '../index';
import { ModelError, type SetModelOptions } from '../types';
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

/** Model id for the built-in embedding model (Apple NLContextualEmbedding, iOS 17+). */
export const EMBEDDING_MODEL_ID = 'apple-nl-contextual';

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
  /** An EmbeddingModelV3 over embed() — iOS-only (Apple NLContextualEmbedding). */
  embeddingModel(modelId?: string): EmbeddingModelV3;
  /** @deprecated Spec alias for {@link ExpoAiKitProvider.embeddingModel}. */
  textEmbeddingModel(modelId?: string): EmbeddingModelV3;
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
 * - embeddingModel() is iOS-only for now; Android throws DEVICE_NOT_SUPPORTED.
 */
export function createExpoAiKit(): ExpoAiKitProvider {
  const languageModel = (
    modelId: string = AUTO_MODEL_ID,
    settings?: ExpoAiKitModelSettings
  ): LanguageModelV3 => createLanguageModel(modelId, settings);

  const embeddingModel = (modelId: string = EMBEDDING_MODEL_ID): EmbeddingModelV3 => {
    if (modelId !== EMBEDDING_MODEL_ID) {
      throw new ModelError(
        'MODEL_NOT_FOUND',
        modelId,
        `expo-ai-kit has one embedding model: "${EMBEDDING_MODEL_ID}" (Apple NLContextualEmbedding).`
      );
    }
    return createEmbeddingModel();
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

      const content: LanguageModelV3Content[] =
        output.kind === 'tool-call'
          ? [
              {
                type: 'tool-call',
                toolCallId: newPartId('call'),
                toolName: output.toolName,
                input: output.input,
              },
            ]
          : [{ type: 'text', text: output.text }];

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

function createEmbeddingModel(): EmbeddingModelV3 {
  return {
    specificationVersion: 'v3',
    provider: PROVIDER,
    modelId: EMBEDDING_MODEL_ID,
    maxEmbeddingsPerCall: Infinity, // embed() batches internally; no API limit
    supportsParallelCalls: true, // embeddings bypass the single-flight inference guard

    async doEmbed({ values, abortSignal }) {
      if (abortSignal?.aborted) {
        throw new ModelError('INFERENCE_CANCELLED', '', 'Aborted before start');
      }
      const { embeddings } = await embed(values);
      return { embeddings, warnings: [] };
    },
  };
}
