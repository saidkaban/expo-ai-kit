import {
  validateModelEntry,
  parseHuggingFaceUrl,
  registerModel,
  unregisterModel,
  getRegisteredModels,
  getAllModels,
  getRegistryEntry,
  filterDownloadedModels,
  ANDROID_EMBEDDING_MODEL,
  MODEL_REGISTRY,
  type ModelRegistryEntry,
} from '../models';

import type { DownloadableModel } from '../types';

function validEntry(overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry {
  return {
    id: 'test-model',
    name: 'Test Model',
    parameterCount: '1B',
    quantization: 'int4',
    downloadUrl: 'https://huggingface.co/acme/test/resolve/main/model.litertlm',
    sha256: 'a'.repeat(64),
    sizeBytes: 1_000_000,
    contextWindow: 4096,
    minRamBytes: 1_000_000_000,
    supportedPlatforms: ['ios', 'android'],
    license: 'Apache-2.0',
    ...overrides,
  };
}

// Custom models live in module state — keep tests isolated.
afterEach(() => {
  for (const m of getRegisteredModels()) unregisterModel(m.id);
});

describe('validateModelEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateModelEntry(validEntry())).toEqual([]);
  });

  it('rejects a missing id', () => {
    expect(validateModelEntry(validEntry({ id: '' }))).toContain('id is required');
  });

  it('rejects a non-http(s) download URL', () => {
    const errs = validateModelEntry(validEntry({ downloadUrl: 'ftp://x/y' }));
    expect(errs.some((e) => e.includes('downloadUrl'))).toBe(true);
  });

  it('rejects a malformed sha256', () => {
    expect(validateModelEntry(validEntry({ sha256: 'abc' })).some((e) => e.includes('sha256'))).toBe(
      true
    );
  });

  it('rejects a non-positive sizeBytes', () => {
    expect(
      validateModelEntry(validEntry({ sizeBytes: 0 })).some((e) => e.includes('sizeBytes'))
    ).toBe(true);
  });

  it('rejects an empty platform list', () => {
    expect(
      validateModelEntry(validEntry({ supportedPlatforms: [] })).some((e) =>
        e.includes('supportedPlatforms')
      )
    ).toBe(true);
  });

  it('rejects an unknown platform', () => {
    const errs = validateModelEntry(validEntry({ supportedPlatforms: ['web' as any] }));
    expect(errs.some((e) => e.includes('supportedPlatforms'))).toBe(true);
  });

  it('rejects a non-integer context window', () => {
    expect(
      validateModelEntry(validEntry({ contextWindow: 4096.5 })).some((e) =>
        e.includes('contextWindow')
      )
    ).toBe(true);
  });
});

describe('parseHuggingFaceUrl', () => {
  it('parses a standard resolve URL', () => {
    expect(
      parseHuggingFaceUrl('https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/m.litertlm')
    ).toEqual({ repo: 'litert-community/Qwen3-0.6B', revision: 'main', path: 'm.litertlm' });
  });

  it('strips a query string', () => {
    expect(
      parseHuggingFaceUrl('https://huggingface.co/a/b/resolve/main/m.litertlm?download=true')
    ).toEqual({ repo: 'a/b', revision: 'main', path: 'm.litertlm' });
  });

  it('handles a nested file path', () => {
    expect(parseHuggingFaceUrl('https://huggingface.co/a/b/resolve/main/sub/dir/m.litertlm')).toEqual(
      { repo: 'a/b', revision: 'main', path: 'sub/dir/m.litertlm' }
    );
  });

  it('returns null for a non-HuggingFace URL', () => {
    expect(parseHuggingFaceUrl('https://example.com/a/b/resolve/main/m.litertlm')).toBeNull();
  });

  it('returns null for a HuggingFace URL that is not a resolve URL', () => {
    expect(parseHuggingFaceUrl('https://huggingface.co/litert-community/Qwen3-0.6B')).toBeNull();
  });
});

describe('registerModel / getRegistryEntry', () => {
  it('registers a valid custom model and looks it up', () => {
    registerModel(validEntry({ id: 'my-model' }));
    expect(getRegistryEntry('my-model')?.name).toBe('Test Model');
    expect(getRegisteredModels().map((m) => m.id)).toContain('my-model');
    expect(getAllModels().length).toBe(MODEL_REGISTRY.length + 1);
  });

  it('throws on an invalid entry', () => {
    expect(() => registerModel(validEntry({ sha256: 'nope' }))).toThrow(/invalid model entry/);
  });

  it('throws when colliding with a built-in curated id', () => {
    expect(() => registerModel(validEntry({ id: 'gemma-e2b' }))).toThrow(/reserved model id/);
  });

  it('throws when colliding with a reserved native id', () => {
    expect(() => registerModel(validEntry({ id: 'apple-fm' }))).toThrow(/reserved model id/);
  });

  it('throws when colliding with the embedding model asset id', () => {
    expect(() => registerModel(validEntry({ id: ANDROID_EMBEDDING_MODEL.id }))).toThrow(
      /reserved model id/
    );
  });

  it('accepts a valid preferredBackend and rejects an invalid one', () => {
    expect(validateModelEntry(validEntry({ preferredBackend: 'cpu' }))).toEqual([]);
    expect(validateModelEntry(validEntry())).toEqual([]);
    expect(
      validateModelEntry(validEntry({ preferredBackend: 'npu' as never }))
    ).toContain('preferredBackend must be "auto", "gpu", or "cpu" when provided');
  });

  it('pins qwen3 models to the CPU backend (GPU path broken in LiteRT-LM 0.10.0)', () => {
    for (const id of ['qwen3-0.6b', 'qwen3-1.7b', 'qwen3-4b']) {
      expect(getRegistryEntry(id)?.preferredBackend).toBe('cpu');
    }
  });

  it('re-registering the same id overwrites it', () => {
    registerModel(validEntry({ id: 'my-model', name: 'First' }));
    registerModel(validEntry({ id: 'my-model', name: 'Second' }));
    expect(getRegistryEntry('my-model')?.name).toBe('Second');
    expect(getRegisteredModels().filter((m) => m.id === 'my-model')).toHaveLength(1);
  });

  it('clones the entry so later mutation does not corrupt the registry', () => {
    const entry = validEntry({ id: 'my-model' });
    registerModel(entry);
    entry.supportedPlatforms.push('web' as any);
    expect(getRegistryEntry('my-model')?.supportedPlatforms).toEqual(['ios', 'android']);
  });

  it('unregisterModel removes a custom model and reports it', () => {
    registerModel(validEntry({ id: 'my-model' }));
    expect(unregisterModel('my-model')).toBe(true);
    expect(getRegistryEntry('my-model')).toBeUndefined();
    expect(unregisterModel('my-model')).toBe(false);
  });

  it('does not let getRegisteredModels expose built-in models', () => {
    expect(getRegisteredModels()).toEqual([]);
    expect(getRegistryEntry('gemma-e2b')).toBeDefined(); // built-in still resolvable
  });
});

describe('filterDownloadedModels', () => {
  it('returns only models that are downloaded, loading, or ready', () => {
    const models = [
      { id: 'downloaded-model', status: 'downloaded' },
      { id: 'loading-model', status: 'loading' },
      { id: 'ready-model', status: 'ready' },
      { id: 'not-downloaded-model', status: 'not-downloaded' },
      { id: 'downloading-model', status: 'downloading' },
    ] as DownloadableModel[];

    const result = filterDownloadedModels(models);

    expect(result.map((model) => model.id)).toEqual([
      'downloaded-model',
      'loading-model',
      'ready-model',
    ]);
  });

  it('returns an empty array when no models are available', () => {
    const models = [
      { id: 'missing-model', status: 'not-downloaded' },
      { id: 'downloading-model', status: 'downloading' },
    ] as DownloadableModel[];

    expect(filterDownloadedModels(models)).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const models = [
      { id: 'model-1', status: 'downloaded' },
      { id: 'model-2', status: 'not-downloaded' },
    ] as DownloadableModel[];

    const result = filterDownloadedModels(models);

    expect(result).not.toBe(models);
    expect(models).toHaveLength(2);
  });
});
