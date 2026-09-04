import {
  ANDROID_TEXT_RECOGNITION_LANGUAGES,
  DEFAULT_LABEL_MAX_RESULTS,
  DEFAULT_LABEL_MIN_CONFIDENCE,
  DEFAULT_REMOVE_BACKGROUND_MAX_PIXELS,
  MAX_REMOVE_BACKGROUND_PIXELS,
  VISION_FEATURES,
  isAndroidTextLanguageSupported,
  normalizeLanguageTags,
  normalizeVisionAvailability,
  normalizeVisionFeatureAvailability,
  resolveLabelImageOptions,
  resolveRecognizeTextOptions,
  resolveRemoveBackgroundOptions,
  resolveVisionFeatures,
  unavailableVisionAvailability,
  validateVisionImage,
} from '../vision';

describe('validateVisionImage', () => {
  it('returns the trimmed uri', () => {
    expect(validateVisionImage({ uri: ' file:///a.jpg ' }, 'labelImage')).toBe('file:///a.jpg');
  });

  it('throws a plain Error naming the function for bad shapes', () => {
    expect(() => validateVisionImage({ uri: '' }, 'removeBackground')).toThrow(
      'removeBackground(): image must be { uri }'
    );
    expect(() => validateVisionImage(undefined as never, 'recognizeText')).toThrow(
      'recognizeText(): image must be { uri }'
    );
    expect(() => validateVisionImage({ uri: 42 } as never, 'labelImage')).toThrow(
      'labelImage(): image must be { uri }'
    );
  });
});

describe('normalizeLanguageTags', () => {
  it('canonicalizes casing, drops empties, and de-duplicates in order', () => {
    expect(normalizeLanguageTags(['EN_us', ' ', 'zh-hans', 'en-US', 'JA'])).toEqual([
      'en-US',
      'zh-Hans',
      'ja',
    ]);
  });

  it('returns [] for absent or malformed input', () => {
    expect(normalizeLanguageTags(undefined)).toEqual([]);
    expect(normalizeLanguageTags('en' as never)).toEqual([]);
    expect(normalizeLanguageTags([3 as never])).toEqual([]);
  });
});

describe('isAndroidTextLanguageSupported', () => {
  it('matches exact tags and same-language regional variants', () => {
    expect(isAndroidTextLanguageSupported('en')).toBe(true);
    expect(isAndroidTextLanguageSupported('en-GB')).toBe(true);
    expect(isAndroidTextLanguageSupported('zh-TW')).toBe(true);
    expect(isAndroidTextLanguageSupported('sr-Latn')).toBe(true);
    expect(isAndroidTextLanguageSupported('hi')).toBe(true);
  });

  it('rejects scripts ML Kit has no model for', () => {
    expect(isAndroidTextLanguageSupported('ar')).toBe(false);
    expect(isAndroidTextLanguageSupported('th')).toBe(false);
    expect(isAndroidTextLanguageSupported('ru')).toBe(false);
  });

  it('keeps the registry free of duplicates', () => {
    expect(new Set(ANDROID_TEXT_RECOGNITION_LANGUAGES).size).toBe(
      ANDROID_TEXT_RECOGNITION_LANGUAGES.length
    );
  });
});

describe('resolveVisionFeatures', () => {
  it('defaults to every feature', () => {
    expect(resolveVisionFeatures()).toEqual([...VISION_FEATURES]);
  });

  it('de-duplicates and validates', () => {
    expect(resolveVisionFeatures(['text-recognition', 'text-recognition'])).toEqual([
      'text-recognition',
    ]);
    expect(() => resolveVisionFeatures([])).toThrow('non-empty array');
    expect(() => resolveVisionFeatures(['ocr' as never])).toThrow('unknown feature "ocr"');
  });
});

describe('resolveRemoveBackgroundOptions', () => {
  const defaults = {
    trim: true,
    format: 'png',
    quality: 0.9,
    maxPixels: DEFAULT_REMOVE_BACKGROUND_MAX_PIXELS,
    subjectX: -1,
    subjectY: -1,
    mask: false,
  };

  it('applies defaults', () => {
    expect(resolveRemoveBackgroundOptions()).toEqual(defaults);
  });

  it('passes a subject point and the mask flag through', () => {
    expect(resolveRemoveBackgroundOptions({ subject: { x: 0.25, y: 0.75 }, mask: true })).toEqual({
      ...defaults,
      subjectX: 0.25,
      subjectY: 0.75,
      mask: true,
    });
    expect(() => resolveRemoveBackgroundOptions({ subject: { x: 1.5, y: 0 } })).toThrow('[0, 1]');
    expect(() => resolveRemoveBackgroundOptions({ subject: { x: 0 } as never })).toThrow(
      'options.subject.y'
    );
    expect(() => resolveRemoveBackgroundOptions({ subject: 'center' as never })).toThrow(
      '{ x, y }'
    );
    expect(() => resolveRemoveBackgroundOptions({ mask: 'yes' as never })).toThrow('boolean');
  });

  it('caps maxPixels and validates ranges', () => {
    expect(resolveRemoveBackgroundOptions({ maxPixels: 99_000_000 }).maxPixels).toBe(
      MAX_REMOVE_BACKGROUND_PIXELS
    );
    expect(resolveRemoveBackgroundOptions({ format: 'jpeg', quality: 0.5, trim: false })).toEqual({
      ...defaults,
      trim: false,
      format: 'jpeg',
      quality: 0.5,
    });
    expect(() => resolveRemoveBackgroundOptions({ quality: 1.5 })).toThrow('[0, 1]');
    expect(() => resolveRemoveBackgroundOptions({ quality: Number.NaN })).toThrow('finite');
    expect(() => resolveRemoveBackgroundOptions({ maxPixels: 0 })).toThrow('positive integer');
    expect(() => resolveRemoveBackgroundOptions({ maxPixels: 1.5 })).toThrow('positive integer');
    expect(() => resolveRemoveBackgroundOptions({ format: 'webp' as never })).toThrow(
      "'png' or 'jpeg'"
    );
    expect(() => resolveRemoveBackgroundOptions({ trim: 'yes' as never })).toThrow('boolean');
  });
});

describe('resolveLabelImageOptions', () => {
  it('applies defaults and accepts 0 as "all"', () => {
    expect(resolveLabelImageOptions()).toEqual({
      maxResults: DEFAULT_LABEL_MAX_RESULTS,
      minConfidence: DEFAULT_LABEL_MIN_CONFIDENCE,
    });
    expect(resolveLabelImageOptions({ maxResults: 0, minConfidence: 0 })).toEqual({
      maxResults: 0,
      minConfidence: 0,
    });
  });

  it('validates ranges', () => {
    expect(() => resolveLabelImageOptions({ maxResults: -1 })).toThrow('non-negative integer');
    expect(() => resolveLabelImageOptions({ maxResults: 2.5 })).toThrow('non-negative integer');
    expect(() => resolveLabelImageOptions({ minConfidence: 2 })).toThrow('[0, 1]');
  });
});

describe('resolveRecognizeTextOptions', () => {
  it('applies defaults with minTextHeight travelling as 0', () => {
    expect(resolveRecognizeTextOptions()).toEqual({
      languages: [],
      recognitionLevel: 'accurate',
      usesLanguageCorrection: true,
      customWords: [],
      minTextHeight: 0,
    });
  });

  it('normalizes languages and filters custom words', () => {
    expect(
      resolveRecognizeTextOptions({
        languages: ['en_us', 'ZH-hans'],
        recognitionLevel: 'fast',
        usesLanguageCorrection: false,
        customWords: ['Expo', '', 3 as never],
        minTextHeight: 0.05,
      })
    ).toEqual({
      languages: ['en-US', 'zh-Hans'],
      recognitionLevel: 'fast',
      usesLanguageCorrection: false,
      customWords: ['Expo'],
      minTextHeight: 0.05,
    });
  });

  it('validates option shapes', () => {
    expect(() => resolveRecognizeTextOptions({ languages: 'en' as never })).toThrow('array');
    expect(() => resolveRecognizeTextOptions({ recognitionLevel: 'best' as never })).toThrow(
      "'accurate' or 'fast'"
    );
    expect(() => resolveRecognizeTextOptions({ minTextHeight: 1.2 })).toThrow('[0, 1]');
    expect(() => resolveRecognizeTextOptions({ usesLanguageCorrection: 1 as never })).toThrow(
      'boolean'
    );
  });
});

describe('vision availability normalization', () => {
  it('passes through known statuses and reasons', () => {
    expect(normalizeVisionFeatureAvailability({ status: 'available' })).toEqual({
      status: 'available',
    });
    expect(normalizeVisionFeatureAvailability({ status: 'downloadable' })).toEqual({
      status: 'downloadable',
    });
    expect(normalizeVisionFeatureAvailability({ status: 'downloading' })).toEqual({
      status: 'downloading',
    });
    expect(
      normalizeVisionFeatureAvailability({ status: 'unavailable', reason: 'not-enabled' })
    ).toEqual({ status: 'unavailable', reason: 'not-enabled' });
  });

  it('fails closed on unknown or missing entries', () => {
    expect(normalizeVisionFeatureAvailability(undefined)).toEqual({
      status: 'unavailable',
      reason: 'device',
    });
    expect(normalizeVisionFeatureAvailability({ status: 'ready' })).toEqual({
      status: 'unavailable',
      reason: 'device',
    });
    expect(normalizeVisionFeatureAvailability({ status: 'unavailable', reason: 'x' })).toEqual({
      status: 'unavailable',
      reason: 'device',
    });
  });

  it('normalizes the full map and builds the uniform unavailable map', () => {
    expect(
      normalizeVisionAvailability({
        backgroundRemoval: { status: 'downloadable' },
        imageLabeling: { status: 'available' },
      })
    ).toEqual({
      backgroundRemoval: { status: 'downloadable' },
      imageLabeling: { status: 'available' },
      textRecognition: { status: 'unavailable', reason: 'device' },
    });
    expect(unavailableVisionAvailability('platform')).toEqual({
      backgroundRemoval: { status: 'unavailable', reason: 'platform' },
      imageLabeling: { status: 'unavailable', reason: 'platform' },
      textRecognition: { status: 'unavailable', reason: 'platform' },
    });
  });
});
