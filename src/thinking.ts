/**
 * Pure handling of thinking-model output — no native imports (unit-tested).
 *
 * Reasoning models (Qwen3, DeepSeek-R1 style) emit their chain of thought in
 * `<think>…</think>` blocks before the actual answer. That text is
 * model-internal: surfacing it as the answer is confusing UX, and worse, a
 * think block can contain JSON- or tool-envelope-looking text that derails
 * generateObject/generateText parsing. The orchestrated paths (generateObject,
 * generateText, the AI SDK provider) strip it via this helper — the raw
 * sendMessage/streamMessage primitives stay raw, and callers can apply
 * {@link stripThinking} themselves.
 */

/** Result of {@link stripThinking}. */
export type StripThinkingResult = {
  /** The answer with all thinking blocks removed (edge-trimmed). */
  text: string;
  /** The concatenated contents of the thinking blocks ('' when none). */
  reasoning: string;
};

const CLOSED_THINK_RE = /<think>([\s\S]*?)<\/think>/g;
const UNCLOSED_THINK_RE = /<think>([\s\S]*)$/;

/**
 * Split model output into the visible answer and its `<think>…</think>`
 * reasoning. Handles multiple blocks and an unclosed trailing `<think>` (a
 * truncated generation that never finished reasoning — everything after the
 * tag is reasoning and the answer is whatever preceded it).
 */
export function stripThinking(raw: string): StripThinkingResult {
  if (typeof raw !== 'string' || raw.indexOf('<think>') === -1) {
    return { text: typeof raw === 'string' ? raw : '', reasoning: '' };
  }

  const reasoningParts: string[] = [];
  let text = raw.replace(CLOSED_THINK_RE, (_, inner: string) => {
    reasoningParts.push(inner.trim());
    return '';
  });
  text = text.replace(UNCLOSED_THINK_RE, (_, inner: string) => {
    reasoningParts.push(inner.trim());
    return '';
  });

  return {
    text: text.trim(),
    reasoning: reasoningParts.filter((part) => part !== '').join('\n\n'),
  };
}
