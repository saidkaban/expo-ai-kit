import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "API Reference",
  "Complete expo-ai-kit API reference, grouped by capability: text generation, speech-to-text, vision, embeddings, models, the AI SDK provider, the config plugin, types, and errors.",
  "/api"
);

const headings = [
  { id: "text", text: "Text", level: 2 },
  { id: "isavailable", text: "isAvailable()", level: 3 },
  { id: "preparebuiltinmodel", text: "prepareBuiltInModel()", level: 3 },
  { id: "sendmessage", text: "sendMessage()", level: 3 },
  { id: "streammessage", text: "streamMessage()", level: 3 },
  { id: "generateobject", text: "generateObject()", level: 3 },
  { id: "generatetext", text: "generateText()", level: 3 },
  { id: "stripthinking", text: "stripThinking()", level: 3 },
  { id: "speech-to-text", text: "Speech", level: 2 },
  { id: "vision", text: "Vision", level: 2 },
  { id: "removebackground", text: "removeBackground()", level: 3 },
  { id: "labelimage", text: "labelImage()", level: 3 },
  { id: "recognizetext", text: "recognizeText()", level: 3 },
  { id: "vision-lifecycle", text: "Vision lifecycle", level: 3 },
  { id: "embeddings", text: "Embeddings", level: 2 },
  { id: "embed", text: "embed()", level: 3 },
  { id: "embedding-lifecycle", text: "Embedding model lifecycle", level: 3 },
  { id: "rag-toolkit", text: "Retrieval toolkit", level: 3 },
  { id: "model-management", text: "Models", level: 2 },
  { id: "getbuiltinmodels", text: "getBuiltInModels()", level: 3 },
  { id: "getdownloadablemodels", text: "getDownloadableModels()", level: 3 },
  { id: "getdownloadedmodels", text: "getDownloadedModels()", level: 3 },
  { id: "getrecommendedmodel", text: "getRecommendedModel()", level: 3 },
  { id: "downloadmodel", text: "downloadModel()", level: 3 },
  { id: "canceldownload", text: "cancelDownload()", level: 3 },
  { id: "deletemodel", text: "deleteModel()", level: 3 },
  { id: "setmodel", text: "setModel()", level: 3 },
  { id: "unloadmodel", text: "unloadModel()", level: 3 },
  { id: "getactivemodel", text: "getActiveModel()", level: 3 },
  { id: "custom-models", text: "Custom Models", level: 3 },
  { id: "ai-sdk-provider", text: "AI SDK Provider", level: 2 },
  { id: "config-plugin", text: "Config Plugin", level: 2 },
  { id: "types", text: "Types", level: 2 },
  { id: "errors", text: "Errors", level: 2 },
];

export default function APIReferencePage() {
  return (
    <DocsLayout headings={headings}>
      <h1>API Reference</h1>
      <p className="text-xl text-muted leading-relaxed">
        The complete public API of expo-ai-kit, grouped by capability, Text,
        Speech, Vision, Embeddings, then models, the AI SDK provider, the config
        plugin, types, and errors. Everything runs on-device, on both iOS and
        Android.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <p>
        Messages everywhere use the same shape:{" "}
        <code>{`{ role: 'system' | 'user' | 'assistant'; content: string }`}</code>
        . On-device models are stateless, pass the full conversation history on
        every call.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2 id="text">Text</h2>
      <p>
        Generate and stream text with the OS model or a downloaded one, get
        typed objects back, or let the model call your functions. Text needs no
        configuration. See the{" "}
        <a href="/guides/text-generation" className="text-accent hover:underline">
          Text Generation guide
        </a>
        .
      </p>

      <h3 id="isavailable">isAvailable()</h3>
      <p>
        Check whether the current device supports its built-in on-device model.
        Returns <code>false</code> on unsupported platforms and devices. On
        Android, <code>true</code> means ML Kit is supported even when its
        OS-managed model still needs to download.
      </p>
      <CodeBlock language="typescript">
        {`function isAvailable(): Promise<boolean>`}
      </CodeBlock>
      <CodeBlock language="typescript">
        {`import { isAvailable } from 'expo-ai-kit';

if (await isAvailable()) {
  await prepareBuiltInModel();
}`}
      </CodeBlock>

      <Callout type="info" title="Availability is not preparation">
        <p>
          Call <code>isAvailable()</code> to decide whether to show the feature.
          Await <code>prepareBuiltInModel()</code> before inference so Android
          can finish its first-use model download.
        </p>
      </Callout>

      {/* ------------------------------------------------------------------ */}
      <h3 id="preparebuiltinmodel">prepareBuiltInModel()</h3>
      <p>
        Make the platform&apos;s built-in generation model ready. Android downloads
        the AICore-managed ML Kit model when needed. iOS validates Apple
        Foundation Models availability. Repeated calls are safe and resolve
        immediately when the model is already ready.
      </p>
      <CodeBlock language="typescript">
        {`function prepareBuiltInModel(): Promise<void>`}
      </CodeBlock>
      <CodeBlock language="typescript">
        {`import { isAvailable, prepareBuiltInModel } from 'expo-ai-kit';

if (!(await isAvailable())) {
  throw new Error('On-device AI is not supported on this device');
}

await prepareBuiltInModel();`}
      </CodeBlock>
      <p>
        Throws <code>DEVICE_NOT_SUPPORTED</code> when the built-in model cannot
        run and <code>DOWNLOAD_FAILED</code> if Android cannot prepare its model.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h3 id="sendmessage">sendMessage()</h3>
      <p>Send a conversation and get a single response.</p>
      <CodeBlock language="typescript">
        {`function sendMessage(
  messages: LLMMessage[],
  options?: LLMSendOptions,
): Promise<LLMResponse>`}
      </CodeBlock>
      <p>
        <strong>Options:</strong> <code>systemPrompt?: string</code> (used only
        if the array has no system message), <code>signal?: AbortSignal</code>.
      </p>
      <CodeBlock language="typescript">
        {`import { sendMessage } from 'expo-ai-kit';

const { text } = await sendMessage(
  [{ role: 'user', content: 'Capital of France?' }],
  { systemPrompt: 'Answer in one word.' },
);`}
      </CodeBlock>
      <Callout type="info" title="Cancellation">
        <p>
          On-device, non-streaming generation can&apos;t always be interrupted
          mid-decode, <code>signal</code> always unblocks the caller, but the
          model may keep running in the background (a new call throws{" "}
          <code>INFERENCE_BUSY</code> until it finishes). To truly interrupt, use{" "}
          <code>streamMessage().stop()</code>.
        </p>
      </Callout>

      {/* ------------------------------------------------------------------ */}
      <h3 id="streammessage">streamMessage()</h3>
      <p>
        Stream a response token-by-token. Returns a handle with a{" "}
        <code>promise</code> that resolves with the final text and a{" "}
        <code>stop()</code> to cancel.
      </p>
      <CodeBlock language="typescript">
        {`function streamMessage(
  messages: LLMMessage[],
  onToken: (event: LLMStreamEvent) => void,
  options?: LLMStreamOptions,
): LLMStreamHandle // { promise, stop }`}
      </CodeBlock>
      <CodeBlock language="typescript">
        {`import { streamMessage } from 'expo-ai-kit';

const { promise, stop } = streamMessage(
  [{ role: 'user', content: 'Write a short story' }],
  (event) => {
    setText(event.accumulatedText); // event.token, event.isDone also available
  },
);

await promise; // resolves with { text }; call stop() to cancel early`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h3 id="generateobject">generateObject()</h3>
      <p>
        Get a typed object validated against a JSON Schema. See the{" "}
        <a href="/guides/structured-output" className="text-accent hover:underline">
          Structured Output guide
        </a>{" "}
        for the full story.
      </p>
      <CodeBlock language="typescript">
        {`function generateObject<T = unknown>(
  messages: LLMMessage[],
  schema: JSONSchema,
  options?: GenerateObjectOptions,
): Promise<GenerateObjectResult<T>> // { object, text }`}
      </CodeBlock>
      <p>
        <strong>Options:</strong> <code>systemPrompt?</code>,{" "}
        <code>signal?</code>, <code>maxRepairAttempts?</code> (default{" "}
        <code>2</code>). Throws <code>INFERENCE_FAILED</code> if no schema-valid
        JSON is produced after the repair attempts.
      </p>
      <CodeBlock language="typescript">
        {`import { generateObject } from 'expo-ai-kit';

const { object } = await generateObject<{ title: string; minutes: number }>(
  [{ role: 'user', content: 'A quick weeknight pasta.' }],
  {
    type: 'object',
    properties: { title: { type: 'string' }, minutes: { type: 'integer' } },
    required: ['title', 'minutes'],
  },
);`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h3 id="generatetext">generateText()</h3>
      <p>
        Generate text, optionally letting the model call tools you provide. See
        the{" "}
        <a href="/guides/tool-calling" className="text-accent hover:underline">
          Tool Calling guide
        </a>
        .
      </p>
      <CodeBlock language="typescript">
        {`function generateText(
  messages: LLMMessage[],
  options?: GenerateTextOptions,
): Promise<GenerateTextResult>
// { text, steps, toolCalls, toolResults, finishReason }`}
      </CodeBlock>
      <p>
        <strong>Options:</strong> <code>tools?: ToolSet</code>,{" "}
        <code>maxSteps?</code> (default <code>5</code>),{" "}
        <code>systemPrompt?</code>, <code>signal?</code>,{" "}
        <code>maxRepairAttempts?</code> (default <code>2</code>).
      </p>
      <CodeBlock language="typescript">
        {`import { generateText } from 'expo-ai-kit';

const { text } = await generateText(
  [{ role: 'user', content: 'Weather in Paris?' }],
  {
    tools: {
      getWeather: {
        description: 'Get current weather for a city.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
        execute: async ({ city }: { city: string }) => fetchWeather(city),
      },
    },
  },
);`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h3 id="stripthinking">stripThinking()</h3>
      <p>
        Pure helper that splits <code>&lt;think&gt;…&lt;/think&gt;</code>{" "}
        reasoning (Qwen3-style models) from the answer. <code>generateObject</code>{" "}
        and <code>generateText</code> apply it internally.
      </p>
      <CodeBlock language="typescript">
        {`function stripThinking(text: string): { text: string; reasoning: string }`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h2 id="speech-to-text">Speech</h2>
      <BadgeGroup platforms={["ios", "android", "new"]} />
      <p>
        On-device transcription, live microphone streaming and audio-file
        transcripts. Opt-in via the config plugin&apos;s <code>speech</code>{" "}
        flag; runs its own single-flight (<code>SPEECH_BUSY</code>),
        independent of text generation. See the{" "}
        <a href="/guides/speech" className="text-accent hover:underline">
          Speech-to-Text guide
        </a>{" "}
        for platform behavior and examples.
      </p>
      <CodeBlock language="typescript">
        {`function transcribe(options: {
  audio: { uri: string } | { base64: string; mediaType?: string };
  locale?: string;        // BCP-47; defaults to the device locale
  signal?: AbortSignal;
}): Promise<{
  text: string;
  segments: { text: string; startSeconds: number; endSeconds: number }[]; // iOS; [] on Android
  language?: string;
  durationSeconds?: number;
}>

function streamTranscription(
  onUpdate: (update: { text: string; isFinal: boolean }) => void,
  options?: { locale?: string }
): { promise: Promise<TranscribeResult>; stop: () => void }

function getSpeechRecognitionAvailability(options?: { locale?: string }): Promise<
  | { status: 'available' }
  | { status: 'downloadable' | 'downloading' }
  | { status: 'unavailable';
      reason: 'platform' | 'os-version' | 'device' | 'locale' | 'not-enabled' }
>
function prepareSpeechRecognition(options?: {
  locale?: string;
  onProgress?: (progress: number) => void; // 0–1
}): Promise<void>
function getSupportedSpeechLocales(): Promise<string[]>
function getSpeechPermissionsAsync(): Promise<SpeechPermissionResponse>
function requestSpeechPermissionsAsync(): Promise<SpeechPermissionResponse>`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h2 id="vision">Vision</h2>
      <BadgeGroup platforms={["ios", "android", "new"]} />
      <p>
        Background removal, image labels, and text recognition (OCR) with Apple
        Vision on iOS and ML Kit on Android. Android is opt-in via the config
        plugin&apos;s <code>vision</code> flag; iOS needs nothing. Independent of
        the text and speech guards. Every call takes an image as{" "}
        <code>{`{ uri }`}</code> (a <code>file://</code> URI or path). See the{" "}
        <a href="/guides/vision" className="text-accent hover:underline">
          Vision guide
        </a>
        .
      </p>

      <h3 id="removebackground">removeBackground()</h3>
      <p>
        Cut the subject out of a photo. The cutout is written to the app cache
        and returned as a <code>file://</code> URI (PNG with transparency by
        default), together with where the subject sits in the source image.
        Coordinates are normalized (origin top-left, 0–1) unless named
        <code>pixel…</code>.
      </p>
      <CodeBlock language="typescript">
        {`function removeBackground(
  image: { uri: string },
  options?: {
    subject?: NormalizedPoint;   // keep only the subject under this point (default: all)
    mask?: boolean;              // also write the grayscale mask PNG (default false)
    trim?: boolean;              // crop to the subject (default true)
    format?: 'png' | 'jpeg';     // default 'png'; JPEG flattens onto white
    quality?: number;            // JPEG quality 0–1 (default 0.9)
    maxPixels?: number;          // decode budget (default 6_000_000, max 25_000_000)
  },
): Promise<{
  uri: string;
  maskUri?: string;              // when mask: true
  width: number; height: number;
  sourceWidth: number; sourceHeight: number;
  bounds: NormalizedRect; pixelBounds: PixelRect;
  foregroundCoverage: number; centroid: NormalizedPoint;
  instanceCount: number; trimOrigin: NormalizedPoint;
}>`}
      </CodeBlock>
      <p>
        iOS 17+ on a physical device; Android with Google Play services after{" "}
        <code>prepareVision()</code>. Throws <code>NO_SUBJECT_FOUND</code> when
        the image has no foreground subject.
      </p>

      <h3 id="labelimage">labelImage()</h3>
      <p>
        Ranked labels describing the image, highest confidence first. iOS
        needs a physical device (the Simulator cannot run Vision&apos;s
        classifier); Android&apos;s model is bundled with the app. Label
        vocabularies differ per platform (Vision identifiers such as{" "}
        <code>consumer_electronics</code>, ML Kit words such as{" "}
        <code>Dog</code>).
      </p>
      <CodeBlock language="typescript">
        {`function labelImage(
  image: { uri: string },
  options?: { maxResults?: number; minConfidence?: number }, // defaults 10 (0 = all), 0.5
): Promise<{ label: string; confidence: number }[]>`}
      </CodeBlock>

      <h3 id="recognizetext">recognizeText()</h3>
      <p>
        Read the text in an image, with normalized bounds for every block and
        line. <code>languages</code> selects Android&apos;s script models (Latin,
        Chinese, Japanese, Korean, Devanagari); iOS auto-detects when omitted.
        <code>recognitionLevel</code>, <code>usesLanguageCorrection</code>, and{" "}
        <code>customWords</code> are iOS-only.
      </p>
      <CodeBlock language="typescript">
        {`function recognizeText(
  image: { uri: string },
  options?: {
    languages?: string[];                    // BCP-47, priority order
    minTextHeight?: number;                  // fraction of image height, 0–1
    recognitionLevel?: 'accurate' | 'fast';  // iOS
    usesLanguageCorrection?: boolean;        // iOS, default true
    customWords?: string[];                  // iOS
  },
): Promise<{
  text: string;
  blocks: {
    text: string; bounds: NormalizedRect; language?: string; cornerPoints?: NormalizedPoint[];
    lines: { text: string; bounds: NormalizedRect; confidence?: number; language?: string; cornerPoints?: NormalizedPoint[] }[];
  }[];
}>`}
      </CodeBlock>

      <h3 id="vision-lifecycle">Vision lifecycle</h3>
      <p>
        Per-feature availability and the one call that downloads. Android&apos;s
        segmentation and OCR models are Google Play services modules installed
        by <code>prepareVision()</code>; the label model is bundled; iOS ships
        everything with the OS and resolves immediately.
      </p>
      <CodeBlock language="typescript">
        {`function getVisionAvailability(): Promise<{
  backgroundRemoval: VisionFeatureAvailability;
  imageLabeling: VisionFeatureAvailability;
  textRecognition: VisionFeatureAvailability;
}>
// VisionFeatureAvailability =
//   | { status: 'available' }
//   | { status: 'downloadable' | 'downloading' }
//   | { status: 'unavailable'; reason: 'platform' | 'os-version' | 'device' | 'not-enabled' }

function prepareVision(options?: {
  features?: ('background-removal' | 'image-labeling' | 'text-recognition')[]; // default: all
  languages?: string[];                      // OCR script models to fetch (Android)
  onProgress?: (progress: number) => void;   // 0–1
}): Promise<void>

function getSupportedTextRecognitionLanguages(): Promise<string[]>`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h2 id="embeddings">Embeddings</h2>
      <p>
        Turn text into vectors for semantic search and retrieval, then search
        them with dependency-free helpers. See the{" "}
        <a href="/guides/embeddings" className="text-accent hover:underline">
          Embeddings guide
        </a>
        .
      </p>

      <h3 id="embed">embed()</h3>
      <BadgeGroup platforms={["ios", "android", "new"]} />
      <p>
        Turn text into embedding vectors for semantic search and retrieval. See the{" "}
        <a href="/guides/embeddings" className="text-accent hover:underline">
          Embeddings guide
        </a>
        . iOS (17+): Apple&apos;s zero-download <code>NLContextualEmbedding</code>:
        <code>language</code> selects the script model. Android: EmbeddingGemma
        300M via MediaPipe TextEmbedder, opt-in via the{" "}
        <code>androidEmbeddings</code> config-plugin flag, model prepared with{" "}
        <code>prepareEmbeddingModel()</code>; <code>embed()</code> itself never
        downloads.
      </p>
      <CodeBlock language="typescript">
        {`function embed(
  texts: string[],
  options?: {
    task?: 'semantic-similarity' | 'retrieval-query' | 'retrieval-document';
    language?: string; // BCP-47, default 'en', selects the iOS script model; ignored on Android
  },
): Promise<EmbedResult>
// { embeddings: number[][]; dimensions: number; model: { id: string; revision: string } }`}
      </CodeBlock>
      <CodeBlock language="typescript">
        {`import { embed } from 'expo-ai-kit';

const { embeddings, dimensions, model } = await embed(
  ['hello world', 'goodbye'],
  { task: 'retrieval-document' },
);
embeddings.length; // 2, one vector per input, in order
model;             // identity, indexes are only comparable under identical identity`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h3 id="embedding-lifecycle">Embedding model lifecycle</h3>
      <BadgeGroup platforms={["ios", "android", "new"]} />
      <p>
        Readiness and asset management for the embedding model.{" "}
        <code>prepareEmbeddingModel()</code> is the <em>only</em> call that
        downloads, on Android it fetches the ~184 MB EmbeddingGemma bundle
        (SHA-256-verified, atomic install, fails closed on partial/corrupt
        downloads); on iOS it prefetches the OS-managed assets for a language.
        Cancel/delete are Android-side (safe no-ops on iOS).
      </p>
      <CodeBlock language="typescript">
        {`function getEmbeddingModelStatus(options?: { language?: string }): Promise<{
  status: 'not-downloaded' | 'downloading' | 'downloaded';
  sizeBytes: number; // ~184 MB pinned on Android; 0 on iOS (OS-managed)
  model: { id: string; revision: string };
}>
function prepareEmbeddingModel(options?: {
  language?: string;
  onProgress?: (progress: number) => void; // 0–1 (Android)
}): Promise<void>
function cancelEmbeddingModelDownload(): Promise<void>
function deleteEmbeddingModel(): Promise<void>
function getSupportedEmbeddingLanguages(): Promise<string[]> // iOS catalog; [] on Android`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h3 id="rag-toolkit">Retrieval toolkit</h3>
      <BadgeGroup platforms={["ios", "android"]} />
      <p>
        Pure-JS helpers for retrieval. They work on every platform with any source
        of vectors, since they only deal in plain <code>number[]</code>.
      </p>

      <h4 id="chunktext">chunkText()</h4>
      <p>
        Split a document into overlapping, sentence-aware chunks sized for
        embedding.
      </p>
      <CodeBlock language="typescript">
        {`function chunkText(
  text: string,
  options?: { chunkSize?: number; overlap?: number }, // defaults: 1000, min(200, chunkSize / 5)
): string[]`}
      </CodeBlock>

      <h4 id="cosinesimilarity">cosineSimilarity()</h4>
      <p>
        Magnitude-invariant relevance score in <code>[-1, 1]</code>. Throws on a
        length mismatch.
      </p>
      <CodeBlock language="typescript">
        {`function cosineSimilarity(a: number[], b: number[]): number`}
      </CodeBlock>

      <h4 id="createvectorstore">createVectorStore()</h4>
      <p>
        A lightweight in-memory vector store. Add records, then{" "}
        <code>search()</code> by a query vector for the top-k most similar.
        Snapshot with <code>toJSON()</code> and rehydrate by passing it back in.
      </p>
      <CodeBlock language="typescript">
        {`function createVectorStore<M = unknown>(
  initial?: VectorRecord<M>[],
): VectorStore<M>

// VectorStore<M>:
//   add(id, vector, metadata?) · addMany(records) · get(id) · remove(id)
//   clear() · size · toJSON()
//   search(query, { topK = 10, minScore? }): VectorSearchResult<M>[]`}
      </CodeBlock>
      <CodeBlock language="typescript">
        {`import { createVectorStore } from 'expo-ai-kit';

const store = createVectorStore<{ text: string }>();
store.addMany(chunks.map((text, i) => ({ id: \`c\${i}\`, vector: embeddings[i], metadata: { text } })));

const hits = store.search(queryVector, { topK: 4 });
// → [{ id, vector, metadata, score }, …] sorted by score, highest first`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h2 id="model-management">Models</h2>
      <p>
        Switch between the OS built-in models and downloadable ones. See the{" "}
        <a href="/guides/models" className="text-accent hover:underline">
          Models guide
        </a>{" "}
        for a walkthrough.
      </p>

      <h3 id="getbuiltinmodels">getBuiltInModels()</h3>
      <p>List the OS built-in models (Apple FM on iOS, ML Kit on Android).</p>
      <CodeBlock language="typescript">
        {`function getBuiltInModels(): Promise<BuiltInModel[]>`}
      </CodeBlock>

      <h3 id="getdownloadablemodels">getDownloadableModels()</h3>
      <p>
        The full downloadable catalog (built-in registry + any{" "}
        <code>registerModel()</code> entries), enriched with per-device status,
        size, license, and <code>meetsRequirements</code>.
      </p>
      <CodeBlock language="typescript">
        {`function getDownloadableModels(): Promise<DownloadableModel[]>`}
      </CodeBlock>

      <h3 id="getdownloadedmodels">getDownloadedModels()</h3>
      <p>
        Return only downloadable models already present on the device, including
        models currently loading or ready for inference.
      </p>
      <CodeBlock language="typescript">
        {`function getDownloadedModels(): Promise<DownloadableModel[]>`}
      </CodeBlock>

      <h3 id="getrecommendedmodel">getRecommendedModel()</h3>
      <p>
        The most capable model the current device can actually run, or{" "}
        <code>null</code>.
      </p>
      <CodeBlock language="typescript">
        {`function getRecommendedModel(): Promise<DownloadableModel | null>`}
      </CodeBlock>

      <h3 id="downloadmodel">downloadModel()</h3>
      <p>
        Download a model with integrity verification (SHA256). Reports progress{" "}
        <code>0–1</code>.
      </p>
      <CodeBlock language="typescript">
        {`function downloadModel(
  modelId: string,
  options?: { onProgress?: (progress: number) => void },
): Promise<void>`}
      </CodeBlock>

      <h3 id="canceldownload">cancelDownload()</h3>
      <p>
        Cancel an in-flight download; the <code>downloadModel</code> promise
        rejects with <code>DOWNLOAD_CANCELLED</code>.
      </p>
      <CodeBlock language="typescript">
        {`function cancelDownload(modelId: string): Promise<void>`}
      </CodeBlock>

      <h3 id="deletemodel">deleteModel()</h3>
      <p>Delete a downloaded model file from disk (unloads it first if active).</p>
      <CodeBlock language="typescript">
        {`function deleteModel(modelId: string): Promise<void>`}
      </CodeBlock>

      <h3 id="setmodel">setModel()</h3>
      <p>
        Activate a model for inference, the sole gatekeeper of model validity.
        For downloadable models this loads weights into memory; only one is
        loaded at a time.
      </p>
      <CodeBlock language="typescript">
        {`function setModel(modelId: string, options?: SetModelOptions): Promise<void>
// SetModelOptions: { backend?: 'auto' | 'gpu' | 'cpu'; generation?: GenerationConfig }`}
      </CodeBlock>
      <CodeBlock language="typescript">
        {`await setModel('qwen3-1.7b', { generation: { temperature: 0.7, topK: 40 } });`}
      </CodeBlock>

      <h3 id="unloadmodel">unloadModel()</h3>
      <p>Unload the current downloadable model and revert to the OS built-in.</p>
      <CodeBlock language="typescript">
        {`function unloadModel(): Promise<void>`}
      </CodeBlock>

      <h3 id="getactivemodel">getActiveModel()</h3>
      <p>The id of the currently active model (e.g. <code>&apos;apple-fm&apos;</code>).</p>
      <CodeBlock language="typescript">
        {`function getActiveModel(): string`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h3 id="custom-models">Custom Models</h3>
      <p>
        Register any LiteRT-LM model at runtime. See{" "}
        <a href="/guides/models#bring-your-own-model" className="text-accent hover:underline">
          Bring Your Own Model
        </a>
        .
      </p>

      <h4 id="registermodel">registerModel()</h4>
      <p>
        Add a custom downloadable model. Validates the entry and rejects ids that
        collide with a built-in (curated or native) model.
      </p>
      <CodeBlock language="typescript">
        {`function registerModel(entry: ModelRegistryEntry): void`}
      </CodeBlock>

      <h4 id="unregistermodel">unregisterModel()</h4>
      <p>
        Remove a custom model (returns <code>true</code> if one was removed).
        Does not delete any downloaded file.
      </p>
      <CodeBlock language="typescript">
        {`function unregisterModel(modelId: string): boolean`}
      </CodeBlock>

      <h4 id="getregisteredmodels">getRegisteredModels()</h4>
      <p>All custom models registered this session.</p>
      <CodeBlock language="typescript">
        {`function getRegisteredModels(): ModelRegistryEntry[]`}
      </CodeBlock>

      <h4 id="fetchmodelmetadata">fetchModelMetadata()</h4>
      <p>
        Look up a model file&apos;s <code>sha256</code> and{" "}
        <code>sizeBytes</code> from a HuggingFace resolve URL, to fill in a{" "}
        <code>registerModel()</code> entry.
      </p>
      <CodeBlock language="typescript">
        {`function fetchModelMetadata(
  downloadUrl: string,
): Promise<{ sha256: string; sizeBytes: number }>`}
      </CodeBlock>
      <Callout type="info" title="Pin the hash">
        <p>
          Run this once at dev time and hardcode the returned <code>sha256</code>
          . Fetching it at runtime only catches transit corruption, not a changed
          upstream repo.
        </p>
      </Callout>

      {/* ------------------------------------------------------------------ */}
      <h2 id="ai-sdk-provider">AI SDK Provider</h2>
      <BadgeGroup platforms={["ios", "android", "new"]} />
      <p>
        A Vercel AI SDK provider (<code>LanguageModelV3</code>, AI SDK 6+) over
        the on-device engine, exported from the <code>expo-ai-kit/ai</code>{" "}
        subpath. See the{" "}
        <a href="/guides/vercel-ai-sdk" className="text-accent hover:underline">
          Vercel AI SDK guide
        </a>{" "}
        for setup (polyfills), examples, and the on-device caveats.
      </p>
      <CodeBlock language="typescript">
        {`import { expoAiKit, createExpoAiKit } from 'expo-ai-kit/ai';

// LanguageModelV3, pass to generateText / streamText / generateObject
expoAiKit(modelId?: string, settings?: ExpoAiKitModelSettings): LanguageModelV3
//   modelId: 'auto' (default, the active model) or any setModel() id
//   settings: same shape as setModel() options; applied on activation

// EmbeddingModelV3 over embed(), resolves the platform default
// ('apple-nl-contextual' on iOS, 'embedding-gemma-300m' on Android)
expoAiKit.embeddingModel(modelId?: string, settings?: { task?: EmbeddingTask; language?: string }): EmbeddingModelV3

// Factory (a fresh provider instance)
createExpoAiKit(): ExpoAiKitProvider`}
      </CodeBlock>
      <CodeBlock language="typescript">
        {`import { generateText } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';

const { text } = await generateText({
  model: expoAiKit(),
  prompt: 'Capital of France?',
});`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h2 id="config-plugin">Config Plugin</h2>
      <p>
        Text works with no configuration. Speech, vision (Android), and Android
        embeddings are opt-in build flags so apps that don&apos;t use them pay
        nothing in size or permissions. Turning a flag on requires a new native
        build (dev client / EAS, not an OTA update); without it the matching
        APIs throw a typed <code>*_NOT_ENABLED</code> error.
      </p>
      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [
      ["expo-ai-kit", {
        "speech": true,             // or { "microphonePermission": "…" }
        "vision": true,
        "androidEmbeddings": true
      }]
    ]
  }
}`}
      </CodeBlock>
      <table>
        <thead>
          <tr>
            <th>Flag</th>
            <th>Unlocks</th>
            <th>What it adds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>speech</code></td>
            <td><code>transcribe</code>, <code>streamTranscription</code>, speech lifecycle</td>
            <td>Android ML Kit speech backend + <code>RECORD_AUDIO</code>; iOS <code>NSMicrophoneUsageDescription</code></td>
          </tr>
          <tr>
            <td><code>vision</code></td>
            <td>Android <code>removeBackground</code>, <code>labelImage</code>, <code>recognizeText</code></td>
            <td>ML Kit vision clients + bundled label model (no permissions). iOS needs no flag.</td>
          </tr>
          <tr>
            <td><code>androidEmbeddings</code></td>
            <td>Android <code>embed</code> and the embedding lifecycle</td>
            <td>MediaPipe TextEmbedder (~25 MB APK); the ~184 MB model downloads at runtime</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2 id="types">Types</h2>
      <CodeBlock language="typescript">
        {`type LLMRole = 'system' | 'user' | 'assistant';
type LLMMessage = { role: LLMRole; content: string };
type LLMResponse = { text: string };

type LLMSendOptions = { systemPrompt?: string; signal?: AbortSignal };
type LLMStreamOptions = { systemPrompt?: string };
type LLMStreamHandle = { promise: Promise<LLMResponse>; stop: () => void };
type LLMStreamEvent = {
  sessionId: string; token: string; accumulatedText: string; isDone: boolean;
};

// Sampling, applied at setModel(), best-effort per backend
type InferenceBackend = 'auto' | 'gpu' | 'cpu';
type GenerationConfig = {
  temperature?: number; topK?: number; topP?: number; seed?: number; maxTokens?: number;
};
type SetModelOptions = { backend?: InferenceBackend; generation?: GenerationConfig };

// Structured output
type JSONSchema = {
  type?: JSONSchemaType | JSONSchemaType[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: ReadonlyArray<string | number | boolean | null>;
  [key: string]: unknown;
};
type GenerateObjectOptions = {
  systemPrompt?: string; signal?: AbortSignal; maxRepairAttempts?: number;
};
type GenerateObjectResult<T> = { object: T; text: string };

// Tool calling
type Tool<TArgs = any, TResult = any> = {
  description: string;
  parameters: JSONSchema;
  execute?: (args: TArgs) => TResult | Promise<TResult>;
};
type ToolSet = Record<string, Tool>;
type ToolCall = { toolName: string; args: unknown };
type ToolResult = { toolName: string; args: unknown; result: unknown };
type StepResult = { text: string; toolCalls: ToolCall[]; toolResults: ToolResult[] };
type GenerateTextFinishReason = 'stop' | 'tool-calls' | 'max-steps';
type GenerateTextOptions = {
  tools?: ToolSet; maxSteps?: number;
  systemPrompt?: string; signal?: AbortSignal; maxRepairAttempts?: number;
};
type GenerateTextResult = {
  text: string; steps: StepResult[];
  toolCalls: ToolCall[]; toolResults: ToolResult[];
  finishReason: GenerateTextFinishReason;
};

// Embeddings
type EmbeddingTask = 'semantic-similarity' | 'retrieval-query' | 'retrieval-document';
type EmbedOptions = { task?: EmbeddingTask; language?: string };
type EmbeddingModelIdentity = { id: string; revision: string };
type EmbedResult = {
  embeddings: number[][]; dimensions: number; model: EmbeddingModelIdentity;
};
type EmbeddingModelState = {
  status: 'not-downloaded' | 'downloading' | 'downloaded';
  sizeBytes: number; model: EmbeddingModelIdentity;
};
type ChunkOptions = { chunkSize?: number; overlap?: number };
type VectorRecord<M = unknown> = { id: string; vector: number[]; metadata?: M };
type VectorSearchResult<M = unknown> = VectorRecord<M> & { score: number };
type VectorSearchOptions = { topK?: number; minScore?: number };
type VectorStore<M = unknown> = {
  add(id: string, vector: number[], metadata?: M): void;
  addMany(records: VectorRecord<M>[]): void;
  get(id: string): VectorRecord<M> | undefined;
  remove(id: string): boolean;
  clear(): void;
  readonly size: number;
  search(query: number[], options?: VectorSearchOptions): VectorSearchResult<M>[];
  toJSON(): VectorRecord<M>[];
};

// Vision
type VisionImageSource = { uri: string };
type NormalizedRect = { x: number; y: number; width: number; height: number }; // origin top-left, 0–1
type NormalizedPoint = { x: number; y: number };
type PixelRect = { x: number; y: number; width: number; height: number };
type VisionFeature = 'background-removal' | 'image-labeling' | 'text-recognition';
type VisionFeatureAvailability =
  | { status: 'available' }
  | { status: 'downloadable' | 'downloading' }
  | { status: 'unavailable'; reason: 'platform' | 'os-version' | 'device' | 'not-enabled' };
type VisionAvailability = {
  backgroundRemoval: VisionFeatureAvailability;
  imageLabeling: VisionFeatureAvailability;
  textRecognition: VisionFeatureAvailability;
};
type PrepareVisionOptions = {
  features?: VisionFeature[]; languages?: string[]; onProgress?: (progress: number) => void;
};
type RemoveBackgroundOptions = {
  subject?: NormalizedPoint; mask?: boolean;
  trim?: boolean; format?: 'png' | 'jpeg'; quality?: number; maxPixels?: number;
};
type RemoveBackgroundResult = {
  uri: string; maskUri?: string; width: number; height: number; sourceWidth: number; sourceHeight: number;
  bounds: NormalizedRect; pixelBounds: PixelRect; foregroundCoverage: number;
  centroid: NormalizedPoint; instanceCount: number; trimOrigin: NormalizedPoint;
};
type LabelImageOptions = { maxResults?: number; minConfidence?: number };
type ImageLabel = { label: string; confidence: number };
type RecognizeTextOptions = {
  languages?: string[]; recognitionLevel?: 'accurate' | 'fast';
  usesLanguageCorrection?: boolean; customWords?: string[]; minTextHeight?: number;
};
type RecognizedTextLine = {
  text: string; bounds: NormalizedRect; confidence?: number; language?: string;
  cornerPoints?: NormalizedPoint[];
};
type RecognizedTextBlock = {
  text: string; bounds: NormalizedRect; lines: RecognizedTextLine[]; language?: string;
  cornerPoints?: NormalizedPoint[];
};
type RecognizeTextResult = { text: string; blocks: RecognizedTextBlock[] };

// Models
type BuiltInModel = {
  id: string; name: string; available: boolean;
  platform: 'ios' | 'android'; contextWindow: number;
};
type DownloadableModelStatus =
  | 'not-downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready';
type DownloadableModel = {
  id: string; name: string; parameterCount: string; license: string;
  sizeBytes: number; contextWindow: number; minRamBytes: number;
  meetsRequirements: boolean; status: DownloadableModelStatus;
};
type ModelRegistryEntry = {
  id: string; name: string; parameterCount: string; quantization: string;
  downloadUrl: string; sha256: string; sizeBytes: number;
  contextWindow: number; minRamBytes: number;
  supportedPlatforms: ('ios' | 'android')[]; license: string;
  preferredBackend?: 'auto' | 'gpu' | 'cpu'; // used when setModel gets no backend
};`}
      </CodeBlock>

      {/* ------------------------------------------------------------------ */}
      <h2 id="errors">Errors</h2>
      <p>
        Failures throw a <code>ModelError</code> with a typed <code>.code</code>{" "}
        and <code>.modelId</code>, so you can branch on the cause:
      </p>
      <CodeBlock language="typescript">
        {`import { ModelError } from 'expo-ai-kit';

try {
  await setModel('gemma-e4b');
} catch (e) {
  if (e instanceof ModelError && e.code === 'MODEL_NOT_DOWNLOADED') {
    await downloadModel('gemma-e4b');
  }
}`}
      </CodeBlock>
      <p>
        <strong><code>ModelErrorCode</code></strong> is one of:{" "}
        <code>MODEL_NOT_FOUND</code>, <code>MODEL_NOT_DOWNLOADED</code>,{" "}
        <code>DOWNLOAD_FAILED</code>, <code>DOWNLOAD_CORRUPT</code>,{" "}
        <code>DOWNLOAD_STORAGE_FULL</code>, <code>DOWNLOAD_CANCELLED</code>,{" "}
        <code>INFERENCE_OOM</code>, <code>INFERENCE_FAILED</code>,{" "}
        <code>INFERENCE_BUSY</code>, <code>INFERENCE_CANCELLED</code>,{" "}
        <code>MODEL_LOAD_FAILED</code>, <code>DEVICE_NOT_SUPPORTED</code>,{" "}
        <code>EMBEDDINGS_NOT_ENABLED</code>, <code>LANGUAGE_NOT_SUPPORTED</code>,{" "}
        <code>SPEECH_BUSY</code>, <code>SPEECH_NOT_ENABLED</code>,{" "}
        <code>MIC_PERMISSION_DENIED</code>, <code>AUDIO_DECODE_FAILED</code>,{" "}
        <code>TRANSCRIPTION_FAILED</code>, <code>VISION_NOT_ENABLED</code>,{" "}
        <code>IMAGE_DECODE_FAILED</code>, <code>NO_SUBJECT_FOUND</code>,{" "}
        <code>VISION_FAILED</code>, <code>UNKNOWN</code>.
      </p>
      <p>
        The <code>*_NOT_ENABLED</code> codes mean the Android app was built
        without the matching config-plugin flag (<code>androidEmbeddings</code>,{" "}
        <code>speech</code>, <code>vision</code>), enabling one requires a new
        native build. <code>LANGUAGE_NOT_SUPPORTED</code> means no on-device
        model handles the requested language for embeddings, speech, or text
        recognition (the message names it; there is never a silent fall-back).
        Vision adds <code>IMAGE_DECODE_FAILED</code> (unreadable input),{" "}
        <code>NO_SUBJECT_FOUND</code> (nothing to cut out), and{" "}
        <code>VISION_FAILED</code> (engine failure).
      </p>
      <Callout type="info" title="Single-flight inference">
        <p>
          Only one generation runs at a time. A concurrent{" "}
          <code>sendMessage</code> / <code>streamMessage</code> /{" "}
          <code>generateObject</code> / <code>generateText</code> rejects with{" "}
          <code>INFERENCE_BUSY</code>, wait for the active one, or{" "}
          <code>stop()</code> the active stream first. Speech has its own guard
          (<code>SPEECH_BUSY</code>); vision and embeddings have none, so they
          run alongside either.
        </p>
      </Callout>
    </DocsLayout>
  );
}
