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
  },
];

/**
 * Look up a model registry entry by ID.
 * Returns undefined if not found.
 */
export function getRegistryEntry(modelId: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}
