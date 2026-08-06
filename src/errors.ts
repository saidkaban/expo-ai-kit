/**
 * Pure parsing of the native error contract — no native imports (unit-tested).
 *
 * Both native modules format failures as "CODE:modelId:reason" (e.g.
 * "MODEL_NOT_DOWNLOADED:gemma-e2b:Model file not found on disk"). Depending on
 * the Expo SDK, that string may reach JS as the whole error message or wrapped
 * by expo-modules-core's exception decorator, e.g.
 *
 *   Call to function 'ExpoAiKit.prepareEmbeddingModel' has been rejected.
 *   → Caused by: java.lang.RuntimeException: DOWNLOAD_FAILED:embedding-gemma-300m:…
 *
 * so the parser first tries the bare contract at the start of the message and
 * then scans for the first *known* code anywhere in it. Requiring the code to
 * be known keeps random ALLCAPS:with:colons text from ever producing a bogus
 * typed error.
 */

import type { ModelErrorCode } from './types';

/** The set of codes the native layer encodes in error messages as "CODE:modelId:reason". */
export const KNOWN_ERROR_CODES: ReadonlySet<ModelErrorCode> = new Set<ModelErrorCode>([
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
  'EMBEDDINGS_NOT_ENABLED',
  'LANGUAGE_NOT_SUPPORTED',
  'SPEECH_BUSY',
  'SPEECH_NOT_ENABLED',
  'MIC_PERMISSION_DENIED',
  'AUDIO_DECODE_FAILED',
  'TRANSCRIPTION_FAILED',
]);

export type ParsedNativeError = {
  code: ModelErrorCode;
  modelId: string;
  reason: string;
};

/**
 * Extract the "CODE:modelId:reason" contract from a native error message.
 * Returns null when no known code is present (callers fall back to UNKNOWN).
 */
export function parseNativeErrorMessage(message: string): ParsedNativeError | null {
  if (typeof message !== 'string' || message === '') return null;

  // Fast path: the whole message is the bare contract.
  const direct = /^([A-Z_]+):([^:\n]*):([\s\S]*)$/.exec(message);
  if (direct && KNOWN_ERROR_CODES.has(direct[1] as ModelErrorCode)) {
    return { code: direct[1] as ModelErrorCode, modelId: direct[2], reason: direct[3] };
  }

  // Wrapped path: find the first known code anywhere (reason runs to end of line).
  const scan = /([A-Z][A-Z_]*):([^:\n]*):([^\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = scan.exec(message)) !== null) {
    if (KNOWN_ERROR_CODES.has(match[1] as ModelErrorCode)) {
      return { code: match[1] as ModelErrorCode, modelId: match[2], reason: match[3] };
    }
    // Unknown ALLCAPS token: re-scan from just past its first character so a
    // known code glued inside it (e.g. "XDOWNLOAD_FAILED:…") is still found.
    scan.lastIndex = match.index + 1;
  }
  return null;
}
