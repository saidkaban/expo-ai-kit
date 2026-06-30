# expo-ai-kit

On-device AI for Expo & React Native — run LLMs locally. No API keys, no cloud, no cost.

[![npm version](https://img.shields.io/npm/v/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Runs **Apple Foundation Models** (iOS 26+), **ML Kit** (Android), and downloadable
**Gemma 4** (E2B / E4B, iOS + Android via [LiteRT-LM](https://ai.google.dev/edge/litert-lm))
— with streaming, structured output, tool calling, **embeddings & on-device RAG**,
cancellation, and runtime model switching, all on-device.

## Install

```bash
npx expo install expo-ai-kit
```

Bare RN: run `npx pod-install`. Android needs `minSdkVersion 26`. Requires Expo SDK 54+.

## Text

```tsx
import { isAvailable, sendMessage, streamMessage } from 'expo-ai-kit';

if (await isAvailable()) {
  const { text } = await sendMessage([{ role: 'user', content: 'Capital of France?' }]);

  const { promise, stop } = streamMessage(
    [{ role: 'user', content: 'Write a short story' }],
    (e) => setText(e.accumulatedText),
  );
  await promise; // stop() to cancel
}
```

`messages` is `{ role: 'system' | 'user' | 'assistant'; content: string }[]`. On-device
models are stateless — pass the full history each call.

## Structured output

Get a typed object back instead of a string. Pass a JSON Schema; expo-ai-kit prompts the
model, extracts the JSON (tolerating prose and code fences), validates it against the
schema, and repairs on a mismatch. Works on every backend.

```tsx
import { generateObject } from 'expo-ai-kit';

type Recipe = { title: string; minutes: number; ingredients: string[] };

const { object } = await generateObject<Recipe>(
  [{ role: 'user', content: 'A quick weeknight pasta.' }],
  {
    type: 'object',
    properties: {
      title: { type: 'string' },
      minutes: { type: 'integer' },
      ingredients: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'minutes', 'ingredients'],
  },
);

object.title; // typed Recipe
```

Throws `INFERENCE_FAILED` if the model can't produce schema-valid JSON after the repair
attempts (`maxRepairAttempts`, default 2). Keep schemas small and shallow for best results.

## Tool calling

Let the model call functions you provide. It proposes a call, expo-ai-kit validates the
arguments against the tool's schema, runs your `execute`, feeds the result back, and loops
until it produces an answer (bounded by `maxSteps`, default 5). Works on every backend.

```tsx
import { generateText } from 'expo-ai-kit';

const { text } = await generateText(
  [{ role: 'user', content: 'What should I wear in Paris today?' }],
  {
    tools: {
      getWeather: {
        description: 'Get the current weather for a city.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
        execute: async ({ city }: { city: string }) => fetchWeather(city),
      },
    },
  },
);
```

Omit a tool's `execute` to gate it yourself: the loop stops with `finishReason: 'tool-calls'`
and hands you the proposed call to confirm before running. Keep tool sets small and parameter
schemas flat — on-device models pick tools more reliably that way.

## Embeddings & RAG

Turn text into vectors for semantic search and retrieval-augmented generation — find the
chunks of your own documents most relevant to a question, then feed them to the model. All
on-device: your data never leaves the phone.

```tsx
import { embed, chunkText, createVectorStore, sendMessage } from 'expo-ai-kit';

// 1. Index your document once: split → embed → store
const chunks = chunkText(document);                 // overlapping, sentence-aware chunks
const { embeddings } = await embed(chunks);          // one vector per chunk
const store = createVectorStore<{ text: string }>();
store.addMany(chunks.map((text, i) => ({ id: `c${i}`, vector: embeddings[i], metadata: { text } })));

// 2. At query time: embed the question, retrieve the top matches, answer from them
const { embeddings: [q] } = await embed([question]);
const context = store.search(q, { topK: 4 }).map((h) => h.metadata!.text).join('\n\n');

const { text } = await sendMessage([
  { role: 'system', content: `Answer using only this context:\n${context}` },
  { role: 'user', content: question },
]);
```

`embed()` is backed by Apple's `NLContextualEmbedding` — a **zero-download, OS-maintained**
model (iOS 17+, works even without Apple Intelligence). **iOS-only for now**; on Android it
throws `DEVICE_NOT_SUPPORTED` (MediaPipe support is planned). The toolkit —
`chunkText`, `cosineSimilarity`, and the `createVectorStore` (add / search top-k / `toJSON`
for persistence) — is pure JS and works on **both platforms with any vector source**.

## Downloadable models

Beyond the OS built-ins, you can download open models (via LiteRT-LM) and switch to them at
runtime — a size ladder from sub-GB to ~4 GB:

| id | params | download | license |
|---|---|---|---|
| `qwen3-0.6b` | 0.6B | ~0.5 GB | Apache-2.0 |
| `gemma-e2b` | 2.3B | ~2.6 GB | Gemma |
| `qwen3-1.7b` | 1.7B | ~2.1 GB | Apache-2.0 |
| `qwen3-4b` | 4B | ~2.7 GB | Apache-2.0 |
| `gemma-e4b` | 4.5B | ~3.7 GB | Gemma |
| `phi-4-mini` | 3.8B | ~3.9 GB | MIT |

```tsx
import { getDownloadableModels, getRecommendedModel, downloadModel, setModel } from 'expo-ai-kit';

await getDownloadableModels(); // full catalog + per-device status, size, and license

const best = await getRecommendedModel();          // biggest model the device can run, else null
if (best) {
  await downloadModel(best.id, { onProgress: (p) => console.log(p) });
  await setModel(best.id, { generation: { temperature: 0.7 } });
  // sendMessage / streamMessage / generateObject / generateText now use it; unloadModel() reverts to the OS model
}
```

Each entry carries a `license` — check it before shipping a model to your users.

### Bring your own model

Not just the built-in list — register any LiteRT-LM model at runtime with `registerModel()`.
The download is still integrity-checked against the `sha256` you provide. Use
`fetchModelMetadata()` once at dev time to grab the hash + size from HuggingFace, then **pin**
them in your code so the integrity guarantee is real and not just corruption-detection.

```tsx
import { registerModel, fetchModelMetadata, downloadModel, setModel } from 'expo-ai-kit';

const url = 'https://huggingface.co/litert-community/Qwen3-4B/resolve/main/qwen3_4b_mixed_int4.litertlm';

// Dev time: log these once, then hardcode the returned sha256 below.
// const { sha256, sizeBytes } = await fetchModelMetadata(url);

registerModel({
  id: 'qwen3-4b-custom',
  name: 'Qwen3 4B',
  parameterCount: '4B',
  quantization: 'int4',
  downloadUrl: url,
  sha256: 'f0794bc77efeaaf4f7af815f04c483b19b8f2ae4a102cef1b7b760a25848a18e', // pinned
  sizeBytes: 2_659_057_664,
  contextWindow: 4096,
  minRamBytes: 3_000_000_000,
  supportedPlatforms: ['ios', 'android'],
  license: 'Apache-2.0',
});

await downloadModel('qwen3-4b-custom');
await setModel('qwen3-4b-custom');
```

Custom models are in-memory — call `registerModel()` at startup each launch (the downloaded
file persists on disk, so its `'downloaded'` status survives restarts once re-registered).

## API

Inference: `isAvailable`, `sendMessage`, `streamMessage`, `generateObject`, `generateText`.
Embeddings & RAG: `embed`, `chunkText`, `cosineSimilarity`, `createVectorStore`.
Models: `getBuiltInModels`, `getDownloadableModels`, `getRecommendedModel`,
`downloadModel`, `cancelDownload`, `deleteModel`, `setModel`, `unloadModel`, `getActiveModel`.
Custom models: `registerModel`, `unregisterModel`, `getRegisteredModels`, `fetchModelMetadata`.

Failures throw `ModelError` with a typed `.code`. Full TypeScript definitions ship with
the package — see [the docs](https://expo-ai-kit.dev) for the complete reference.

## License

MIT
