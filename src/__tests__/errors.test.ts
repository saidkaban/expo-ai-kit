import { KNOWN_ERROR_CODES, parseNativeErrorMessage } from '../errors';

describe('parseNativeErrorMessage', () => {
  it('parses the bare native contract', () => {
    expect(
      parseNativeErrorMessage('MODEL_NOT_DOWNLOADED:gemma-e2b:Model file not found on disk')
    ).toEqual({
      code: 'MODEL_NOT_DOWNLOADED',
      modelId: 'gemma-e2b',
      reason: 'Model file not found on disk',
    });
  });

  it('parses an empty modelId slot', () => {
    expect(
      parseNativeErrorMessage('DEVICE_NOT_SUPPORTED::On-device embeddings require iOS 17 or later')
    ).toEqual({
      code: 'DEVICE_NOT_SUPPORTED',
      modelId: '',
      reason: 'On-device embeddings require iOS 17 or later',
    });
  });

  it('parses the contract wrapped by the Expo SDK 56 Kotlin exception decorator', () => {
    const wrapped =
      "Call to function 'ExpoAiKit.prepareEmbeddingModel' has been rejected.\n" +
      '→ Caused by: java.lang.RuntimeException: DOWNLOAD_FAILED:embedding-gemma-300m:' +
      'Unable to resolve host "storage.googleapis.com": No address associated with hostname';
    expect(parseNativeErrorMessage(wrapped)).toEqual({
      code: 'DOWNLOAD_FAILED',
      modelId: 'embedding-gemma-300m',
      reason:
        'Unable to resolve host "storage.googleapis.com": No address associated with hostname',
    });
  });

  it('parses wrapped codes with an empty modelId (iOS-style)', () => {
    const wrapped =
      "Call to function 'ExpoAiKit.embed' has been rejected.\n" +
      '→ Caused by: LANGUAGE_NOT_SUPPORTED::No on-device embedding model supports language "xx".';
    expect(parseNativeErrorMessage(wrapped)).toEqual({
      code: 'LANGUAGE_NOT_SUPPORTED',
      modelId: '',
      reason: 'No on-device embedding model supports language "xx".',
    });
  });

  it('keeps colons inside the reason', () => {
    const parsed = parseNativeErrorMessage(
      'DOWNLOAD_CORRUPT:gemma-e2b:SHA256 mismatch: expected aa, got bb'
    );
    expect(parsed?.reason).toBe('SHA256 mismatch: expected aa, got bb');
  });

  it('finds a known code even when glued to leading uppercase noise', () => {
    expect(parseNativeErrorMessage('ERRORDOWNLOAD_FAILED:m:oops')?.code).toBe('DOWNLOAD_FAILED');
  });

  it('returns null for unknown codes and plain messages', () => {
    expect(parseNativeErrorMessage('SOME_RANDOM_CODE:x:y')).toBeNull();
    expect(parseNativeErrorMessage('something went wrong')).toBeNull();
    expect(parseNativeErrorMessage('')).toBeNull();
  });

  it('parses the built-in availability contracts emitted by generation and streams', () => {
    // iOS < 26 / Apple Intelligence off (sendMessage, startStreaming, setModel).
    expect(
      parseNativeErrorMessage(
        'DEVICE_NOT_SUPPORTED:apple-fm:Apple Foundation Models requires iOS 26 or later'
      )
    ).toEqual({
      code: 'DEVICE_NOT_SUPPORTED',
      modelId: 'apple-fm',
      reason: 'Apple Foundation Models requires iOS 26 or later',
    });
    // iOS 26 with OS-managed assets still preparing.
    expect(
      parseNativeErrorMessage(
        'MODEL_NOT_DOWNLOADED:apple-fm:The Apple Foundation model is not ready yet (the OS may still be downloading it). Try again later'
      )?.code
    ).toBe('MODEL_NOT_DOWNLOADED');
    // Stream error events wrap unrecognized native messages as INFERENCE_FAILED
    // but pass through messages already carrying a known contract prefix.
    expect(parseNativeErrorMessage('INFERENCE_FAILED:mlkit:something broke')?.code).toBe(
      'INFERENCE_FAILED'
    );
    expect(parseNativeErrorMessage('INFERENCE_OOM:gemma-e2b:out of memory')?.code).toBe(
      'INFERENCE_OOM'
    );
  });

  it('knows every code the native layer emits', () => {
    for (const code of [
      'MODEL_NOT_DOWNLOADED',
      'DOWNLOAD_CANCELLED',
      'EMBEDDINGS_NOT_ENABLED',
      'LANGUAGE_NOT_SUPPORTED',
      'INFERENCE_BUSY',
    ] as const) {
      expect(KNOWN_ERROR_CODES.has(code)).toBe(true);
      expect(parseNativeErrorMessage(`${code}:m:r`)?.code).toBe(code);
    }
  });
});
