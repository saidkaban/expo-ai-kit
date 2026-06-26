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

/**
 * Look up a model registry entry by ID.
 * Returns undefined if not found.
 */
export function getRegistryEntry(modelId: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}
