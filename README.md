# expo-ai-kit

On-device AI for Expo & React Native — run LLMs locally. No API keys, no cloud, no cost.

[![npm version](https://img.shields.io/npm/v/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Runs **Apple Foundation Models** (iOS 26+), **ML Kit** (Android), and downloadable
**Gemma 4** (E2B / E4B, iOS + Android via [LiteRT-LM](https://ai.google.dev/edge/litert-lm))
— with streaming, structured output, tool calling, cancellation, and runtime model switching,
all on-device.

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

## Downloadable Gemma 4

```tsx
import { getRecommendedModel, downloadModel, setModel } from 'expo-ai-kit';

const best = await getRecommendedModel();          // E4B on high-RAM phones, else E2B
if (best) {
  await downloadModel(best.id, { onProgress: (p) => console.log(p) });
  await setModel(best.id, { generation: { temperature: 0.7 } });
  // sendMessage / streamMessage / generateObject / generateText now use it; unloadModel() reverts to the OS model
}
```

## API

Inference: `isAvailable`, `sendMessage`, `streamMessage`, `generateObject`, `generateText`.
Models: `getBuiltInModels`, `getDownloadableModels`, `getRecommendedModel`,
`downloadModel`, `cancelDownload`, `deleteModel`, `setModel`, `unloadModel`, `getActiveModel`.

Failures throw `ModelError` with a typed `.code`. Full TypeScript definitions ship with
the package — see [the docs](https://expo-ai-kit.dev) for the complete reference.

## License

MIT
