import type { JSONSchema, ToolSet } from './types';
import { extractJson } from './structured';

// ---------------------------------------------------------------------------
// Pure helpers for generateText() tool calling.
//
// Like structured.ts, this module imports no native module so its logic can be
// unit-tested in plain Node. generateText() (in index.ts) drives the inference
// + tool-execution loop on top of these.
//
// On-device backends have no native tool-call channel, so we define a tiny text
// protocol: the model emits a JSON object `{"tool": "<name>", "arguments": {…}}`
// to request a call, or plain text to answer. We parse that back out tolerantly
// (reusing extractJson), validate the name + args, and run the tool in JS.
// ---------------------------------------------------------------------------

/** Build the instruction appended to the system prompt to enable tool calling. */
export function buildToolInstruction(tools: ToolSet): string {
  const names = Object.keys(tools);
  const lines: string[] = [
    'You have access to the following tools. Use one only when it helps answer the request:',
    '',
  ];
  for (const name of names) {
    const tool = tools[name];
    lines.push(`- ${name}: ${tool.description}`);
    lines.push(`  arguments JSON Schema: ${JSON.stringify(tool.parameters)}`);
  }
  lines.push(
    '',
    'To call a tool, respond with ONLY a JSON object of this exact form and nothing else:',
    '{"tool": "<tool name>", "arguments": { ... }}',
    '',
    'Rules:',
    '- Call at most one tool per response.',
    `- "tool" must be exactly one of: ${names.join(', ')}.`,
    '- "arguments" must conform to that tool\'s arguments JSON Schema.',
    '- If you do not need a tool, answer the user directly in plain text with no JSON.',
    '- After you receive a tool result, use it to answer; do not repeat the same call.'
  );
  return lines.join('\n');
}

/**
 * What {@link parseToolCall} found in a model response.
 *
 * - `tool`: a well-formed call to a known tool (args still need schema validation).
 * - `unknown-tool`: looked like a tool call but the name isn't in the tool set.
 * - `text`: no tool call — treat the response as the final answer.
 */
export type ParsedToolCall =
  | { kind: 'tool'; toolName: string; args: unknown }
  | { kind: 'unknown-tool'; toolName: string }
  | { kind: 'text' };

/**
 * Detect a tool call in model output.
 *
 * A response is a tool call when it contains a JSON object (possibly wrapped in
 * prose or a ```json fence) with a string `tool` field. We tolerate `arguments`
 * or `args` for the payload. If `tool` names something not in `toolNames` it's
 * reported as `unknown-tool` so the loop can re-prompt instead of leaking the
 * raw JSON as an answer. Anything else is plain `text`.
 */
export function parseToolCall(text: string, toolNames: string[]): ParsedToolCall {
  const parsed = extractJson(text);
  if (!parsed.ok) return { kind: 'text' };

  const value = parsed.value;
  if (!isPlainObject(value) || typeof value.tool !== 'string') {
    return { kind: 'text' };
  }

  const toolName = value.tool;
  if (!toolNames.includes(toolName)) {
    return { kind: 'unknown-tool', toolName };
  }

  const rawArgs = 'arguments' in value ? value.arguments : value.args;
  return { kind: 'tool', toolName, args: rawArgs ?? {} };
}

/** Follow-up prompt when the model named a tool that doesn't exist. */
export function buildUnknownToolRepair(toolName: string, toolNames: string[]): string {
  return (
    `The tool "${toolName}" does not exist. ` +
    `Available tools are: ${toolNames.join(', ')}. ` +
    'Either call one of these tools using the required JSON form, or answer in plain text.'
  );
}

/** Follow-up prompt when a tool's proposed arguments failed schema validation. */
export function buildToolArgsRepair(toolName: string, errors: string[]): string {
  const detail = errors.slice(0, 8).join('; ');
  return (
    `The arguments for "${toolName}" did not match its schema: ${detail}. ` +
    'Respond again with ONLY the corrected {"tool": "' +
    toolName +
    '", "arguments": { ... }} JSON — no prose, no markdown code fences.'
  );
}

/**
 * Render a tool result as the user-turn text fed back to the model.
 * Non-string results are JSON-encoded; strings pass through as-is.
 */
export function formatToolResult(toolName: string, result: unknown): string {
  const body =
    typeof result === 'string' ? result : safeStringify(result);
  return `Result of calling the tool "${toolName}":\n${body}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Re-export for callers that want the schema type alongside tool helpers.
export type { JSONSchema };
