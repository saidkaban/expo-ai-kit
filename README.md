# expo-ai-kit

On-device AI for Expo & React Native. Run LLMs locally — no API keys, no cloud, no cost.

[![npm version](https://img.shields.io/npm/v/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Run Google's **Gemma 4** (E2B / E4B), **Apple Foundation Models**, and **ML Kit**
entirely on-device — chat, streaming, and downloadable models, all local.

- **Private** — inference never leaves the device
- **Free** — no API costs, rate limits, or subscriptions
- **Native** — Apple Foundation Models (iOS 26+), ML Kit (Android), Gemma 4 via [LiteRT-LM](https://ai.google.dev/edge/litert-lm)
- **Streaming** — progressive token output with cancellation
- **Model management** — download, load, and switch Gemma 4 models at runtime

## Install

```bash
npx expo install expo-ai-kit
```

Bare React Native projects: run `npx pod-install` afterwards. Android needs
`minSdkVersion 26` — set it via `expo-build-properties` in `app.json`.

## Quick start

```tsx
import { isAvailable, sendMessage } from 'expo-ai-kit';

if (await isAvailable()) {
  const { text } = await sendMessage([
    { role: 'user', content: 'What is the capital of France?' },
  ]);
  console.log(text); // "Paris"
}
```

Add a system prompt, or include `system`/`assistant` messages for multi-turn context.
On-device models are stateless — pass the full message history on every call.

```tsx
const { text } = await sendMessage(
  [{ role: 'user', content: 'Tell me a joke' }],
  { systemPrompt: 'You are a stand-up comedian.' }
);
```

## Streaming

```tsx
import { streamMessage } from 'expo-ai-kit';

const { promise, stop } = streamMessage(
  [{ role: 'user', content: 'Write a short story' }],
  (event) => setText(event.accumulatedText), // fired per token
);

await promise; // resolves with the final { text }
// stop();     // cancel at any point
```

## Downloadable models (Gemma 4)

On Android, download and run Gemma 4 models on top of the built-in OS model.

```tsx
import {
  getDownloadableModels, downloadModel, setModel, sendMessage,
} from 'expo-ai-kit';

// List models with their on-device status
const models = await getDownloadableModels();

// Download with progress, then activate
await downloadModel('gemma-e2b', {
  onProgress: (p) => console.log(`${Math.round(p * 100)}%`),
});
await setModel('gemma-e2b', { backend: 'auto' }); // 'auto' | 'gpu' | 'cpu'

// sendMessage / streamMessage now use the active model
const { text } = await sendMessage([{ role: 'user', content: 'Hi!' }]);
```

`unloadModel()` frees memory and reverts to the OS model; `deleteModel(id)` removes the file.

| Model | Params | Size | Platforms |
|-------|--------|------|-----------|
| `gemma-e2b` | 2.3B | ~2.6 GB | Android |
| `gemma-e4b` | 4.5B | ~3.7 GB | Android |

> iOS downloadable models are planned, pending LiteRT-LM Swift APIs from Google.

## Platform support

| Platform | Engine | Models |
|----------|--------|--------|
| iOS 26+ | [Apple Foundation Models](https://developer.apple.com/documentation/FoundationModels) | Built-in |
| Android ([supported devices](https://developers.google.com/ml-kit/genai#prompt-device)) | [ML Kit Prompt API](https://developers.google.com/ml-kit/genai#prompt-device) | Built-in + downloadable Gemma 4 |
| iOS < 26 / unsupported Android | — | `isAvailable()` returns `false` |

Requires Expo SDK 54+.

## API

**Inference**

- `isAvailable()` → `Promise<boolean>`
- `sendMessage(messages, options?)` → `Promise<{ text }>`
- `streamMessage(messages, onToken, options?)` → `{ promise, stop }`

**Models**

- `getBuiltInModels()` → `Promise<BuiltInModel[]>`
- `getDownloadableModels()` → `Promise<DownloadableModel[]>`
- `downloadModel(id, { onProgress? })` / `deleteModel(id)`
- `setModel(id, { backend? })` / `unloadModel()` / `getActiveModel()`

`messages` is `{ role: 'system' | 'user' | 'assistant'; content: string }[]` and
`options` accepts `{ systemPrompt?: string }`. Model operations throw `ModelError`
with a `.code` (e.g. `MODEL_NOT_FOUND`, `DOWNLOAD_CORRUPT`, `INFERENCE_OOM`).
Full TypeScript definitions ship with the package.

## Links

- [Docs](https://expo-ai-kit.dev) · [npm](https://www.npmjs.com/package/expo-ai-kit) · [GitHub](https://github.com/saidkaban/expo-ai-kit) · [Issues](https://github.com/saidkaban/expo-ai-kit/issues)
- [Apple Foundation Models](https://developer.apple.com/documentation/foundationmodels) · [ML Kit GenAI](https://developers.google.com/ml-kit/genai) · [LiteRT-LM](https://ai.google.dev/edge/litert-lm)

## License

MIT
