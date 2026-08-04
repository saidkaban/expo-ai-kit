# expo-ai-kit

On-device AI for Expo & React Native — run LLMs locally. No API keys, no cloud, no cost.

[![npm version](https://img.shields.io/npm/v/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Runs **Apple Foundation Models** (iOS 26+), **ML Kit** (Android), and downloadable
**Gemma 4** (E2B / E4B, iOS + Android via [LiteRT-LM](https://ai.google.dev/edge/litert-lm))
— with streaming, structured output, tool calling, **embeddings & on-device RAG**,
cancellation, and runtime model switching, all on-device.

**New in 0.13:** [**embeddings on Android**](#embeddings--rag) — EmbeddingGemma 300M via
MediaPipe TextEmbedder (opt-in) closes the platform gap — plus embedding `task` types for
real RAG quality, an iOS `language` option (Latin / Cyrillic / CJK script models), and a
model identity on every result.

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
const { embeddings } = await embed(chunks, { task: 'retrieval-document' }); // one vector per chunk
const store = createVectorStore<{ text: string }>();
store.addMany(chunks.map((text, i) => ({ id: `c${i}`, vector: embeddings[i], metadata: { text } })));

// 2. At query time: embed the question, retrieve the top matches, answer from them
const { embeddings: [q] } = await embed([question], { task: 'retrieval-query' });
const context = store.search(q, { topK: 4 }).map((h) => h.metadata!.text).join('\n\n');

const { text } = await sendMessage([
  { role: 'system', content: `Answer using only this context:\n${context}` },
  { role: 'user', content: question },
]);
```

`options.task` says what the vectors are for — `'semantic-similarity'` (default),
`'retrieval-query'`, or `'retrieval-document'`. Use the retrieval pair for RAG as above:
EmbeddingGemma (Android) is task-conditioned, so it measurably improves retrieval. iOS
accepts it as semantic intent only.

**Backends** (one per platform — see the model-identity rule below):

- **iOS (17+):** Apple's `NLContextualEmbedding` — **zero-download, OS-maintained** script
  models (works even without Apple Intelligence). `options.language` (BCP-47, default
  `'en'`) selects the script model (Latin / Cyrillic / CJK). Languages supported on a
  real iOS 27 device: bg, cs, da, de, en, es, fi, fr, hr, hu, id, it, ja, kk, ko, nb,
  nl, pl, pt, ro, ru, sk, sv, tr, uk, vi, zh-Hans, zh-Hant — call
  `getSupportedEmbeddingLanguages()` for the running device's authoritative list. An
  unsupported language throws a typed `LANGUAGE_NOT_SUPPORTED` error — never a silent
  fall-back to the Latin model.
- **Android:** **EmbeddingGemma 300M** via MediaPipe TextEmbedder — 768 dimensions, max
  sequence 512 tokens, CPU, natively **multilingual in a single vector space** (so
  `language` is accepted and ignored — there's nothing to select). **Opt-in:**

  ```json
  // app.json
  { "expo": { "plugins": [["expo-ai-kit", { "androidEmbeddings": true }]] } }
  ```

  Off by default (zero bytes added to your APK; `embed()` throws a typed
  `EMBEDDINGS_NOT_ENABLED` error). Enabling adds **~25 MB to the APK** (arm64) and
  requires a **new native build** (dev client / EAS — not OTA). The model itself is a
  **~184 MB** Google-hosted download stored per-app — unlike the iOS assets, it's *not*
  OS-managed:

  ```tsx
  import { getEmbeddingModelStatus, prepareEmbeddingModel } from 'expo-ai-kit';

  const { status, sizeBytes } = await getEmbeddingModelStatus();
  if (status !== 'downloaded') {
    await prepareEmbeddingModel({ onProgress: (p) => console.log(p) }); // SHA-256 verified
  }
  // embed() itself NEVER downloads — it throws MODEL_NOT_DOWNLOADED until prepared.
  // cancelEmbeddingModelDownload() / deleteEmbeddingModel() round out the lifecycle.
  ```

  EmbeddingGemma ships under the **Gemma Terms of Use** — review them before shipping.

**Model identity — the index-compatibility rule.** Every result carries
`model: { id, revision }` for the exact model that produced it. **Vectors and persisted
indexes are only comparable under identical model identity** — never across platforms,
never across iOS script models. Store it next to any persisted index and rebuild when it
changes.

The toolkit — `chunkText`, `cosineSimilarity`, and the `createVectorStore` (add / search
top-k / `toJSON` for persistence) — is pure JS and works on **both platforms with any
vector source**. `embed()` runs outside the `INFERENCE_BUSY` generation guard, so it can
run alongside generation.

## Vercel AI SDK

expo-ai-kit ships a first-class [AI SDK](https://ai-sdk.dev) provider: point `model:` at
`expoAiKit()` and the AI SDK's `generateText` / `streamText` / `generateObject` / `embed`
run **on-device** — reuse code, examples, and patterns written for cloud providers, with
no API key and no data leaving the phone.

```bash
npm i ai   # AI SDK 6+ (the provider implements LanguageModelV3; AI SDK 7 accepts it too)
```

```tsx
import { generateText, streamText, embed } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';

// Text — the active on-device model (OS built-in by default)
const { text } = await generateText({
  model: expoAiKit(),
  prompt: 'Capital of France?',
});

// Streaming — pass a specific model id to activate it first
const result = streamText({
  model: expoAiKit('gemma-e2b'),  // must be downloaded; settings ride along:
  // model: expoAiKit('gemma-e2b', { generation: { temperature: 0.7 } }),
  prompt: 'Write a short story',
});
for await (const chunk of result.textStream) setText((t) => t + chunk);

// Embeddings — Apple NLContextualEmbedding on iOS, EmbeddingGemma on Android
const { embedding } = await embed({
  model: expoAiKit.embeddingModel(undefined, { task: 'retrieval-query' }),
  value: 'sunny day at the beach',
});
```

Tool calling and `generateObject` work too — they ride the exact same prompt protocol as
the core `generateText`/`generateObject`, so behavior is identical either way.

**On-device caveats** (the honest fine print):

- **One generation at a time.** Concurrent calls reject with `INFERENCE_BUSY` — on-device
  models share a single KV-cache. Await one call before starting the next.
- **Sampling is fixed at model activation**, not per call. A per-call `temperature`/`topK`
  is reported as an AI SDK warning and ignored; set it via `expoAiKit(id, { generation })`
  or `setModel()`.
- **Streaming buffers when tools or JSON output are requested** — the tool-call envelope
  has to be parsed whole, not leaked as text deltas. Plain-text streaming is token-by-token.
- **No token usage numbers** (on-device runtimes don't report them) and no image/file inputs
  (vision is on the roadmap). `embeddingModel()` reports the platform's real model id
  (`apple-nl-contextual` / `embedding-gemma-300m`); on Android it needs the
  `androidEmbeddings` config-plugin flag plus a `prepareEmbeddingModel()` download, like
  `embed()`.
- React Native needs the AI SDK's usual polyfills (e.g. `web-streams-polyfill`,
  `structuredClone`, `TextEncoder`) — see the docs for a copy-paste setup.

The provider is a thin wrapper over the same core functions below — mix and match freely.
The core stays **zero-dependency**; `@ai-sdk/provider` is an optional peer used only for
types when you import `expo-ai-kit/ai`.

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

> **Android emulators on Intel/AMD hosts (x86_64):** downloadable models aren't supported —
> LiteRT-LM's x86 backend crashes natively, so `setModel()` throws a catchable
> `DEVICE_NOT_SUPPORTED` error instead of taking the app down. Test on a physical device or an
> arm64 emulator image (Apple Silicon hosts). iOS Simulator and built-in models are unaffected.

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
Embeddings & RAG: `embed`, `getEmbeddingModelStatus`, `prepareEmbeddingModel`,
`cancelEmbeddingModelDownload`, `deleteEmbeddingModel`, `getSupportedEmbeddingLanguages`,
`chunkText`, `cosineSimilarity`, `createVectorStore`.
AI SDK provider (`expo-ai-kit/ai`): `expoAiKit`, `createExpoAiKit`.
Models: `getBuiltInModels`, `getDownloadableModels`, `getDownloadedModels`, `getRecommendedModel`,
`downloadModel`, `cancelDownload`, `deleteModel`, `setModel`, `unloadModel`, `getActiveModel`.
Custom models: `registerModel`, `unregisterModel`, `getRegisteredModels`, `fetchModelMetadata`.

Failures throw `ModelError` with a typed `.code`. Full TypeScript definitions ship with
the package — see [the docs](https://expo-ai-kit.dev) for the complete reference.

## License

MIT
