/**
 * Pure helpers for embed(), language-tag normalization and task validation.
 *
 * Like structured.ts / tools.ts / rag.ts, this module imports no native module,
 * so it is unit-testable in plain Node. The actual language → model resolution
 * happens natively (NLLanguage on iOS); this layer canonicalizes the BCP-47
 * shape so the native side sees consistent input ("EN_us" → "en-US").
 */

import type { EmbeddingTask } from './types';

/** All values accepted for {@link EmbedOptions.task}. */
export const EMBEDDING_TASKS: readonly EmbeddingTask[] = [
  'semantic-similarity',
  'retrieval-query',
  'retrieval-document',
] as const;

/** Type guard for {@link EmbeddingTask}. */
export function isValidEmbeddingTask(value: unknown): value is EmbeddingTask {
  return typeof value === 'string' && (EMBEDDING_TASKS as readonly string[]).includes(value);
}

const SUBTAG_RE = /^[a-zA-Z0-9]{1,8}$/;

/**
 * Canonicalize a BCP-47 language tag: `_` separators become `-`, the primary
 * language subtag is lowercased, a 4-letter script subtag is Titlecased, and a
 * 2-letter (or 3-digit) region subtag is uppercased, `"EN_us"` → `"en-US"`,
 * `"zh-hans"` → `"zh-Hans"`. Later subtags (variants/extensions) are passed
 * through lowercased.
 *
 * Throws a plain `Error` when the tag is not even shaped like BCP-47 (empty,
 * non-string, or a primary subtag that isn't 2–3 letters). Whether a language
 * is actually *supported* is decided natively, iOS throws a typed
 * LANGUAGE_NOT_SUPPORTED ModelError naming the rejected language.
 */
export function normalizeLanguageTag(tag: string): string {
  if (typeof tag !== 'string') {
    throw new Error('language must be a BCP-47 string (e.g. "en", "fr", "zh-Hans")');
  }
  const trimmed = tag.trim().replace(/_/g, '-');
  if (trimmed === '') {
    throw new Error('language must be a non-empty BCP-47 tag (e.g. "en", "fr", "zh-Hans")');
  }
  const parts = trimmed.split('-');
  if (!/^[a-zA-Z]{2,3}$/.test(parts[0])) {
    throw new Error(
      `Invalid language tag "${tag}": the primary subtag must be 2–3 letters (e.g. "en", "fil")`
    );
  }
  return parts
    .map((part, i) => {
      if (!SUBTAG_RE.test(part)) {
        throw new Error(`Invalid language tag "${tag}": bad subtag "${part}"`);
      }
      if (i === 0) return part.toLowerCase();
      if (/^[a-zA-Z]{4}$/.test(part)) {
        // Script subtag (e.g. Hans, Cyrl)
        return part[0].toUpperCase() + part.slice(1).toLowerCase();
      }
      if (/^[a-zA-Z]{2}$/.test(part) || /^[0-9]{3}$/.test(part)) {
        // Region subtag (e.g. US, 419)
        return part.toUpperCase();
      }
      return part.toLowerCase();
    })
    .join('-');
}
