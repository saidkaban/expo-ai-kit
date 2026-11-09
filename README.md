# expo-ai-kit

[![npm version](https://img.shields.io/npm/v/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![npm downloads](https://img.shields.io/npm/dm/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![license](https://img.shields.io/npm/l/expo-ai-kit.svg)](./LICENSE)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey.svg)

**On-device AI for React Native.** Local LLM, speech-to-text, vision, and embeddings for Expo
apps and React Native apps with Expo modules installed. No API keys, no cloud.

[Documentation](https://expo-ai-kit.dev) · [Examples](https://expo-ai-kit.dev/examples) ·
[npm](https://www.npmjs.com/package/expo-ai-kit) · [Changelog](./CHANGELOG.md)

- **Private and offline.** Inference runs on the device. Prompts, audio, and images never leave it.
- **No API key, no per-request cost.** Nothing to provision, meter, or proxy.
- **One TypeScript API for both platforms.** Apple Foundation Models, Speech, and Vision on iOS;
  ML Kit and MediaPipe on Android; LiteRT-LM for downloadable models such as Gemma.
- **Pay only for what you use.** Every feature is opt-in, so unused native code, models, and
  permissions never ship. Zero runtime JavaScript dependencies.

## Install

```bash
npx expo install expo-ai-kit
```

Turn on the features you use in your app config, then make a native build. Until you enable a
feature, none of its native code is compiled into your app. To use text generation:

```json
{
  "expo": {
    "plugins": [["expo-ai-kit", { "llm": true }]]
  }
}
```

Requires Expo SDK 54+ (or compatible Expo modules in an existing React Native app) and a
native development or production build. **Expo Go is not supported.** Follow
[Get Started](https://expo-ai-kit.dev/get-started) for native setup and a working app example.
Device and OS requirements vary by feature; see [platform support](https://expo-ai-kit.dev/guides/platform-support).

## First request

With `llm` enabled, on a device with a supported built-in text model:

```ts
import { isAvailable, prepareBuiltInModel, sendMessage } from 'expo-ai-kit';

async function ask(question: string) {
  if (!(await isAvailable())) {
    return 'The built-in text model is unavailable on this device.';
  }
  await prepareBuiltInModel();
  const { text } = await sendMessage([{ role: 'user', content: question }]);
  return text;
}

const answer = await ask('Explain gravity in one sentence.');
```

The built-in text model requires Apple Intelligence on iOS 26+ or a supported Android device.
Android may download its model during preparation. You can also
[download a model](https://expo-ai-kit.dev/guides/models) such as Gemma.

## LLM

[Generate and stream text](https://expo-ai-kit.dev/guides/llm),
[return structured JSON](https://expo-ai-kit.dev/guides/structured-output), or
[let the model call your functions](https://expo-ai-kit.dev/guides/tool-calling).
Stream tokens into your UI as they arrive:

```ts
import { streamMessage } from 'expo-ai-kit';

const { promise, stop } = streamMessage(
  [{ role: 'user', content: 'Write a haiku about the sea.' }],
  (event) => setText(event.accumulatedText)
);

await promise; // call stop() to cancel early
```

Pass the full message history on each call. One generation runs at a time. Enable the `llm`
option and rebuild.

## Speech

[Transcribe microphone audio or recorded files](https://expo-ai-kit.dev/guides/speech)
with `streamTranscription` and `transcribe`. Enable the `speech` plugin option and rebuild.
iOS requires 26+; Android requires 12+ and processes file audio at real-time rate.

## Vision

[Remove backgrounds, label images, and read text](https://expo-ai-kit.dev/guides/vision)
with `removeBackground`, `labelImage`, and `recognizeText`.
[Find faces](https://expo-ai-kit.dev/guides/face-detection) with `detectFaces`:

```ts
import { detectFaces } from 'expo-ai-kit';

const { width, height, faces } = await detectFaces({ uri: photo.uri });
// faces[0].bounds (normalized 0–1) and faces[0].pixelBounds, largest face first
```

Enable `vision` on Android and rebuild, or name only the features you use, for example
`{ "vision": ["face-detection"] }`, so the app ships only that detector. Face detection uses a
bundled model and needs no download.

## Embeddings

[Semantic search and retrieval](https://expo-ai-kit.dev/guides/embeddings) with
`embed`, `chunkText`, and `createVectorStore`. iOS uses the system embedding model;
Android requires the `androidEmbeddings` option and an explicit model download.

## Build options

Every option is off by default. Each one compiles a single feature into the app; leave it off
and that feature's native code, models, and permissions stay out of the build, and its functions
throw a typed `*_NOT_ENABLED` error. Changing an option requires a new native build.

| Option | Enables | Adds to the app |
| --- | --- | --- |
| `llm` | Text generation, JSON output, tool calling, model downloads, the AI SDK provider | LiteRT-LM runtime (about 30 MB of iOS arm64 code, 21 MB on Android); Android `minSdkVersion` 26 |
| `speech` | `transcribe`, `streamTranscription` | Android ML Kit speech and microphone permission; iOS microphone usage string |
| `vision` | Android `removeBackground`, `labelImage`, `recognizeText`, `detectFaces` | `true` adds every ML Kit vision client and bundled model; an array such as `["face-detection"]` adds only those features. iOS needs no option |
| `androidEmbeddings` | Android `embed` | MediaPipe TextEmbedder (about 25 MB); the model downloads at runtime |

The [config reference](https://expo-ai-kit.dev/api#config-plugin) covers bare React Native
setup and every option in detail.

## More

- [Vercel AI SDK](https://expo-ai-kit.dev/guides/vercel-ai-sdk): use `expo-ai-kit/ai` with the AI SDK.
- [API reference](https://expo-ai-kit.dev/api): functions, options, results, and typed errors.
- [Troubleshooting](https://expo-ai-kit.dev/troubleshooting) and [GitHub issues](https://github.com/saidkaban/expo-ai-kit/issues).
- [llms.txt](https://expo-ai-kit.dev/llms.txt): documentation index and essential contracts for coding agents.

MIT © [Said Kaban](https://github.com/saidkaban).
