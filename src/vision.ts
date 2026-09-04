/**
 * Pure vision logic, no native imports (unit-tested).
 *
 * Option validation and normalization for removeBackground(), labelImage(),
 * and recognizeText(), the Android text-recognition language registry, and
 * the availability-payload normalizer. The native layers do the actual work
 * with Apple Vision (iOS) and ML Kit (Android).
 */

import { normalizeSpeechLocale, resolveSpeechLocale } from './speech';
import type {
  LabelImageOptions,
  RecognizeTextOptions,
  RemoveBackgroundOptions,
  TextRecognitionLevel,
  VisionAvailability,
  VisionFeature,
  VisionFeatureAvailability,
  VisionImageFormat,
  VisionImageSource,
  VisionUnavailableReason,
} from './types';

/** The three vision features, in the order prepareVision() prepares them. */
export const VISION_FEATURES: readonly VisionFeature[] = [
  'background-removal',
  'image-labeling',
  'text-recognition',
];

/**
 * Languages ML Kit Text Recognition v2 can read, across its five script models
 * (Latin, Chinese, Japanese, Korean, Devanagari). Static, the engine has no
 * enumeration API. Verified against the ML Kit language list 2026-09-02.
 */
export const ANDROID_TEXT_RECOGNITION_LANGUAGES: readonly string[] = [
  // Latin script
  'af',
  'sq',
  'ca',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fil',
  'fi',
  'fr',
  'de',
  'hu',
  'is',
  'id',
  'it',
  'lv',
  'lt',
  'ms',
  'no',
  'pl',
  'pt',
  'ro',
  'sr-Latn',
  'sk',
  'sl',
  'es',
  'sv',
  'tr',
  'vi',
  // Chinese / Japanese / Korean script models
  'zh',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  // Devanagari script model
  'hi',
  'mr',
  'ne',
];

/** Default decode budget for removeBackground() (width × height). */
export const DEFAULT_REMOVE_BACKGROUND_MAX_PIXELS = 6_000_000;
/** Hard ceiling for `maxPixels`, bounding decode memory on both platforms. */
export const MAX_REMOVE_BACKGROUND_PIXELS = 25_000_000;
/** Default JPEG quality for removeBackground({ format: 'jpeg' }). */
export const DEFAULT_CUTOUT_JPEG_QUALITY = 0.9;
/** Default cap for labelImage(). */
export const DEFAULT_LABEL_MAX_RESULTS = 10;
/** Default confidence floor for labelImage(). */
export const DEFAULT_LABEL_MIN_CONFIDENCE = 0.5;

/**
 * Validate the image argument of a vision call and return its URI. Throws a
 * plain Error for caller mistakes (wrong shape), matching how sendMessage
 * treats empty input.
 */
export function validateVisionImage(image: VisionImageSource, functionName: string): string {
  const uri =
    image && typeof image === 'object' && 'uri' in image && typeof image.uri === 'string'
      ? image.uri.trim()
      : '';
  if (uri === '') {
    throw new Error(`${functionName}(): image must be { uri } with a non-empty file URI or path`);
  }
  return uri;
}

/**
 * Normalize BCP-47 tags to canonical casing, dropping empties and duplicates
 * while preserving order ('EN_us' -> 'en-US').
 */
export function normalizeLanguageTags(tags?: readonly string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeSpeechLocale(typeof tag === 'string' ? tag : undefined);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Whether Android's ML Kit text recognizer can read a language: exact match
 * first, then the same primary language ('en-GB' -> 'en', 'zh-TW' -> 'zh').
 */
export function isAndroidTextLanguageSupported(tag: string): boolean {
  return resolveSpeechLocale(tag, ANDROID_TEXT_RECOGNITION_LANGUAGES) !== undefined;
}

/** Validate the `features` option of prepareVision(); defaults to all three. */
export function resolveVisionFeatures(features?: readonly VisionFeature[]): VisionFeature[] {
  if (features === undefined) return [...VISION_FEATURES];
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error('prepareVision(): features must be a non-empty array when provided');
  }
  const out: VisionFeature[] = [];
  for (const feature of features) {
    if (!VISION_FEATURES.includes(feature)) {
      throw new Error(
        `prepareVision(): unknown feature "${String(feature)}", expected one of ${VISION_FEATURES.join(', ')}`
      );
    }
    if (!out.includes(feature)) out.push(feature);
  }
  return out;
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

/**
 * Validate and default removeBackground() options into the native argument
 * shape. `subjectX`/`subjectY` travel as -1 when no subject point was given.
 */
export function resolveRemoveBackgroundOptions(options?: RemoveBackgroundOptions): {
  trim: boolean;
  format: VisionImageFormat;
  quality: number;
  maxPixels: number;
  subjectX: number;
  subjectY: number;
  mask: boolean;
} {
  const trim = options?.trim ?? true;
  if (typeof trim !== 'boolean') throw new Error('options.trim must be a boolean');

  const mask = options?.mask ?? false;
  if (typeof mask !== 'boolean') throw new Error('options.mask must be a boolean');

  let subjectX = -1;
  let subjectY = -1;
  if (options?.subject !== undefined) {
    const subject = options.subject as { x?: unknown; y?: unknown } | null;
    if (!subject || typeof subject !== 'object') {
      throw new Error('options.subject must be a { x, y } point normalized to 0–1');
    }
    subjectX = requireFiniteNumber(subject.x, 'options.subject.x');
    subjectY = requireFiniteNumber(subject.y, 'options.subject.y');
    if (subjectX < 0 || subjectX > 1 || subjectY < 0 || subjectY > 1) {
      throw new Error('options.subject must be within [0, 1] on both axes');
    }
  }

  const format = options?.format ?? 'png';
  if (format !== 'png' && format !== 'jpeg') {
    throw new Error("options.format must be 'png' or 'jpeg'");
  }

  let quality = DEFAULT_CUTOUT_JPEG_QUALITY;
  if (options?.quality !== undefined) {
    quality = requireFiniteNumber(options.quality, 'options.quality');
    if (quality < 0 || quality > 1) throw new Error('options.quality must be within [0, 1]');
  }

  let maxPixels = DEFAULT_REMOVE_BACKGROUND_MAX_PIXELS;
  if (options?.maxPixels !== undefined) {
    maxPixels = requireFiniteNumber(options.maxPixels, 'options.maxPixels');
    if (!Number.isInteger(maxPixels) || maxPixels <= 0) {
      throw new Error('options.maxPixels must be a positive integer');
    }
    maxPixels = Math.min(maxPixels, MAX_REMOVE_BACKGROUND_PIXELS);
  }

  return { trim, format, quality, maxPixels, subjectX, subjectY, mask };
}

/** Validate and default labelImage() options into the native argument shape. */
export function resolveLabelImageOptions(options?: LabelImageOptions): {
  maxResults: number;
  minConfidence: number;
} {
  let maxResults = DEFAULT_LABEL_MAX_RESULTS;
  if (options?.maxResults !== undefined) {
    maxResults = requireFiniteNumber(options.maxResults, 'options.maxResults');
    if (!Number.isInteger(maxResults) || maxResults < 0) {
      throw new Error('options.maxResults must be a non-negative integer (0 = all)');
    }
  }
  let minConfidence = DEFAULT_LABEL_MIN_CONFIDENCE;
  if (options?.minConfidence !== undefined) {
    minConfidence = requireFiniteNumber(options.minConfidence, 'options.minConfidence');
    if (minConfidence < 0 || minConfidence > 1) {
      throw new Error('options.minConfidence must be within [0, 1]');
    }
  }
  return { maxResults, minConfidence };
}

/**
 * Validate and default recognizeText() options into the native argument shape.
 * `minTextHeight` travels as 0 when unset.
 */
export function resolveRecognizeTextOptions(options?: RecognizeTextOptions): {
  languages: string[];
  recognitionLevel: TextRecognitionLevel;
  usesLanguageCorrection: boolean;
  customWords: string[];
  minTextHeight: number;
} {
  if (options?.languages !== undefined && !Array.isArray(options.languages)) {
    throw new Error('options.languages must be an array of BCP-47 tags');
  }
  const languages = normalizeLanguageTags(options?.languages);

  const recognitionLevel = options?.recognitionLevel ?? 'accurate';
  if (recognitionLevel !== 'accurate' && recognitionLevel !== 'fast') {
    throw new Error("options.recognitionLevel must be 'accurate' or 'fast'");
  }

  const usesLanguageCorrection = options?.usesLanguageCorrection ?? true;
  if (typeof usesLanguageCorrection !== 'boolean') {
    throw new Error('options.usesLanguageCorrection must be a boolean');
  }

  const customWords = Array.isArray(options?.customWords)
    ? options!.customWords!.filter((w) => typeof w === 'string' && w.trim() !== '')
    : [];

  let minTextHeight = 0;
  if (options?.minTextHeight !== undefined) {
    minTextHeight = requireFiniteNumber(options.minTextHeight, 'options.minTextHeight');
    if (minTextHeight < 0 || minTextHeight > 1) {
      throw new Error('options.minTextHeight must be within [0, 1]');
    }
  }

  return { languages, recognitionLevel, usesLanguageCorrection, customWords, minTextHeight };
}

const UNAVAILABLE_REASONS: readonly VisionUnavailableReason[] = [
  'platform',
  'os-version',
  'device',
  'not-enabled',
];

/**
 * Coerce one native availability entry into the typed union. Unknown or
 * missing statuses fail closed as `unavailable` / `device`.
 */
export function normalizeVisionFeatureAvailability(raw: unknown): VisionFeatureAvailability {
  const entry = (raw ?? {}) as { status?: unknown; reason?: unknown };
  if (entry.status === 'available') return { status: 'available' };
  if (entry.status === 'downloadable') return { status: 'downloadable' };
  if (entry.status === 'downloading') return { status: 'downloading' };
  const reason = UNAVAILABLE_REASONS.includes(entry.reason as VisionUnavailableReason)
    ? (entry.reason as VisionUnavailableReason)
    : 'device';
  return { status: 'unavailable', reason };
}

/** Coerce the native availability map into a {@link VisionAvailability}. */
export function normalizeVisionAvailability(raw: unknown): VisionAvailability {
  const map = (raw ?? {}) as Record<string, unknown>;
  return {
    backgroundRemoval: normalizeVisionFeatureAvailability(map.backgroundRemoval),
    imageLabeling: normalizeVisionFeatureAvailability(map.imageLabeling),
    textRecognition: normalizeVisionFeatureAvailability(map.textRecognition),
  };
}

/** The availability every feature reports for one reason (web, flag off). */
export function unavailableVisionAvailability(reason: VisionUnavailableReason): VisionAvailability {
  const entry: VisionFeatureAvailability = { status: 'unavailable', reason };
  return { backgroundRemoval: entry, imageLabeling: entry, textRecognition: entry };
}
