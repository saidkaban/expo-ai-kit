/**
 * Pure speech-to-text logic, no native imports (unit-tested).
 *
 * Locale registries, option validation, and live-transcript assembly. The
 * native layers stay thin: they forward raw engine output (volatile/partial
 * text and finalized segments) and JS assembles the running transcript here.
 */

import type { TranscribeAudioSource, TranscriptionUpdate } from './types';

/**
 * Locales supported by ML Kit GenAI Speech Recognition Basic mode
 * (genai-speech-recognition 1.0.0-alpha1, verified 2026-08-05). en-US is
 * stable; the rest are documented as beta. Exact-match after normalization.
 */
export const ANDROID_BASIC_SPEECH_LOCALES: readonly string[] = [
  'en-US',
  'fr-FR',
  'it-IT',
  'de-DE',
  'es-ES',
  'hi-IN',
  'ja-JP',
  'pt-BR',
  'tr-TR',
  'pl-PL',
  'cmn-Hans-CN',
  'ko-KR',
  'cmn-Hant-TW',
  'ru-RU',
  'vi-VN',
];

/**
 * Locales supported by Advanced mode (Gemini Nano, Pixel-10-class devices).
 * Superset used only when the native layer reports mode 'advanced'.
 */
export const ANDROID_ADVANCED_SPEECH_LOCALES: readonly string[] = [
  'en-US',
  'ko-KR',
  'es-ES',
  'fr-FR',
  'de-DE',
  'it-IT',
  'pt-PT',
  'cmn-Hans-CN',
  'cmn-Hant-TW',
  'ja-JP',
  'th-TH',
  'ru-RU',
  'nl-NL',
  'da-DK',
  'sv-SE',
  'pl-PL',
  'hi-IN',
  'vi-VN',
  'id-ID',
  'ar-SA',
  'tr-TR',
];

/**
 * Normalize a BCP-47 tag to canonical casing: language lowercase, script
 * Titlecase, region uppercase ('cmn-hans-cn' -> 'cmn-Hans-CN'). Underscores
 * are treated as hyphens. Returns undefined for empty/absent input so callers
 * can fall through to the device locale.
 */
export function normalizeSpeechLocale(tag?: string): string | undefined {
  if (typeof tag !== 'string') return undefined;
  const trimmed = tag.trim().replace(/_/g, '-');
  if (trimmed === '') return undefined;
  return trimmed
    .split('-')
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4) {
        return part[0].toUpperCase() + part.slice(1).toLowerCase();
      }
      if (part.length === 2 || part.length === 3) return part.toUpperCase();
      return part;
    })
    .join('-');
}

/**
 * Resolve a requested locale against a supported list: exact match first,
 * then the first entry sharing the primary language ('en' -> 'en-US').
 * Returns undefined when nothing matches.
 */
export function resolveSpeechLocale(
  requested: string,
  supported: readonly string[]
): string | undefined {
  const normalized = normalizeSpeechLocale(requested);
  if (!normalized) return undefined;
  const exact = supported.find((s) => s === normalized);
  if (exact) return exact;
  const language = normalized.split('-')[0];
  return supported.find((s) => s.split('-')[0] === language);
}

/**
 * Validate and normalize transcribe() audio input. Throws a plain Error for
 * caller mistakes (wrong shape), matching how sendMessage treats empty input.
 */
export function validateTranscribeAudio(audio: TranscribeAudioSource): {
  uri: string;
  base64: string;
  mediaType: string;
} {
  const hasUri = 'uri' in audio && typeof audio.uri === 'string' && audio.uri.length > 0;
  const hasBase64 =
    'base64' in audio && typeof audio.base64 === 'string' && audio.base64.length > 0;
  if (hasUri === hasBase64) {
    throw new Error('transcribe(): audio must be exactly one of { uri } or { base64 } (non-empty)');
  }
  return {
    uri: hasUri ? (audio as { uri: string }).uri : '',
    base64: hasBase64 ? (audio as { base64: string }).base64 : '',
    mediaType: ('mediaType' in audio ? audio.mediaType : undefined) ?? '',
  };
}

/**
 * Assemble a running transcript from raw engine updates.
 *
 * Both engines emit the same shape: non-final text REPLACES the current
 * volatile tail (iOS volatile results; Android partials), final text COMMITS
 * a segment and clears the tail. The assembled text is finalized segments
 * plus the tail, single-spaced.
 */
export function createTranscriptAssembler(): {
  apply(update: Pick<TranscriptionUpdate, 'text' | 'isFinal'>): string;
  current(): string;
} {
  const finalized: string[] = [];
  let volatileTail = '';

  const assemble = (): string =>
    [...finalized, volatileTail]
      .filter((part) => part.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  return {
    apply(update) {
      if (update.isFinal) {
        if (update.text.length > 0) finalized.push(update.text);
        volatileTail = '';
      } else {
        volatileTail = update.text;
      }
      return assemble();
    },
    current: assemble,
  };
}
