import { uint8ToBase64 } from '../ai/convert';
import { KNOWN_ERROR_CODES } from '../errors';
import {
  ANDROID_ADVANCED_SPEECH_LOCALES,
  ANDROID_BASIC_SPEECH_LOCALES,
  createTranscriptAssembler,
  normalizeSpeechLocale,
  resolveSpeechLocale,
  validateTranscribeAudio,
} from '../speech';

describe('normalizeSpeechLocale', () => {
  it('canonicalizes casing for language, script, and region', () => {
    expect(normalizeSpeechLocale('en-us')).toBe('en-US');
    expect(normalizeSpeechLocale('EN-US')).toBe('en-US');
    expect(normalizeSpeechLocale('cmn-hans-cn')).toBe('cmn-Hans-CN');
    expect(normalizeSpeechLocale('CMN-HANS-CN')).toBe('cmn-Hans-CN');
    expect(normalizeSpeechLocale('ja')).toBe('ja');
  });

  it('treats underscores as hyphens and trims whitespace', () => {
    expect(normalizeSpeechLocale('en_US')).toBe('en-US');
    expect(normalizeSpeechLocale('  pt-br ')).toBe('pt-BR');
  });

  it('returns undefined for empty or absent input', () => {
    expect(normalizeSpeechLocale(undefined)).toBeUndefined();
    expect(normalizeSpeechLocale('')).toBeUndefined();
    expect(normalizeSpeechLocale('   ')).toBeUndefined();
  });
});

describe('resolveSpeechLocale', () => {
  const supported = ['en-US', 'de-DE', 'cmn-Hans-CN'];

  it('prefers an exact match', () => {
    expect(resolveSpeechLocale('de-de', supported)).toBe('de-DE');
  });

  it('falls back to the first same-language entry', () => {
    expect(resolveSpeechLocale('en', supported)).toBe('en-US');
    expect(resolveSpeechLocale('en-GB', supported)).toBe('en-US');
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveSpeechLocale('fr-FR', supported)).toBeUndefined();
    expect(resolveSpeechLocale('', supported)).toBeUndefined();
  });
});

describe('Android speech locale registries', () => {
  it('are normalized BCP-47 tags (self-consistent with the normalizer)', () => {
    for (const tag of [...ANDROID_BASIC_SPEECH_LOCALES, ...ANDROID_ADVANCED_SPEECH_LOCALES]) {
      expect(normalizeSpeechLocale(tag)).toBe(tag);
    }
  });

  it('basic mode includes the stable en-US locale', () => {
    expect(ANDROID_BASIC_SPEECH_LOCALES).toContain('en-US');
    expect(ANDROID_ADVANCED_SPEECH_LOCALES).toContain('en-US');
  });
});

describe('validateTranscribeAudio', () => {
  it('accepts exactly one of uri or base64', () => {
    expect(validateTranscribeAudio({ uri: 'file:///a.wav' })).toEqual({
      uri: 'file:///a.wav',
      base64: '',
      mediaType: '',
    });
    expect(validateTranscribeAudio({ base64: 'QUJD', mediaType: 'audio/wav' })).toEqual({
      uri: '',
      base64: 'QUJD',
      mediaType: 'audio/wav',
    });
  });

  it('rejects empty, missing, or ambiguous input', () => {
    expect(() => validateTranscribeAudio({ uri: '' })).toThrow();
    expect(() => validateTranscribeAudio({ base64: '' })).toThrow();
    expect(() => validateTranscribeAudio({ uri: 'a.wav', base64: 'QUJD' } as never)).toThrow();
  });
});

describe('createTranscriptAssembler', () => {
  it('replaces the volatile tail and commits finals', () => {
    const assembler = createTranscriptAssembler();
    expect(assembler.apply({ text: 'Hel', isFinal: false })).toBe('Hel');
    expect(assembler.apply({ text: 'Hello wor', isFinal: false })).toBe('Hello wor');
    expect(assembler.apply({ text: 'Hello world.', isFinal: true })).toBe('Hello world.');
    expect(assembler.apply({ text: 'How', isFinal: false })).toBe('Hello world. How');
    expect(assembler.apply({ text: 'How are you?', isFinal: true })).toBe(
      'Hello world. How are you?'
    );
    expect(assembler.current()).toBe('Hello world. How are you?');
  });

  it('collapses duplicate whitespace between segments', () => {
    const assembler = createTranscriptAssembler();
    assembler.apply({ text: 'First part. ', isFinal: true });
    expect(assembler.apply({ text: ' second part', isFinal: false })).toBe(
      'First part. second part'
    );
  });

  it('ignores empty finals (engine end-of-session markers)', () => {
    const assembler = createTranscriptAssembler();
    assembler.apply({ text: 'Something', isFinal: false });
    expect(assembler.apply({ text: '', isFinal: true })).toBe('');
    expect(assembler.current()).toBe('');
  });
});

describe('speech error codes', () => {
  it('are all known to the native error parser', () => {
    for (const code of [
      'SPEECH_BUSY',
      'SPEECH_NOT_ENABLED',
      'MIC_PERMISSION_DENIED',
      'AUDIO_DECODE_FAILED',
      'TRANSCRIPTION_FAILED',
    ] as const) {
      expect(KNOWN_ERROR_CODES.has(code)).toBe(true);
    }
  });
});

describe('uint8ToBase64', () => {
  it('matches standard base64 for canonical vectors', () => {
    const encode = (s: string) => uint8ToBase64(new Uint8Array(Buffer.from(s, 'utf8')));
    expect(encode('')).toBe('');
    expect(encode('f')).toBe('Zg==');
    expect(encode('fo')).toBe('Zm8=');
    expect(encode('foo')).toBe('Zm9v');
    expect(encode('foob')).toBe('Zm9vYg==');
    expect(encode('fooba')).toBe('Zm9vYmE=');
    expect(encode('foobar')).toBe('Zm9vYmFy');
  });

  it('round-trips binary data through Buffer', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(uint8ToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
