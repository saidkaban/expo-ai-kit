/**
 * Behavior tests for the vision API with the native module mocked, typed
 * platform guards, option passing, native-error normalization, Android's
 * language pre-check, and the prepareVision progress channel.
 */

import { Platform } from 'react-native';

import ExpoAiKitModule from '../ExpoAiKitModule';
import {
  ANDROID_TEXT_RECOGNITION_LANGUAGES,
  ModelError,
  getSupportedTextRecognitionLanguages,
  getVisionAvailability,
  labelImage,
  prepareVision,
  recognizeText,
  removeBackground,
} from '../index';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../ExpoAiKitModule', () => ({
  __esModule: true,
  default: {
    getVisionAvailability: jest.fn(),
    prepareVision: jest.fn(),
    getSupportedTextRecognitionLanguagesNative: jest.fn(),
    removeBackground: jest.fn(),
    labelImage: jest.fn(),
    recognizeText: jest.fn(),
    addListener: jest.fn(),
  },
}));

const native = ExpoAiKitModule as jest.Mocked<typeof ExpoAiKitModule>;
const mutablePlatform = Platform as { OS: string };

type ProgressListener = (event: { modelId: string; progress: number }) => void;
let progressListeners: { listener: ProgressListener; removed: boolean }[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mutablePlatform.OS = 'ios';
  progressListeners = [];
  native.addListener.mockImplementation(((eventName: string, listener: never) => {
    const sub = { listener: listener as ProgressListener, removed: false };
    if (eventName === 'onDownloadProgress') progressListeners.push(sub);
    return {
      remove: () => {
        sub.removed = true;
      },
    };
  }) as never);
});

const cutout = {
  uri: 'file:///cache/expo-ai-kit/vision/a.png',
  width: 10,
  height: 12,
  sourceWidth: 100,
  sourceHeight: 120,
  bounds: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
  pixelBounds: { x: 10, y: 12, width: 10, height: 12 },
  foregroundCoverage: 0.01,
  centroid: { x: 0.15, y: 0.15 },
  instanceCount: 1,
  trimOrigin: { x: 0.08, y: 0.083 },
};

describe('getVisionAvailability', () => {
  it('reports platform unavailability on web without touching native', async () => {
    mutablePlatform.OS = 'web';
    await expect(getVisionAvailability()).resolves.toEqual({
      backgroundRemoval: { status: 'unavailable', reason: 'platform' },
      imageLabeling: { status: 'unavailable', reason: 'platform' },
      textRecognition: { status: 'unavailable', reason: 'platform' },
    });
    expect(native.getVisionAvailability).not.toHaveBeenCalled();
  });

  it('normalizes the native map, including the Android not-enabled report', async () => {
    mutablePlatform.OS = 'android';
    native.getVisionAvailability.mockResolvedValue({
      backgroundRemoval: { status: 'unavailable', reason: 'not-enabled' },
      imageLabeling: { status: 'unavailable', reason: 'not-enabled' },
      textRecognition: { status: 'unavailable', reason: 'not-enabled' },
    });
    const availability = await getVisionAvailability();
    expect(availability.backgroundRemoval).toEqual({
      status: 'unavailable',
      reason: 'not-enabled',
    });
    native.getVisionAvailability.mockResolvedValue({
      backgroundRemoval: { status: 'downloadable' },
      imageLabeling: { status: 'available' },
      textRecognition: { status: 'downloading' },
    });
    await expect(getVisionAvailability()).resolves.toEqual({
      backgroundRemoval: { status: 'downloadable' },
      imageLabeling: { status: 'available' },
      textRecognition: { status: 'downloading' },
    });
  });
});

describe('prepareVision', () => {
  it('throws a typed DEVICE_NOT_SUPPORTED error on unsupported platforms', async () => {
    mutablePlatform.OS = 'web';
    const error = await prepareVision().catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(native.prepareVision).not.toHaveBeenCalled();
  });

  it('passes every feature by default and normalized languages', async () => {
    native.prepareVision.mockResolvedValue(undefined);
    await prepareVision({ languages: ['ja_jp', 'EN'] });
    expect(native.prepareVision).toHaveBeenCalledWith(
      ['background-removal', 'image-labeling', 'text-recognition'],
      ['ja-JP', 'en']
    );
  });

  it('rejects unknown features with a plain Error before calling native', async () => {
    await expect(prepareVision({ features: ['ocr' as never] })).rejects.toThrow(
      'unknown feature "ocr"'
    );
    expect(native.prepareVision).not.toHaveBeenCalled();
  });

  it('forwards only vision progress events and detaches afterwards', async () => {
    let resolveNative!: () => void;
    native.prepareVision.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveNative = resolve;
      })
    );
    const onProgress = jest.fn();
    const pending = prepareVision({ features: ['background-removal'], onProgress });
    expect(progressListeners).toHaveLength(1);
    progressListeners[0].listener({ modelId: 'gemma-e2b', progress: 0.2 });
    progressListeners[0].listener({ modelId: 'mlkit-vision', progress: 0.5 });
    progressListeners[0].listener({ modelId: 'apple-vision', progress: 1 });
    resolveNative();
    await pending;
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([0.5, 1]);
    expect(progressListeners[0].removed).toBe(true);
  });

  it('normalizes native contract rejections into typed ModelErrors', async () => {
    mutablePlatform.OS = 'android';
    native.prepareVision.mockRejectedValue(
      new Error(
        'VISION_NOT_ENABLED:mlkit-vision:Vision is opt-in. Add ["expo-ai-kit", { "vision": true }]'
      )
    );
    const error = await prepareVision().catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('VISION_NOT_ENABLED');
    expect(error.modelId).toBe('mlkit-vision');
  });
});

describe('getSupportedTextRecognitionLanguages', () => {
  it('asks Vision on iOS', async () => {
    native.getSupportedTextRecognitionLanguagesNative.mockResolvedValue(['de-DE', 'en-US']);
    await expect(getSupportedTextRecognitionLanguages()).resolves.toEqual(['de-DE', 'en-US']);
  });

  it('answers from the registry on Android when enabled, [] when not', async () => {
    mutablePlatform.OS = 'android';
    native.getVisionAvailability.mockResolvedValueOnce({
      textRecognition: { status: 'downloadable' },
    });
    await expect(getSupportedTextRecognitionLanguages()).resolves.toEqual([
      ...ANDROID_TEXT_RECOGNITION_LANGUAGES,
    ]);
    native.getVisionAvailability.mockResolvedValueOnce({
      textRecognition: { status: 'unavailable', reason: 'not-enabled' },
    });
    await expect(getSupportedTextRecognitionLanguages()).resolves.toEqual([]);
    expect(native.getSupportedTextRecognitionLanguagesNative).not.toHaveBeenCalled();
  });

  it('returns [] on web', async () => {
    mutablePlatform.OS = 'web';
    await expect(getSupportedTextRecognitionLanguages()).resolves.toEqual([]);
  });
});

describe('removeBackground', () => {
  it('throws a typed DEVICE_NOT_SUPPORTED error on unsupported platforms', async () => {
    mutablePlatform.OS = 'web';
    const error = await removeBackground({ uri: 'file:///a.jpg' }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(native.removeBackground).not.toHaveBeenCalled();
  });

  it('throws a plain Error for malformed image input', async () => {
    await expect(removeBackground({ uri: '' })).rejects.toThrow('image must be { uri }');
    expect(native.removeBackground).not.toHaveBeenCalled();
  });

  it('passes defaulted options positionally and returns the native result', async () => {
    native.removeBackground.mockResolvedValue(cutout);
    await expect(removeBackground({ uri: 'file:///a.jpg' })).resolves.toEqual(cutout);
    expect(native.removeBackground).toHaveBeenCalledWith(
      'file:///a.jpg',
      true,
      'png',
      0.9,
      6_000_000,
      -1,
      -1,
      false
    );
    await removeBackground(
      { uri: '/tmp/b.jpg' },
      { trim: false, format: 'jpeg', quality: 0.7, subject: { x: 0.5, y: 0.4 }, mask: true }
    );
    expect(native.removeBackground).toHaveBeenLastCalledWith(
      '/tmp/b.jpg',
      false,
      'jpeg',
      0.7,
      6_000_000,
      0.5,
      0.4,
      true
    );
  });

  it('normalizes NO_SUBJECT_FOUND and other contract rejections', async () => {
    native.removeBackground.mockRejectedValue(
      new Error('NO_SUBJECT_FOUND:apple-vision:No foreground subject detected')
    );
    const error = await removeBackground({ uri: 'file:///a.jpg' }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('NO_SUBJECT_FOUND');
    expect(error.modelId).toBe('apple-vision');
  });

  it('falls back to UNKNOWN for unrecognized native errors', async () => {
    native.removeBackground.mockRejectedValue(new Error('opaque native explosion'));
    const error = await removeBackground({ uri: 'file:///a.jpg' }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('UNKNOWN');
  });
});

describe('labelImage', () => {
  it('passes defaulted options and returns labels', async () => {
    const labels = [
      { label: 'Dog', confidence: 0.98 },
      { label: 'Pet', confidence: 0.7 },
    ];
    native.labelImage.mockResolvedValue(labels);
    await expect(labelImage({ uri: 'file:///a.jpg' })).resolves.toEqual(labels);
    expect(native.labelImage).toHaveBeenCalledWith('file:///a.jpg', 10, 0.5);
    await labelImage({ uri: 'file:///a.jpg' }, { maxResults: 0, minConfidence: 0.2 });
    expect(native.labelImage).toHaveBeenLastCalledWith('file:///a.jpg', 0, 0.2);
  });

  it('normalizes IMAGE_DECODE_FAILED', async () => {
    native.labelImage.mockRejectedValue(
      new Error('IMAGE_DECODE_FAILED:apple-vision:Could not open image')
    );
    const error = await labelImage({ uri: 'file:///missing.jpg' }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('rejects on web without touching native', async () => {
    mutablePlatform.OS = 'web';
    const error = await labelImage({ uri: 'file:///a.jpg' }).catch((e) => e);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(native.labelImage).not.toHaveBeenCalled();
  });
});

describe('recognizeText', () => {
  const result = { text: 'Hello', blocks: [] };

  it('passes normalized options positionally', async () => {
    native.recognizeText.mockResolvedValue(result);
    await expect(recognizeText({ uri: 'file:///a.jpg' })).resolves.toEqual(result);
    expect(native.recognizeText).toHaveBeenCalledWith('file:///a.jpg', [], 'accurate', true, [], 0);
    await recognizeText(
      { uri: 'file:///a.jpg' },
      {
        languages: ['de_de'],
        recognitionLevel: 'fast',
        usesLanguageCorrection: false,
        customWords: ['Expo'],
        minTextHeight: 0.02,
      }
    );
    expect(native.recognizeText).toHaveBeenLastCalledWith(
      'file:///a.jpg',
      ['de-DE'],
      'fast',
      false,
      ['Expo'],
      0.02
    );
  });

  it('rejects languages Android has no script model for before calling native', async () => {
    mutablePlatform.OS = 'android';
    const error = await recognizeText({ uri: 'file:///a.jpg' }, { languages: ['ar'] }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('LANGUAGE_NOT_SUPPORTED');
    expect(error.modelId).toBe('mlkit-vision');
    expect(native.recognizeText).not.toHaveBeenCalled();

    native.recognizeText.mockResolvedValue(result);
    await recognizeText({ uri: 'file:///a.jpg' }, { languages: ['zh-TW', 'en-GB'] });
    expect(native.recognizeText).toHaveBeenLastCalledWith(
      'file:///a.jpg',
      ['zh-TW', 'en-GB'],
      'accurate',
      true,
      [],
      0
    );
  });

  it('lets iOS decide language support natively', async () => {
    native.recognizeText.mockRejectedValue(
      new Error(
        'LANGUAGE_NOT_SUPPORTED:apple-vision:No on-device text-recognition model reads "xx"'
      )
    );
    const error = await recognizeText({ uri: 'file:///a.jpg' }, { languages: ['xx'] }).catch(
      (e) => e
    );
    expect(error.code).toBe('LANGUAGE_NOT_SUPPORTED');
    expect(error.modelId).toBe('apple-vision');
  });
});
