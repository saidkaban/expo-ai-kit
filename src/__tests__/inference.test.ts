/**
 * Behavior tests for sendMessage/streamMessage with the native module mocked.
 *
 * The native side is a jest mock, so these cover the JS contract layer:
 * typed platform guards, native-error normalization, the single-flight
 * inference guard, and the onStreamToken error channel. Real native behavior
 * is exercised by the platform CI builds and on-device gates.
 */

import { Platform } from 'react-native';

import ExpoAiKitModule from '../ExpoAiKitModule';
import {
  deleteModel,
  ModelError,
  sendMessage,
  setModel,
  streamMessage,
  unloadModel,
} from '../index';
import type { LLMStreamEvent } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../ExpoAiKitModule', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(),
    prepareBuiltInModel: jest.fn(),
    sendMessage: jest.fn(),
    startStreaming: jest.fn(),
    stopStreaming: jest.fn(),
    addListener: jest.fn(),
    getActiveModel: jest.fn(),
    setModel: jest.fn(),
    unloadModel: jest.fn(),
    deleteModel: jest.fn(),
    getBuiltInModels: jest.fn(),
    getDeviceRamBytes: jest.fn(),
  },
}));

const native = ExpoAiKitModule as jest.Mocked<typeof ExpoAiKitModule>;
const mutablePlatform = Platform as { OS: string };

// Faithful subscription mock: remove() actually detaches, so events emitted
// after settle() are dropped exactly as they are by the real event emitter.
type StreamSubscription = { listener: (event: LLMStreamEvent) => void; removed: boolean };
let streamSubscriptions: StreamSubscription[] = [];

function emitStream(event: LLMStreamEvent): void {
  for (const sub of [...streamSubscriptions]) {
    if (!sub.removed) sub.listener(event);
  }
}

function streamSessionId(): string {
  const calls = native.startStreaming.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][2];
}

beforeEach(() => {
  jest.clearAllMocks();
  mutablePlatform.OS = 'ios';
  streamSubscriptions = [];
  native.addListener.mockImplementation(((eventName: string, listener: never) => {
    const sub: StreamSubscription = { listener, removed: false };
    if (eventName === 'onStreamToken') streamSubscriptions.push(sub);
    return {
      remove: () => {
        sub.removed = true;
      },
    };
  }) as never);
  native.startStreaming.mockResolvedValue(undefined);
  native.stopStreaming.mockResolvedValue(undefined);
});

describe('sendMessage', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];

  it('throws a typed DEVICE_NOT_SUPPORTED error on unsupported platforms', async () => {
    mutablePlatform.OS = 'web';
    const error = await sendMessage(messages).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(native.sendMessage).not.toHaveBeenCalled();
  });

  it('normalizes native contract rejections into typed ModelErrors', async () => {
    native.sendMessage.mockRejectedValue(
      new Error('DEVICE_NOT_SUPPORTED:apple-fm:Apple Foundation Models requires iOS 26 or later')
    );
    const error = await sendMessage(messages).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(error.modelId).toBe('apple-fm');
  });

  it('falls back to UNKNOWN for unrecognized native errors', async () => {
    native.sendMessage.mockRejectedValue(new Error('some opaque native explosion'));
    const error = await sendMessage(messages).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('UNKNOWN');
  });

  it('releases the single-flight guard after a rejection', async () => {
    native.sendMessage.mockRejectedValueOnce(new Error('INFERENCE_FAILED:mlkit:boom'));
    await expect(sendMessage(messages)).rejects.toBeInstanceOf(ModelError);

    native.sendMessage.mockResolvedValueOnce({ text: 'recovered' });
    await expect(sendMessage(messages)).resolves.toEqual({ text: 'recovered' });
  });

  it('rejects an overlapping generation with INFERENCE_BUSY', async () => {
    let resolveFirst!: (r: { text: string }) => void;
    native.sendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );

    const first = sendMessage(messages);
    const overlapping = await sendMessage(messages).catch((e) => e);
    expect(overlapping).toBeInstanceOf(ModelError);
    expect(overlapping.code).toBe('INFERENCE_BUSY');

    resolveFirst({ text: 'done' });
    await expect(first).resolves.toEqual({ text: 'done' });
  });
});

describe('streamMessage', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];

  it('rejects with a typed DEVICE_NOT_SUPPORTED error on unsupported platforms', async () => {
    mutablePlatform.OS = 'web';
    const onToken = jest.fn();
    const { promise } = streamMessage(messages, onToken);
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('DEVICE_NOT_SUPPORTED');
    expect(onToken).not.toHaveBeenCalled();
  });

  it('delivers tokens and resolves with the accumulated text on isDone', async () => {
    const onToken = jest.fn();
    const { promise } = streamMessage(messages, onToken);
    const sessionId = streamSessionId();

    emitStream({ sessionId, token: 'Hel', accumulatedText: 'Hel', isDone: false });
    emitStream({ sessionId, token: 'lo', accumulatedText: 'Hello', isDone: false });
    emitStream({ sessionId, token: '', accumulatedText: 'Hello', isDone: true });

    await expect(promise).resolves.toEqual({ text: 'Hello' });
    expect(onToken).toHaveBeenCalledTimes(3);
  });

  it('rejects with a typed ModelError on an error event, without calling onToken', async () => {
    const onToken = jest.fn();
    const { promise } = streamMessage(messages, onToken);

    emitStream({
      sessionId: streamSessionId(),
      token: '',
      accumulatedText: '',
      isDone: true,
      error: 'INFERENCE_FAILED:mlkit:stream exploded',
    });

    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('INFERENCE_FAILED');
    expect(error.modelId).toBe('mlkit');
    expect(onToken).not.toHaveBeenCalled();
  });

  it('releases the single-flight guard after an error event', async () => {
    const { promise } = streamMessage(messages, jest.fn());
    emitStream({
      sessionId: streamSessionId(),
      token: '',
      accumulatedText: '',
      isDone: true,
      error: 'DEVICE_NOT_SUPPORTED:mlkit:no ML Kit here',
    });
    await expect(promise).rejects.toBeInstanceOf(ModelError);

    native.sendMessage.mockResolvedValueOnce({ text: 'after stream error' });
    await expect(sendMessage(messages)).resolves.toEqual({ text: 'after stream error' });
  });

  it('rejects when startStreaming itself rejects with the native contract', async () => {
    native.startStreaming.mockRejectedValue(
      new Error('MODEL_NOT_DOWNLOADED:mlkit:The ML Kit model is not ready')
    );
    const { promise } = streamMessage(messages, jest.fn());
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('MODEL_NOT_DOWNLOADED');
  });

  it('stop() resolves with the text so far and detaches from later events', async () => {
    const onToken = jest.fn();
    const { promise, stop } = streamMessage(messages, onToken);
    const sessionId = streamSessionId();

    emitStream({ sessionId, token: 'partial', accumulatedText: 'partial', isDone: false });
    stop();
    // settle() removed the subscription, so this late event is dropped.
    emitStream({ sessionId, token: ' late', accumulatedText: 'partial late', isDone: true });

    await expect(promise).resolves.toEqual({ text: 'partial' });
    expect(native.stopStreaming).toHaveBeenCalledWith(sessionId);
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(streamSubscriptions[0].removed).toBe(true);
  });

  it('stop() keeps the single-flight guard until native emits its terminal event', async () => {
    const { promise, stop } = streamMessage(messages, jest.fn());
    const sessionId = streamSessionId();

    stop();
    await expect(promise).resolves.toEqual({ text: '' });

    // Native may still be decoding: a new generation must not start yet.
    const busy = await sendMessage(messages).catch((e) => e);
    expect(busy).toBeInstanceOf(ModelError);
    expect(busy.code).toBe('INFERENCE_BUSY');
    expect(native.sendMessage).not.toHaveBeenCalled();
    expect(streamSubscriptions[0].removed).toBe(false);

    emitStream({ sessionId, token: '', accumulatedText: '', isDone: true });
    expect(streamSubscriptions[0].removed).toBe(true);

    native.sendMessage.mockResolvedValueOnce({ text: 'after stop' });
    await expect(sendMessage(messages)).resolves.toEqual({ text: 'after stop' });
  });

  it('releases the guard when native reports an error while stopping', async () => {
    const { promise, stop } = streamMessage(messages, jest.fn());
    const sessionId = streamSessionId();

    stop();
    await expect(promise).resolves.toEqual({ text: '' });
    emitStream({
      sessionId,
      token: '',
      accumulatedText: '',
      isDone: true,
      error: 'INFERENCE_FAILED:gemma-e2b:cancelled mid-decode',
    });

    native.sendMessage.mockResolvedValueOnce({ text: 'ok' });
    await expect(sendMessage(messages)).resolves.toEqual({ text: 'ok' });
  });

  it('rejects with the error thrown by onToken and stops native generation', async () => {
    const callbackError = new Error('render failed');
    const onToken = jest.fn(() => {
      throw callbackError;
    });
    const { promise } = streamMessage(messages, onToken);
    const sessionId = streamSessionId();

    emitStream({ sessionId, token: 'a', accumulatedText: 'a', isDone: false });
    await expect(promise).rejects.toBe(callbackError);
    expect(native.stopStreaming).toHaveBeenCalledWith(sessionId);

    // Later tokens never reach the failed callback; the terminal event frees the guard.
    emitStream({ sessionId, token: 'b', accumulatedText: 'ab', isDone: false });
    emitStream({ sessionId, token: '', accumulatedText: 'ab', isDone: true });
    expect(onToken).toHaveBeenCalledTimes(1);

    native.sendMessage.mockResolvedValueOnce({ text: 'ok' });
    await expect(sendMessage(messages)).resolves.toEqual({ text: 'ok' });
  });

  it('does not leave the guard held when onToken throws on the terminal event', async () => {
    const callbackError = new Error('render failed');
    const { promise } = streamMessage(messages, () => {
      throw callbackError;
    });

    emitStream({ sessionId: streamSessionId(), token: '', accumulatedText: 'x', isDone: true });
    await expect(promise).rejects.toBe(callbackError);
    expect(native.stopStreaming).not.toHaveBeenCalled();

    native.sendMessage.mockResolvedValueOnce({ text: 'not stuck' });
    await expect(sendMessage(messages)).resolves.toEqual({ text: 'not stuck' });
  });

  it('releases the guard when startStreaming rejects', async () => {
    native.startStreaming.mockRejectedValueOnce(new Error('LLM_NOT_ENABLED::llm option is off'));
    const { promise } = streamMessage(messages, jest.fn());
    await expect(promise).rejects.toBeInstanceOf(ModelError);

    native.sendMessage.mockResolvedValueOnce({ text: 'ok' });
    await expect(sendMessage(messages)).resolves.toEqual({ text: 'ok' });
  });

  it('removes the token subscription once settled', async () => {
    const { promise } = streamMessage(messages, jest.fn());
    emitStream({
      sessionId: streamSessionId(),
      token: '',
      accumulatedText: 'x',
      isDone: true,
    });
    await promise;
    expect(streamSubscriptions).toHaveLength(1);
    expect(streamSubscriptions[0].removed).toBe(true);
  });
});

describe('model lifecycle during a generation', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];

  function startGeneration(): { finish: () => Promise<unknown> } {
    let resolve!: (r: { text: string }) => void;
    native.sendMessage.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    const running = sendMessage(messages);
    return {
      finish: () => {
        resolve({ text: 'done' });
        return running;
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mutablePlatform.OS = 'ios';
    native.getActiveModel.mockReturnValue('gemma-e2b');
  });

  it.each([
    ['setModel', () => setModel('gemma-e2b'), () => native.setModel],
    ['unloadModel', () => unloadModel(), () => native.unloadModel],
    ['deleteModel of the active model', () => deleteModel('gemma-e2b'), () => native.deleteModel],
  ])('rejects %s with INFERENCE_BUSY, then allows it', async (_name, call, nativeFn) => {
    const generation = startGeneration();

    const error = await call().catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe('INFERENCE_BUSY');
    expect(nativeFn()).not.toHaveBeenCalled();

    await generation.finish();
    await call();
    expect(nativeFn()).toHaveBeenCalledTimes(1);
  });

  it('still deletes a model that is not active', async () => {
    const generation = startGeneration();
    await deleteModel('gemma-e4b');
    expect(native.deleteModel).toHaveBeenCalledWith('gemma-e4b');
    await generation.finish();
  });
});

describe('generation seed', () => {
  async function nativeSeed(seed: number): Promise<number | undefined> {
    native.setModel.mockClear();
    await setModel('gemma-e2b', { generation: { seed } });
    return native.setModel.mock.calls[0][3].seed;
  }

  it.each([1_762_000_000_000, 2 ** 31, -(2 ** 40), Number.MAX_SAFE_INTEGER])(
    'wraps %d into a stable non-negative 32-bit value',
    async (seed) => {
      const wrapped = await nativeSeed(seed);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThanOrEqual(2 ** 31 - 1);
      expect(await nativeSeed(seed)).toBe(wrapped);
    }
  );

  it.each([0, 42, -5, 2 ** 31 - 1])('leaves %d unchanged', async (seed) => {
    expect(await nativeSeed(seed)).toBe(seed);
  });
});
