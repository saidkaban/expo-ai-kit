<h1 align="center">expo-ai-kit</h1>

<p align="center">
  <strong>On-device AI for Expo & React Native.</strong><br />
  No API keys. No cloud. No cost.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/expo-ai-kit"><img src="https://img.shields.io/npm/v/expo-ai-kit.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/expo-ai-kit"><img src="https://img.shields.io/npm/dw/expo-ai-kit.svg" alt="weekly downloads" /></a>
  <a href="https://github.com/saidkaban/expo-ai-kit"><img src="https://img.shields.io/github/stars/saidkaban/expo-ai-kit" alt="GitHub stars" /></a>
  <a href="https://github.com/saidkaban/expo-ai-kit/actions/workflows/ci.yml"><img src="https://github.com/saidkaban/expo-ai-kit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://expo-ai-kit.dev">Documentation</a> ·
  <a href="https://www.npmjs.com/package/expo-ai-kit">npm</a> ·
  <a href="https://github.com/saidkaban/expo-ai-kit/blob/main/CHANGELOG.md">Changelog</a> ·
  <a href="https://expo-ai-kit.dev/llms.txt">llms.txt</a>
</p>

Run private, local AI across **Apple Foundation Models**, **ML Kit**, and downloadable
**Gemma 4**, **Qwen3**, and **Phi-4 Mini** models—or register your own
[LiteRT-LM](https://ai.google.dev/edge/litert-lm) model. Transcribe speech on-device with native
Apple and Google speech models. Stream text, generate typed objects, call tools, build on-device
RAG, switch models at runtime, or use the package as a **Vercel AI SDK provider**.

| | |
|---|---|
| 🔒 **Private by default** | Inference, speech, and embeddings run on the device. |
| 📱 **Native first** | Use Apple Foundation Models and ML Kit without bundling model weights. |
| 🎙️ **On-device speech** | Transcribe audio locally with native Apple and Google speech models. |
| 🧠 **Bring your model** | Download curated models or register any compatible LiteRT-LM bundle. |
| 🧩 **Useful primitives** | Streaming, speech, structured output, tools, embeddings, RAG, and cancellation. |
| 🔌 **AI SDK compatible** | Use `expo-ai-kit/ai` with familiar AI SDK APIs and patterns. |
| 🪶 **Zero runtime dependencies** | The core package keeps `dependencies` empty. |

## Compatibility

| Capability | iOS | Android |
|---|---|---|
| Library minimum | iOS 15.1+ | API 26+ |
| Built-in generation | Apple Foundation Models, iOS 26+ when available | ML Kit Prompt API on supported devices |
| Downloadable generation | Gemma, Qwen, Phi, and custom LiteRT-LM models | Gemma, Qwen, Phi, and custom LiteRT-LM models |
| Speech-to-text | SpeechAnalyzer, iOS 26+ when available | ML Kit GenAI Speech Recognition on supported devices |
| Embeddings | `NLContextualEmbedding`, iOS 17+ | EmbeddingGemma 300M, opt-in |
| Expo | Expo SDK 54+, development or production build | Expo SDK 54+, development or production build |

Runtime support still depends on the device, OS configuration, available memory, and selected model.
Use `isAvailable()` and the model-management APIs instead of assuming support.

## Install

```bash
npx expo install expo-ai-kit
```

> **expo-ai-kit contains native Swift and Kotlin code and is not available in Expo Go.** Use a
> [development build](https://docs.expo.dev/develop/development-builds/introduction/),
> `npx expo run:ios|android`, or EAS Build.

For bare React Native, first ensure Expo modules are installed, then run `npx pod-install` for iOS.
Android requires `minSdkVersion 26`.

## Quick start

```tsx
import { isAvailable, prepareBuiltInModel, sendMessage } from 'expo-ai-kit';

if (!(await isAvailable())) {
  throw new Error('On-device generation is not supported on this device.');
}

// No-op when ready. Android may prepare its OS-managed ML Kit model first.
await prepareBuiltInModel();

const { text } = await sendMessage([
  { role: 'user', content: 'Explain local-first AI in one sentence.' },
]);

console.log(text);
```

`messages` is an array of `{ role: 'system' | 'user' | 'assistant'; content: string }`.
The current message APIs are stateless, so pass the complete history on every call.

### Stream a response

```tsx
import { streamMessage } from 'expo-ai-kit';

const { promise, stop } = streamMessage(
  [{ role: 'user', content: 'Write a very short story.' }],
  ({ token }) => console.log(token)
);

const response = await promise;
// Call stop() to cancel an active stream.
```

## Speech-to-text

On-device transcription — live from the microphone with revising (volatile) and finalized updates,
or batch from a recorded file. iOS uses Apple SpeechAnalyzer (iOS 26+); Android uses ML Kit GenAI
Speech Recognition (Android 12+, upgrading to Gemini Nano automatically on supported devices).
Availability, locale support, and model readiness are explicit so apps can handle unsupported
devices without falling back to a cloud service.

Speech is **opt-in** (it adds microphone permissions to the app): add
`["expo-ai-kit", { "speech": true }]` to your config plugins and make a new native build.

```tsx
import {
  getSpeechRecognitionAvailability,
  prepareSpeechRecognition,
  requestSpeechPermissionsAsync,
  streamTranscription,
  transcribe,
} from 'expo-ai-kit';

const availability = await getSpeechRecognitionAvailability({ locale: 'en-US' });
if (availability.status === 'downloadable') {
  await prepareSpeechRecognition({ locale: 'en-US' }); // OS-managed model download
}

// Live: updates carry the full transcript so far; isFinal marks committed segments.
await requestSpeechPermissionsAsync();
const { promise, stop } = streamTranscription((update) => setText(update.text));
// … later, when the user releases the button:
stop();
const { text } = await promise;

// Batch: transcribe a recording (WAV, M4A, MP3, …).
const result = await transcribe({ audio: { uri: recordingUri } });
// iOS: result.segments carries audio timestamps. Android: text only.
```

Platform notes:

- **Android transcribes files at real-time rate** (a 60-second file takes about a minute) — the
  engine's documented ingestion contract. Right for voice notes and dictation; use a cloud service
  for podcast-length audio. Android also requires the microphone permission even for file input
  (an engine requirement) and returns no segment timestamps.
- iOS batch transcription is faster than real time, returns timestamped segments, and needs no
  permission at all; only live listening uses the microphone.

## Choose your API

| Use | Import | Best for |
|---|---|---|
| Core primitives | `expo-ai-kit` | Direct control, no AI SDK dependency, explicit model lifecycle |
| Vercel AI SDK provider | `expo-ai-kit/ai` | Existing AI SDK code, provider portability, AI SDK orchestration |

Both routes use the same on-device models and core inference path.

## Structured output

Generate a typed object from a JSON Schema. expo-ai-kit prompts the model, extracts JSON,
validates it, and repairs invalid output within a bounded retry loop.

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
  }
);

console.log(object.title);
```

The default is two repair attempts. Keep schemas small and shallow for the most reliable
results from compact on-device models.

## Tool calling

Let the model select a tool, validate its arguments, run your function, and use its result
to answer. The loop is bounded by `maxSteps` (default 5).

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
  }
);
```

Omit `execute` to return the proposed call for human approval. Tool implementations remain
under your control and may use the network or other device capabilities when you choose.

## Embeddings and on-device RAG

Split a document, embed its chunks, retrieve the closest matches, and add them to the model's
context—all with small, dependency-free primitives.

```tsx
import { chunkText, createVectorStore, embed, sendMessage } from 'expo-ai-kit';

const chunks = chunkText(document);
const { embeddings } = await embed(chunks, { task: 'retrieval-document' });

const store = createVectorStore<{ text: string }>();
store.addMany(
  chunks.map((text, index) => ({
    id: `chunk-${index}`,
    vector: embeddings[index],
    metadata: { text },
  }))
);

const { embeddings: [query] } = await embed([question], { task: 'retrieval-query' });
const context = store
  .search(query, { topK: 4 })
  .map((result) => result.metadata?.text)
  .join('\n\n');

const { text } = await sendMessage([
  { role: 'system', content: `Answer using only this context:\n${context}` },
  { role: 'user', content: question },
]);
```

Use `'semantic-similarity'` (default), `'retrieval-query'`, or `'retrieval-document'` to
describe the embedding task.

### Embedding backends

- **iOS 17+:** Apple `NLContextualEmbedding`—zero-download, OS-maintained Latin, Cyrillic,
  and CJK script models. Select a model with `options.language`; call
  `getSupportedEmbeddingLanguages()` for the running device's authoritative list.
- **Android:** EmbeddingGemma 300M through MediaPipe TextEmbedder—768 dimensions,
  multilingual, CPU, and opt-in. Enable it in your app config and create a new native build:

```json
{
  "expo": {
    "plugins": [["expo-ai-kit", { "androidEmbeddings": true }]]
  }
}
```

Then prepare the model once before embedding:

```tsx
import { getEmbeddingModelStatus, prepareEmbeddingModel } from 'expo-ai-kit';

const { status } = await getEmbeddingModelStatus();
if (status !== 'downloaded') {
  await prepareEmbeddingModel({ onProgress: console.log });
}
```

Enabling Android embeddings adds approximately 25 MB to an arm64 APK. Its approximately
184 MB model is downloaded per app and verified with SHA-256. EmbeddingGemma uses the Gemma
Terms of Use.

### Model identity

Every embedding result includes `model: { id, revision }`. Persist that identity with an
index: vectors are compatible only when the complete model identity matches. Do not mix
vectors across platforms or iOS script models.

`chunkText`, `cosineSimilarity`, and `createVectorStore` are pure JavaScript and work with
any vector source. `embed()` can run alongside text generation.

## Vercel AI SDK

Install the AI SDK, then point `model` at the on-device provider:

```bash
npm install ai
```

expo-ai-kit currently supports AI SDK 6 and 7 through `LanguageModelV3`.

```tsx
import { embed, generateText, streamText } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';

const { text } = await generateText({
  model: expoAiKit(),
  prompt: 'Capital of France?',
});

const result = streamText({
  model: expoAiKit('gemma-e2b'),
  prompt: 'Write a short story.',
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}

const { embedding } = await embed({
  model: expoAiKit.embeddingModel(undefined, { task: 'retrieval-query' }),
  value: 'sunny day at the beach',
});
```

Tool calling and structured output reuse expo-ai-kit's core protocols. Speech-to-text is exposed
through the provider's transcription model. The AI SDK remains responsible for its own
orchestration around the provider.

<details>
<summary><strong>AI SDK behavior and React Native setup</strong></summary>

- Generation is single-flight; overlapping calls reject with `INFERENCE_BUSY`.
- Sampling is fixed when a model is activated, not per AI SDK call.
- Tool and JSON streams buffer until the complete structured envelope can be parsed.
- On-device runtimes do not currently report token usage.
- Image and file inputs are not supported.
- React Native may require the AI SDK's
  [Expo polyfills](https://ai-sdk.dev/docs/getting-started/expo#polyfills).

</details>

## Downloadable models

Choose from a size ladder of curated LiteRT-LM models or register your own.

| Model id | Parameters | Download | License |
|---|---:|---:|---|
| `qwen3-0.6b` | 0.6B | ~0.5 GB | Apache-2.0 |
| `qwen3-1.7b` | 1.7B | ~2.1 GB | Apache-2.0 |
| `gemma-e2b` | 2.3B | ~2.6 GB | Gemma |
| `qwen3-4b` | 4B | ~2.7 GB | Apache-2.0 |
| `gemma-e4b` | 4.5B | ~3.7 GB | Gemma |
| `phi-4-mini` | 3.8B | ~3.9 GB | MIT |

```tsx
import {
  downloadModel,
  getDownloadableModels,
  getRecommendedModel,
  setModel,
} from 'expo-ai-kit';

const models = await getDownloadableModels();
const best = await getRecommendedModel();

if (best) {
  await downloadModel(best.id, { onProgress: console.log });
  await setModel(best.id, { generation: { temperature: 0.7 } });
}
```

Check each model's license before distributing it to your users.

> **Android x86/x86_64:** LiteRT-LM downloadable models are disabled because its x86 backend
> can crash natively. Use a physical Android device or an arm64 emulator image. Built-in ML Kit
> is unaffected.

### Bring your own LiteRT-LM model

Register a compatible model at runtime. expo-ai-kit applies the same download, integrity,
status, and activation flow as the curated registry.

```tsx
import {
  downloadModel,
  fetchModelMetadata,
  registerModel,
  setModel,
} from 'expo-ai-kit';

const url =
  'https://huggingface.co/litert-community/Qwen3-4B/resolve/main/qwen3_4b_mixed_int4.litertlm';

// Dev time only: fetch once, then pin the returned values in your app.
// const { sha256, sizeBytes } = await fetchModelMetadata(url);

registerModel({
  id: 'qwen3-4b-custom',
  name: 'Qwen3 4B',
  parameterCount: '4B',
  quantization: 'int4',
  downloadUrl: url,
  sha256: 'f0794bc77efeaaf4f7af815f04c483b19b8f2ae4a102cef1b7b760a25848a18e',
  sizeBytes: 2_659_057_664,
  contextWindow: 4096,
  minRamBytes: 3_000_000_000,
  supportedPlatforms: ['ios', 'android'],
  license: 'Apache-2.0',
});

await downloadModel('qwen3-4b-custom');
await setModel('qwen3-4b-custom');
```

Custom registrations are in memory, so register them during app startup. Downloaded model
files remain on disk and recover their status after the same id is registered again.

## API overview

- **Inference:** `isAvailable`, `prepareBuiltInModel`, `sendMessage`, `streamMessage`,
  `generateObject`, `generateText`.
- **Embeddings and RAG:** `embed`, `getEmbeddingModelStatus`, `prepareEmbeddingModel`,
  `cancelEmbeddingModelDownload`, `deleteEmbeddingModel`, `getSupportedEmbeddingLanguages`,
  `chunkText`, `cosineSimilarity`, `createVectorStore`.
- **Speech-to-text:** `transcribe`, `streamTranscription`, `getSpeechRecognitionAvailability`,
  `prepareSpeechRecognition`, `getSupportedSpeechLocales`, `getSpeechPermissionsAsync`,
  `requestSpeechPermissionsAsync` — opt-in via the config plugin's `speech` flag.
- **Models:** `getBuiltInModels`, `getDownloadableModels`, `getDownloadedModels`,
  `getRecommendedModel`, `downloadModel`, `cancelDownload`, `deleteModel`, `setModel`,
  `unloadModel`, `getActiveModel`.
- **Custom models:** `registerModel`, `unregisterModel`, `getRegisteredModels`,
  `fetchModelMetadata`.
- **AI SDK provider:** `expoAiKit`, `createExpoAiKit` from `expo-ai-kit/ai`.

Failures throw `ModelError` with a typed `.code`. Full TypeScript definitions ship with the
package; see the [documentation](https://expo-ai-kit.dev) for the complete reference.

## Support and contributing

Created and maintained by [Said Kaban](https://github.com/saidkaban). Questions, bug reports,
feature requests, and pull requests are welcome in
[GitHub Issues](https://github.com/saidkaban/expo-ai-kit/issues).

## License

MIT © [Said Kaban](https://github.com/saidkaban)
