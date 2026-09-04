import { EMBEDDING_TASKS, isValidEmbeddingTask, normalizeLanguageTag } from '../embedding';
import {
  ANDROID_EMBEDDING_MODEL,
  composeAndroidEmbeddingRevision,
  getRegistryEntry,
} from '../models';

describe('EMBEDDING_TASKS / isValidEmbeddingTask', () => {
  it('lists exactly the three supported tasks', () => {
    expect(EMBEDDING_TASKS).toEqual([
      'semantic-similarity',
      'retrieval-query',
      'retrieval-document',
    ]);
  });

  it('accepts each supported task', () => {
    for (const task of EMBEDDING_TASKS) {
      expect(isValidEmbeddingTask(task)).toBe(true);
    }
  });

  it('rejects unknown values and non-strings', () => {
    expect(isValidEmbeddingTask('classification')).toBe(false);
    expect(isValidEmbeddingTask('SEMANTIC-SIMILARITY')).toBe(false);
    expect(isValidEmbeddingTask('')).toBe(false);
    expect(isValidEmbeddingTask(undefined)).toBe(false);
    expect(isValidEmbeddingTask(null)).toBe(false);
    expect(isValidEmbeddingTask(42)).toBe(false);
  });
});

describe('normalizeLanguageTag', () => {
  it('passes through canonical tags', () => {
    expect(normalizeLanguageTag('en')).toBe('en');
    expect(normalizeLanguageTag('fr')).toBe('fr');
    expect(normalizeLanguageTag('zh-Hans')).toBe('zh-Hans');
    expect(normalizeLanguageTag('en-US')).toBe('en-US');
    expect(normalizeLanguageTag('fil')).toBe('fil');
  });

  it('canonicalizes case per BCP-47 conventions', () => {
    expect(normalizeLanguageTag('EN')).toBe('en');
    expect(normalizeLanguageTag('en-us')).toBe('en-US');
    expect(normalizeLanguageTag('zh-hans')).toBe('zh-Hans');
    expect(normalizeLanguageTag('ZH-HANS')).toBe('zh-Hans');
    expect(normalizeLanguageTag('sr-cyrl-rs')).toBe('sr-Cyrl-RS');
  });

  it('accepts underscores as separators (POSIX-style locales)', () => {
    expect(normalizeLanguageTag('en_US')).toBe('en-US');
    expect(normalizeLanguageTag('zh_hans')).toBe('zh-Hans');
  });

  it('uppercases 3-digit (UN M49) region subtags', () => {
    expect(normalizeLanguageTag('es-419')).toBe('es-419');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLanguageTag('  en ')).toBe('en');
  });

  it('throws on empty and non-string input', () => {
    expect(() => normalizeLanguageTag('')).toThrow(/non-empty/);
    expect(() => normalizeLanguageTag('   ')).toThrow();
    expect(() => normalizeLanguageTag(undefined as unknown as string)).toThrow(/BCP-47/);
    expect(() => normalizeLanguageTag(42 as unknown as string)).toThrow(/BCP-47/);
  });

  it('throws when the primary subtag is not 2–3 letters', () => {
    expect(() => normalizeLanguageTag('e')).toThrow(/primary subtag/);
    expect(() => normalizeLanguageTag('english')).toThrow(/primary subtag/);
    expect(() => normalizeLanguageTag('123')).toThrow(/primary subtag/);
    expect(() => normalizeLanguageTag('-en')).toThrow(/primary subtag/);
  });

  it('throws on malformed subtags', () => {
    expect(() => normalizeLanguageTag('en-')).toThrow(/bad subtag/);
    expect(() => normalizeLanguageTag('en--US')).toThrow(/bad subtag/);
    expect(() => normalizeLanguageTag('en-US!')).toThrow(/bad subtag/);
  });
});

describe('ANDROID_EMBEDDING_MODEL', () => {
  it('pins a well-formed Google-hosted bundle', () => {
    expect(ANDROID_EMBEDDING_MODEL.id).toBe('embedding-gemma-300m');
    expect(ANDROID_EMBEDDING_MODEL.downloadUrl).toMatch(
      /^https:\/\/storage\.googleapis\.com\/mediapipe-models\//
    );
    expect(ANDROID_EMBEDDING_MODEL.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ANDROID_EMBEDDING_MODEL.sizeBytes).toBe(183_816_181);
    expect(ANDROID_EMBEDDING_MODEL.dimensions).toBe(768);
    expect(ANDROID_EMBEDDING_MODEL.maxSequenceLength).toBe(512);
    expect(ANDROID_EMBEDDING_MODEL.license).toBe('Gemma');
  });

  it('is not a generation model, absent from the downloadable registry', () => {
    expect(getRegistryEntry(ANDROID_EMBEDDING_MODEL.id)).toBeUndefined();
  });
});

describe('composeAndroidEmbeddingRevision', () => {
  const base = {
    tasksTextVersion: '1.0.0',
    sha256: 'a'.repeat(64),
    dimensions: 768,
    formatContextProtocol: 'tfc1',
  };

  it('encodes every pinned artifact', () => {
    expect(composeAndroidEmbeddingRevision(base)).toBe(`1.0.0-${'a'.repeat(12)}-d768-tfc1`);
  });

  it('changes when any pinned artifact changes', () => {
    const revision = composeAndroidEmbeddingRevision(base);
    expect(composeAndroidEmbeddingRevision({ ...base, tasksTextVersion: '1.1.0' })).not.toBe(
      revision
    );
    expect(composeAndroidEmbeddingRevision({ ...base, sha256: 'b'.repeat(64) })).not.toBe(revision);
    expect(composeAndroidEmbeddingRevision({ ...base, dimensions: 512 })).not.toBe(revision);
    expect(composeAndroidEmbeddingRevision({ ...base, formatContextProtocol: 'tfc2' })).not.toBe(
      revision
    );
  });

  it('produces the shipped revision from the shipped pins', () => {
    expect(composeAndroidEmbeddingRevision(ANDROID_EMBEDDING_MODEL)).toBe(
      '1.0.0-913b7a1edc7c-d768-tfc1'
    );
  });
});
