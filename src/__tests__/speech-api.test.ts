/**
 * Behavior tests for transcribe/streamTranscription with the native module
 * mocked — the speech single-flight guard, typed platform guards, native-error
 * normalization, and the onTranscriptionUpdate error channel.
 */

import { Platform } from 'react-native';

import ExpoAiKitModule from '../ExpoAiKitModule';
import { ModelError, streamTranscription, transcribe } from '../index';
import type { TranscriptionNativeEvent } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../ExpoAiKitModule', () => ({
  __esModule: true,
  default: {
    getSpeechAvailability: jest.fn(),
    prepareSpeechRecognition: jest.fn(),
    getSupportedSpeechLocalesNative: jest.fn(),
    getSpeechPermissions: jest.fn(),
    requestSpeechPermissions: jest.fn(),
    transcribeAudio: jest.fn(),
    startTranscription: jest.fn(),
    stopTranscription: jest.fn(),
    addListener: jest.fn(),
  },
}));

const native = ExpoAiKitModule as jest.Mocked<typeof ExpoAiKitModule>;
const mutablePlatform = Platform as { OS: string };

type Subscription = { listener: (event: TranscriptionNativeEvent) => void; removed: boolean };
let subscriptions: Subscription[] = [];

function emit(event: TranscriptionNativeEvent): void {
  for (const sub of [...subscriptions]) {
    if (!sub.removed) sub.listener(event);
  }
}

function sessionId(): string {
  const calls = native.startTranscription.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mutablePlatform.OS = 'ios';
  subscriptions = [];
  native.addListener.mockImplementation(((eventName: string, listener: never) => {
    const sub: Subscription = { listener, removed: false };
    if (eventName === 'onTranscriptionUpdate') subscriptions.push(sub);
    return {
      remove: () => {
        sub.removed = true;
      },
    };
  }) as never);
  native.startTranscription.mockResolvedValue(undefined);
  native.stopTranscription.mockResolvedValue(undefined);
});

describe('transcribe', () => {
  const wavResult = {
    text: 'hello',
    segments: [{ text: 'hello', startSeconds: 0, endSeconds: 1 }],
    language: 'en-US',
    durationSeconds: 1,
  };

  it('throws a typed DEVICE_NOT_SUPPORTED error on unsupported platforms', async () => {
    mutablePlatform.OS = 'web';
    const error = await transcribe({ audio: { uri: 'a.wav' } }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(native.transcribeAudio).not.toHaveBeenCalled();
  });

  it('throws a plain Error for malformed audio input', async () => {
    await expect(transcribe({ audio: { uri: '' } })).rejects.toThrow(
      'exactly one of { uri } or { base64 }'
    );
  });

  it('normalizes the locale and passes input positionally', async () => {
    native.transcribeAudio.mockResolvedValue(wavResult);
    await transcribe({ audio: { uri: 'file:///a.wav' }, locale: 'en_us' });
    const [uri, base64, mediaType, locale] = native.transcribeAudio.mock.calls[0];
    expect(uri).toBe('file:///a.wav');
    expect(base64).toBe('');
    expect(mediaType).toBe('');
    expect(locale).toBe('en-US');
  });

  it('normalizes native contract rejections into typed ModelErrors', async () => {
    native.transcribeAudio.mockRejectedValue(
      new Error('MIC_PERMISSION_DENIED:mlkit-speech:Microphone permission is required')
    );
    const error = await transcribe({ audio: { base64: 'QUJD' } }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('MIC_PERMISSION_DENIED');
    expect(error.modelId).toBe('mlkit-speech');
  });

  it('rejects an overlapping speech session with SPEECH_BUSY', async () => {
    let resolveFirst!: (r: typeof wavResult) => void;
    native.transcribeAudio.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );
    const first = transcribe({ audio: { uri: 'a.wav' } });
    const overlapping = await transcribe({ audio: { uri: 'b.wav' } }).catch((e) => e);
    expect(overlapping).toBeInstanceOf(ModelError);
    expect(overlapping.code).toBe('SPEECH_BUSY');

    resolveFirst(wavResult);
    await expect(first).resolves.toEqual(wavResult);

    // Guard released after settle.
    native.transcribeAudio.mockResolvedValueOnce(wavResult);
    await expect(transcribe({ audio: { uri: 'c.wav' } })).resolves.toEqual(wavResult);
  });

  it('rejects with INFERENCE_CANCELLED on abort and asks native to stop', async () => {
    let rejectNative!: (e: unknown) => void;
    native.transcribeAudio.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectNative = reject;
      })
    );
    const controller = new AbortController();
    const pending = transcribe({ audio: { uri: 'a.wav' }, signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('INFERENCE_CANCELLED');
    expect(native.stopTranscription).toHaveBeenCalled();

    // The single-flight flag is held until the NATIVE call settles (the engine
    // may still be running after an abort) — settle it so it releases.
    rejectNative(new Error('INFERENCE_CANCELLED:mlkit-speech:stopped'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('streamTranscription', () => {
  it('rejects on unsupported platforms without touching native', async () => {
    mutablePlatform.OS = 'web';
    const { promise } = streamTranscription(jest.fn());
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(native.startTranscription).not.toHaveBeenCalled();
  });

  it('assembles volatile and final updates into a running transcript', async () => {
    const updates: { text: string; isFinal: boolean }[] = [];
    const { promise, stop } = streamTranscription((u) => updates.push(u));
    const id = sessionId();

    emit({ sessionId: id, text: 'Hel', isFinal: false });
    emit({ sessionId: id, text: 'Hello world.', isFinal: true });
    emit({ sessionId: id, text: 'How are', isFinal: false });
    stop();

    await expect(promise).resolves.toEqual({
      text: 'Hello world. How are',
      segments: [],
      language: undefined,
    });
    expect(updates).toEqual([
      { text: 'Hel', isFinal: false },
      { text: 'Hello world.', isFinal: true },
      { text: 'Hello world. How are', isFinal: false },
    ]);
    expect(native.stopTranscription).toHaveBeenCalledWith(id);
  });

  it('rejects with a typed ModelError on an error event, never calling onUpdate', async () => {
    const onUpdate = jest.fn();
    const { promise } = streamTranscription(onUpdate);
    emit({
      sessionId: sessionId(),
      text: '',
      isFinal: true,
      error: 'MIC_PERMISSION_DENIED:apple-speech:Microphone permission is required',
    });
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('MIC_PERMISSION_DENIED');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('resolves when the engine ends the session on its own', async () => {
    const { promise } = streamTranscription(jest.fn());
    const id = sessionId();
    emit({ sessionId: id, text: 'Done now.', isFinal: true });
    emit({ sessionId: id, text: '', isFinal: false, isSessionEnd: true });
    await expect(promise).resolves.toMatchObject({ text: 'Done now.' });
  });

  it('rejects when startTranscription itself rejects with the native contract', async () => {
    native.startTranscription.mockRejectedValue(
      new Error('SPEECH_NOT_ENABLED:mlkit-speech:Speech is opt-in')
    );
    const { promise } = streamTranscription(jest.fn());
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('SPEECH_NOT_ENABLED');
  });

  it('enforces the speech single-flight and releases it on settle', async () => {
    const first = streamTranscription(jest.fn());
    const second = streamTranscription(jest.fn());
    const error = await second.promise.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('SPEECH_BUSY');

    first.stop();
    await first.promise;

    const third = streamTranscription(jest.fn());
    third.stop();
    await expect(third.promise).resolves.toBeDefined();
  });

  it('detaches the subscription once settled and drops late events', async () => {
    const onUpdate = jest.fn();
    const { promise, stop } = streamTranscription(onUpdate);
    const id = sessionId();
    emit({ sessionId: id, text: 'partial', isFinal: false });
    stop();
    emit({ sessionId: id, text: 'late', isFinal: true });
    await expect(promise).resolves.toMatchObject({ text: 'partial' });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(subscriptions[0].removed).toBe(true);
  });
});
