# expo-ai-kit

On-device AI for Expo & React Native — run LLMs locally. No API keys, no cloud, no cost.

[![npm version](https://img.shields.io/npm/v/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Runs **Apple Foundation Models** (iOS 26+), **ML Kit** (Android), and downloadable
**Gemma 4** (E2B / E4B, iOS + Android via [LiteRT-LM](https://ai.google.dev/edge/litert-lm))
— with streaming, structured output, cancellation, and runtime model switching, all on-device.

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

## Downloadable Gemma 4

```tsx
import { getRecommendedModel, downloadModel, setModel } from 'expo-ai-kit';

const best = await getRecommendedModel();          // E4B on high-RAM phones, else E2B
if (best) {
  await downloadModel(best.id, { onProgress: (p) => console.log(p) });
  await setModel(best.id, { generation: { temperature: 0.7 } });
  // sendMessage / streamMessage / generateObject now use it; unloadModel() reverts to the OS model
}
```

## API

Inference: `isAvailable`, `sendMessage`, `streamMessage`, `generateObject`.
Models: `getBuiltInModels`, `getDownloadableModels`, `getRecommendedModel`,
`downloadModel`, `cancelDownload`, `deleteModel`, `setModel`, `unloadModel`, `getActiveModel`.

Failures throw `ModelError` with a typed `.code`. Full TypeScript definitions ship with
the package — see [the docs](https://expo-ai-kit.dev) for the complete reference.

## License

MIT
