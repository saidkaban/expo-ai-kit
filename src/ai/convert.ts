import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';

import { buildSchemaInstruction, extractJson } from '../structured';
import { stripThinking } from '../thinking';
import { buildToolInstruction, formatToolResult, parseToolCall } from '../tools';
import { ModelError, type JSONSchema, type LLMMessage, type ToolSet } from '../types';

// ---------------------------------------------------------------------------
// Pure helpers for the Vercel AI SDK provider (src/ai/index.ts).
//
// Like structured.ts and tools.ts, this module imports no native module so its
// logic can be unit-tested in plain Node. It maps the AI SDK's LanguageModelV3
// call options onto our LLMMessage[] protocol, reusing the exact same tool
// instruction / tool-call envelope as generateText() and the same JSON-Schema
// instruction / extraction as generateObject(), so a model behaves identically
// whether it's driven through the AI SDK or through the core API.
//
// Only *type* imports from '@ai-sdk/provider' are allowed here (they compile
// away), keeping the published JS free of runtime dependencies.
// ---------------------------------------------------------------------------

/**
 * On-device runtimes report no token counts, so every usage field is
 * `undefined` (the shape the spec prescribes for "unknown").
 */
export const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
  },
};

let idCounter = 0;
/** Unique-enough id for stream parts / tool calls within a session. */
export function newPartId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

/** Everything doGenerate/doStream needs, derived from LanguageModelV3CallOptions. */
export type ConvertedCall = {
  /** The conversation in our core protocol, instructions merged into the system message. */
  messages: LLMMessage[];
  /** Names of function tools offered to the model ([] when none / toolChoice 'none'). */
  toolNames: string[];
  /** True when responseFormat is JSON, output should be extracted as JSON. */
  jsonMode: boolean;
  /** Spec warnings for settings we cannot honor on-device. */
  warnings: SharedV3Warning[];
};

// Per-call sampling knobs the AI SDK passes that on-device runtimes fix at
// setModel() time (LiteRT-LM builds its sampler at conversation creation).
const FIXED_AT_SETMODEL = [
  'temperature',
  'topP',
  'topK',
  'seed',
  'maxOutputTokens',
  'stopSequences',
  'presencePenalty',
  'frequencyPenalty',
] as const;

/**
 * Map the AI SDK's call options onto our core `LLMMessage[]` protocol.
 *
 * - System messages are merged into one leading system message, with the tool
 *   instruction (tools.ts) and/or JSON-Schema instruction (structured.ts)
 *   appended, the same prompt protocol as generateText / generateObject.
 * - Assistant tool-call parts are re-rendered as the `{"tool", "arguments"}`
 *   envelope and tool results as formatToolResult() text, so multi-step AI SDK
 *   conversations round-trip through the exact format the model was taught.
 * - Per-call sampling settings can't be honored (fixed at setModel) and are
 *   reported as spec warnings instead of being silently dropped.
 *
 * @throws {ModelError} DEVICE_NOT_SUPPORTED on file/image prompt parts,
 *   on-device text models have no media input (vision is on the roadmap).
 */
export function convertCallOptions(options: LanguageModelV3CallOptions): ConvertedCall {
  const warnings: SharedV3Warning[] = [];

  for (const setting of FIXED_AT_SETMODEL) {
    if (options[setting] != null) {
      warnings.push({
        type: 'unsupported',
        feature: setting,
        details:
          'On-device sampling is fixed when the model is activated (setModel / provider settings), not per call.',
      });
    }
  }

  // --- Tools → the generateText() text protocol -----------------------------
  const toolSet: ToolSet = {};
  const toolChoice = options.toolChoice ?? { type: 'auto' };
  if (options.tools && toolChoice.type !== 'none') {
    for (const tool of options.tools) {
      if (tool.type === 'function') {
        toolSet[tool.name] = {
          description: tool.description ?? '',
          parameters: toLocalSchema((tool as LanguageModelV3FunctionTool).inputSchema),
        };
      } else {
        warnings.push({
          type: 'unsupported',
          feature: `provider tool "${tool.id}"`,
          details: 'expo-ai-kit runs on-device models; provider-executed tools are not available.',
        });
      }
    }
  }
  const toolNames = Object.keys(toolSet);

  let toolInstruction = toolNames.length > 0 ? buildToolInstruction(toolSet) : '';
  if (toolNames.length > 0 && toolChoice.type === 'required') {
    toolInstruction += '\n- For this request you MUST call one of the tools.';
    warnings.push({
      type: 'compatibility',
      feature: "toolChoice: 'required'",
      details: 'Enforced via a prompt nudge, on-device models have no constrained decoding yet.',
    });
  } else if (toolNames.length > 0 && toolChoice.type === 'tool') {
    toolInstruction += `\n- For this request you MUST call the tool "${toolChoice.toolName}".`;
    warnings.push({
      type: 'compatibility',
      feature: `toolChoice: { type: 'tool' }`,
      details: 'Enforced via a prompt nudge, on-device models have no constrained decoding yet.',
    });
  }

  // --- responseFormat json → the generateObject() instruction ---------------
  let jsonMode = false;
  let schemaInstruction = '';
  if (options.responseFormat?.type === 'json') {
    if (toolNames.length > 0) {
      // The SDK never combines them; if a caller does, tools win.
      warnings.push({
        type: 'other',
        message: 'responseFormat: json is ignored when tools are provided.',
      });
    } else {
      jsonMode = true;
      schemaInstruction = options.responseFormat.schema
        ? buildSchemaInstruction(toLocalSchema(options.responseFormat.schema))
        : 'Respond with ONLY a valid JSON value, no prose, no markdown code fences.';
    }
  }

  // --- Prompt → LLMMessage[] -------------------------------------------------
  const systemParts: string[] = [];
  const messages: LLMMessage[] = [];

  for (const message of options.prompt) {
    switch (message.role) {
      case 'system': {
        systemParts.push(message.content);
        break;
      }
      case 'user': {
        const text = message.content
          .map((part) => {
            if (part.type === 'text') return part.text;
            throw unsupportedPart(part.type);
          })
          .join('');
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'assistant': {
        const chunks: string[] = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            chunks.push(part.text);
          } else if (part.type === 'tool-call') {
            // Re-render past calls in the envelope the model was taught, so
            // multi-step conversations stay in-protocol.
            chunks.push(JSON.stringify({ tool: part.toolName, arguments: part.input ?? {} }));
          } else if (part.type === 'reasoning') {
            // Model-internal; not replayed.
          } else if (part.type === 'tool-result') {
            // Provider-executed results never occur here (we execute nothing).
          } else {
            throw unsupportedPart(part.type);
          }
        }
        const text = chunks.join('\n');
        if (text !== '') messages.push({ role: 'assistant', content: text });
        break;
      }
      case 'tool': {
        const chunks: string[] = [];
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            chunks.push(formatToolResult(part.toolName, unwrapToolOutput(part.output)));
          }
          // tool-approval-response: we never emit approval requests, so none
          // can legitimately appear; ignore defensively.
        }
        if (chunks.length > 0) messages.push({ role: 'user', content: chunks.join('\n\n') });
        break;
      }
    }
  }

  const instructions = [toolInstruction, schemaInstruction].filter((s) => s !== '');
  const system = [...systemParts, ...instructions].join('\n\n');
  if (system !== '') {
    messages.unshift({ role: 'system', content: system });
  }

  return { messages, toolNames, jsonMode, warnings };
}

/** What the model's raw text turned out to be, per the offered capabilities. */
export type ExtractedOutput =
  | { kind: 'text'; text: string; reasoning: string }
  | { kind: 'tool-call'; toolName: string; input: string; reasoning: string };

/**
 * Interpret raw model output for the AI SDK: split off `<think>` reasoning
 * (thinking models, surfaced as a spec reasoning part, and excluded from
 * parsing so it can't derail the envelope/JSON), then detect a tool-call
 * envelope when tools were offered (reusing parseToolCall) or extract/clean the
 * JSON value in json mode (reusing extractJson). Single-shot, the repair
 * loops live in the core generateText/generateObject, not in the provider.
 */
export function extractOutput(
  rawText: string,
  toolNames: string[],
  jsonMode: boolean
): ExtractedOutput {
  const { text, reasoning } = stripThinking(rawText);

  if (toolNames.length > 0) {
    const parsed = parseToolCall(text, toolNames);
    if (parsed.kind === 'tool') {
      return {
        kind: 'tool-call',
        toolName: parsed.toolName,
        input: safeStringify(parsed.args ?? {}),
        reasoning,
      };
    }
    // 'unknown-tool' deliberately falls through to text: the provider is
    // single-shot, so surfacing the output beats silently retrying.
    return { kind: 'text', text, reasoning };
  }

  if (jsonMode) {
    const parsed = extractJson(text);
    if (parsed.ok) return { kind: 'text', text: safeStringify(parsed.value), reasoning };
    return { kind: 'text', text, reasoning }; // let the SDK report the parse failure honestly
  }

  return { kind: 'text', text, reasoning };
}

/** Unwrap the spec's tool-result output union into a plain value for formatToolResult. */
export function unwrapToolOutput(output: LanguageModelV3ToolResultOutput): unknown {
  switch (output.type) {
    case 'text':
      return output.value;
    case 'json':
      return output.value;
    case 'error-text':
      return { error: output.value };
    case 'error-json':
      return { error: output.value };
    case 'execution-denied':
      return { error: `Tool execution denied${output.reason ? `: ${output.reason}` : ''}` };
    case 'content':
      return output.value
        .map((part) => (part.type === 'text' ? part.text : `[${part.type} omitted]`))
        .join('\n');
  }
}

/**
 * The spec's JSONSchema7 and our pragmatic JSONSchema subset are structurally
 * compatible for prompting purposes (both serialize to the same JSON); this
 * cast localizes the type-system disagreement to one place.
 */
function toLocalSchema(schema: unknown): JSONSchema {
  if (typeof schema === 'object' && schema !== null) return schema as JSONSchema;
  return {};
}

function unsupportedPart(type: string): ModelError {
  return new ModelError(
    'DEVICE_NOT_SUPPORTED',
    '',
    `expo-ai-kit AI SDK provider: "${type}" prompt parts are not supported, ` +
      'on-device models take text only (vision input is on the roadmap).'
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode bytes as base64 without Buffer/btoa (neither is guaranteed in React
 * Native). Used by the transcription model to pass AI SDK audio input
 * (Uint8Array) to the native layer.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    result += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    result += b2 === undefined ? '=' : BASE64_CHARS[b2 & 63];
  }
  return result;
}
