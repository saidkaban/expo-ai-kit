/**
 * Model Registry
 *
 * Defines all downloadable models known to expo-ai-kit.
 * getDownloadableModels() reads from this registry and enriches
 * each entry with on-device status from the native layer.
 */

export type ModelRegistryEntry = {
  /** Unique model identifier used in setModel/downloadModel */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Parameter count label */
  parameterCount: string;
  /** Quantization variant */
  quantization: string;
  /** URL to download the LiteRT-LM model file */
  downloadUrl: string;
  /** SHA256 hash for integrity verification after download */
  sha256: string;
  /** Download file size in bytes */
  sizeBytes: number;
  /**
   * Practical context window (max tokens) for this model on constrained devices.
   *
   * These are conservative defaults, NOT the base model's theoretical max.
   * These values should be benchmarked and adjusted during testing with
   * real devices.
   */
  contextWindow: number;
  /** Minimum device RAM in bytes required to run this model */
  minRamBytes: number;
  /** Platforms this model can run on */
  supportedPlatforms: ('ios' | 'android')[];
  /**
   * License the model weights are distributed under — an SPDX identifier
   * (e.g. 'Apache-2.0', 'MIT') or a family name for non-OSI terms (e.g. 'Gemma',
   * 'Llama-3.2'). Surfaced on {@link DownloadableModel} so app developers can
   * check their obligations before shipping a model to users.
   */
  license: string;
};

export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    id: 'gemma-e2b',
    name: 'Gemma 4 E2B',
    parameterCount: '2.3B',
    quantization: 'mixed-2/4/8-bit',
    downloadUrl:
      'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm',
    sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
    sizeBytes: 2_588_147_712, // 2.59GB (exact, HF LFS)
    // Conservative limit for 4GB RAM devices.
    // TODO: Benchmark during Phase 2 testing.
    contextWindow: 8_000,
    minRamBytes: 2_000_000_000, // 2GB — LiteRT-LM memory-maps weights, actual RSS ~1.5GB
    supportedPlatforms: ['ios', 'android'],
    license: 'Gemma',
  },
  {
    id: 'gemma-e4b',
    name: 'Gemma 4 E4B',
    parameterCount: '4.5B',
    quantization: 'mixed-4/8-bit',
    downloadUrl:
      'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm',
    sha256: '0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0',
    sizeBytes: 3_659_530_240, // 3.66GB (exact, HF LFS)
    contextWindow: 16_000,
    minRamBytes: 3_000_000_000, // 3GB — LiteRT-LM memory-maps weights
    supportedPlatforms: ['ios', 'android'],
    license: 'Gemma',
  },
  // --- Qwen3 (Apache-2.0) — official litert-community builds. A size ladder
  // from a sub-GB model that runs anywhere up to a 4B that rivals Gemma E4B. ---
  {
    id: 'qwen3-0.6b',
    name: 'Qwen3 0.6B',
    parameterCount: '0.6B',
    quantization: 'mixed-int4',
    downloadUrl:
      'https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/qwen3_0_6b_mixed_int4.litertlm',
    sha256: 'b1baab462f6be49d70eada79d715c2c52cd9ece0cad00bddf6a2c097d23498e9',
    sizeBytes: 497_664_000, // 475MB (exact, HF LFS)
    // The int4 build ships a 2048-token KV. TODO: benchmark on device.
    contextWindow: 2_048,
    minRamBytes: 1_000_000_000, // 1GB — tiny; runs on virtually any modern device
    supportedPlatforms: ['ios', 'android'],
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen3 1.7B',
    parameterCount: '1.7B',
    quantization: 'dynamic-int8',
    downloadUrl:
      'https://huggingface.co/litert-community/Qwen3-1.7B/resolve/main/Qwen3_1.7B.litertlm',
    sha256: '66064a4e9269cb693e124c4e3040bcb8a446b10bca42663896329495add3861c',
    sizeBytes: 2_056_729_520, // 2.06GB (exact, HF LFS)
    // Conservative default (not marked in the filename). TODO: benchmark on device.
    contextWindow: 4_096,
    minRamBytes: 2_000_000_000, // 2GB
    supportedPlatforms: ['ios', 'android'],
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen3 4B',
    parameterCount: '4B',
    quantization: 'mixed-int4',
    downloadUrl:
      'https://huggingface.co/litert-community/Qwen3-4B/resolve/main/qwen3_4b_mixed_int4.litertlm',
    sha256: 'f0794bc77efeaaf4f7af815f04c483b19b8f2ae4a102cef1b7b760a25848a18e',
    sizeBytes: 2_659_057_664, // 2.66GB (exact, HF LFS)
    // Conservative default (not marked in the filename). TODO: benchmark on device.
    contextWindow: 4_096,
    minRamBytes: 3_000_000_000, // 3GB — 4B params need more headroom than the similarly-sized E2B
    supportedPlatforms: ['ios', 'android'],
    license: 'Apache-2.0',
  },
  // --- Phi-4 Mini (MIT) — strong reasoning; q8 build, the heaviest downloadable. ---
  {
    id: 'phi-4-mini',
    name: 'Phi-4 Mini',
    parameterCount: '3.8B',
    quantization: 'int8',
    downloadUrl:
      'https://huggingface.co/litert-community/Phi-4-mini-instruct/resolve/main/Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm',
    sha256: '7764d4deb53800578307be33039476b38a6c370fff71bedb3c0552563e23ab02',
    sizeBytes: 3_910_090_752, // 3.91GB (exact, HF LFS)
    contextWindow: 4_096, // ekv4096 build
    minRamBytes: 4_000_000_000, // 4GB — q8 weights, heaviest downloadable
    supportedPlatforms: ['ios', 'android'],
    license: 'MIT',
  },
];

// ---------------------------------------------------------------------------
// Custom (developer-registered) models — "bring your own model".
//
// The built-in MODEL_REGISTRY above is curated: each entry's SHA256 is pinned by
// a maintainer who verified the bytes. registerModel() lets app developers add
// any LiteRT-LM model under the same contract — they supply the metadata
// (including the SHA256), so the integrity check still holds end-to-end. Custom
// entries live in memory only; call registerModel() at startup on every launch
// (the downloaded file on disk persists and is keyed by id, so status survives
// restarts once you re-register).
// ---------------------------------------------------------------------------

const customModels = new Map<string, ModelRegistryEntry>();

/** Ids owned by the native built-in backends; not valid for custom models. */
const RESERVED_MODEL_IDS = new Set(['apple-fm', 'mlkit']);

const SHA256_RE = /^[a-f0-9]{64}$/i;

/**
 * Validate a model entry, returning a list of human-readable problems
 * (empty ⇒ valid). Pure — used by {@link registerModel} and unit-tested.
 */
export function validateModelEntry(entry: ModelRegistryEntry): string[] {
  const errors: string[] = [];
  if (!entry || typeof entry !== 'object') return ['entry must be an object'];
  if (!entry.id || typeof entry.id !== 'string') errors.push('id is required');
  if (!entry.name || typeof entry.name !== 'string') errors.push('name is required');
  if (!entry.parameterCount) errors.push('parameterCount is required (e.g. "1.7B")');
  if (!entry.quantization) errors.push('quantization is required (e.g. "int4")');
  if (typeof entry.downloadUrl !== 'string' || !/^https?:\/\//.test(entry.downloadUrl)) {
    errors.push('downloadUrl must be an http(s) URL');
  }
  if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) {
    errors.push('sha256 must be a 64-character hex string (use fetchModelMetadata to obtain it)');
  }
  if (!Number.isFinite(entry.sizeBytes) || entry.sizeBytes <= 0) {
    errors.push('sizeBytes must be a positive number');
  }
  if (!Number.isFinite(entry.minRamBytes) || entry.minRamBytes < 0) {
    errors.push('minRamBytes must be >= 0');
  }
  if (!Number.isInteger(entry.contextWindow) || entry.contextWindow <= 0) {
    errors.push('contextWindow must be a positive integer');
  }
  if (!Array.isArray(entry.supportedPlatforms) || entry.supportedPlatforms.length === 0) {
    errors.push('supportedPlatforms must list at least one of "ios" / "android"');
  } else if (!entry.supportedPlatforms.every((p) => p === 'ios' || p === 'android')) {
    errors.push('supportedPlatforms may only contain "ios" or "android"');
  }
  if (!entry.license || typeof entry.license !== 'string') {
    errors.push('license is required (e.g. "Apache-2.0", "MIT")');
  }
  return errors;
}

/**
 * Register a custom downloadable model at runtime.
 *
 * After registering, the id works with `downloadModel` / `setModel` /
 * `getDownloadableModels` exactly like a built-in. The download is integrity-
 * checked against the `sha256` you provide — pin a value you trust (see
 * {@link fetchModelMetadata}). Throws if the entry is invalid or the id
 * collides with a built-in (curated or native) model.
 *
 * @example
 * ```ts
 * const { sha256, sizeBytes } = await fetchModelMetadata(url); // dev-time
 * registerModel({
 *   id: 'qwen3-8b', name: 'Qwen3 8B', parameterCount: '8B', quantization: 'int4',
 *   downloadUrl: url, sha256, sizeBytes,
 *   contextWindow: 4096, minRamBytes: 6_000_000_000,
 *   supportedPlatforms: ['ios', 'android'], license: 'Apache-2.0',
 * });
 * ```
 */
export function registerModel(entry: ModelRegistryEntry): void {
  const errors = validateModelEntry(entry);
  if (errors.length > 0) {
    throw new Error(`registerModel: invalid model entry — ${errors.join('; ')}`);
  }
  if (RESERVED_MODEL_IDS.has(entry.id) || MODEL_REGISTRY.some((m) => m.id === entry.id)) {
    throw new Error(`registerModel: "${entry.id}" is a built-in model id; choose a different id`);
  }
  // Clone so later external mutation of the caller's object can't corrupt the registry.
  customModels.set(entry.id, { ...entry, supportedPlatforms: [...entry.supportedPlatforms] });
}

/**
 * Remove a previously {@link registerModel}'d custom model.
 * Returns true if one was removed. Does not delete any downloaded file —
 * use `deleteModel` for that. No-op for built-in models.
 */
export function unregisterModel(modelId: string): boolean {
  return customModels.delete(modelId);
}

/** All custom models registered via {@link registerModel}, in registration order. */
export function getRegisteredModels(): ModelRegistryEntry[] {
  return [...customModels.values()];
}

/** Built-in registry plus all custom models. */
export function getAllModels(): ModelRegistryEntry[] {
  return [...MODEL_REGISTRY, ...customModels.values()];
}

/**
 * Look up a model registry entry by ID (built-in or custom).
 * Returns undefined if not found.
 */
export function getRegistryEntry(modelId: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId) ?? customModels.get(modelId);
}

/**
 * Parse a HuggingFace "resolve" download URL into its parts.
 * Returns null if the URL isn't a HuggingFace resolve URL. Pure — unit-tested.
 *
 * e.g. https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/model.litertlm
 *   → { repo: 'litert-community/Qwen3-0.6B', revision: 'main', path: 'model.litertlm' }
 */
export function parseHuggingFaceUrl(
  url: string
): { repo: string; revision: string; path: string } | null {
  if (typeof url !== 'string') return null;
  const clean = url.split('#')[0].split('?')[0];
  const m = /^https?:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/.exec(clean);
  if (!m) return null;
  return { repo: m[1], revision: m[2], path: decodeURIComponent(m[3]) };
}

/**
 * Look up a model file's SHA256 and byte size from HuggingFace, so you can fill
 * in a {@link registerModel} entry without computing them by hand.
 *
 * Trust note: this reads the hash from the same host you'll download from, so it
 * only guards against download corruption — NOT a maliciously changed upstream
 * repo. For a real supply-chain guarantee, run this once at dev time and PIN the
 * returned `sha256` in your source, exactly like the built-in registry.
 *
 * @param downloadUrl - A HuggingFace resolve URL (the one you'll register).
 * @returns `{ sha256, sizeBytes }` ready to spread into a registry entry.
 * @throws if the URL isn't a HuggingFace resolve URL, the API call fails, or the
 *   file isn't an LFS object (no hash/size available).
 */
export async function fetchModelMetadata(
  downloadUrl: string
): Promise<{ sha256: string; sizeBytes: number }> {
  const parsed = parseHuggingFaceUrl(downloadUrl);
  if (!parsed) {
    throw new Error(
      'fetchModelMetadata: expected a HuggingFace resolve URL ' +
        '(https://huggingface.co/<owner>/<repo>/resolve/<revision>/<file>)'
    );
  }
  const { repo, revision, path } = parsed;
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash) : '';
  const treeUrl =
    `https://huggingface.co/api/models/${repo}/tree/${revision}` + (dir ? `/${dir}` : '');

  const res = await fetch(treeUrl);
  if (!res.ok) {
    throw new Error(`fetchModelMetadata: HuggingFace API returned ${res.status} for ${treeUrl}`);
  }
  const items = (await res.json()) as Array<{
    path?: string;
    size?: number;
    lfs?: { oid?: string; size?: number };
  }>;
  const file = Array.isArray(items) ? items.find((it) => it?.path === path) : undefined;
  if (!file) {
    throw new Error(`fetchModelMetadata: "${path}" not found in ${repo}@${revision}`);
  }
  const sha256 = file.lfs?.oid;
  const sizeBytes = file.lfs?.size ?? file.size;
  if (!sha256 || !sizeBytes) {
    throw new Error(
      `fetchModelMetadata: "${path}" has no LFS hash/size — is it the actual model weight file?`
    );
  }
  return { sha256, sizeBytes };
}
