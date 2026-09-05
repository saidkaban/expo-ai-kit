import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Embeddings & RAG",
  "Create on-device embeddings and build private semantic search and retrieval-augmented generation with expo-ai-kit.",
  "/guides/embeddings"
);

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "platform-support", text: "Platform Support", level: 2 },
  { id: "android-setup", text: "Android Setup (opt-in)", level: 2 },
  { id: "embed", text: "Embedding Text", level: 2 },
  { id: "tasks", text: "Task Types", level: 2 },
  { id: "languages", text: "Languages (iOS)", level: 2 },
  { id: "model-identity", text: "Model Identity", level: 2 },
  { id: "lifecycle", text: "Model Lifecycle", level: 2 },
  { id: "rag", text: "Retrieval-Augmented Generation", level: 2 },
  { id: "chunking", text: "Chunking", level: 2 },
  { id: "vector-store", text: "The Vector Store", level: 2 },
  { id: "persistence", text: "Persistence", level: 2 },
  { id: "tips", text: "Tips", level: 2 },
];

export default function EmbeddingsPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Embeddings &amp; RAG</h1>
      <p className="text-xl text-muted leading-relaxed">
        Turn text into vectors for semantic search, then retrieve the most
        relevant chunks of your own documents to ground the model&apos;s answers,
        all on-device.
      </p>

      <BadgeGroup platforms={["ios", "android", "new"]} />

      <h2 id="overview">Overview</h2>
      <p>
        Retrieval-augmented generation (RAG) lets a small on-device model answer
        questions over data it was never trained on, your notes, your docs, your
        app&apos;s content. You <em>embed</em> the text into vectors, store them,
        and at query time retrieve the chunks most similar to the question and
        feed them to <code>sendMessage()</code> or <code>generateText()</code>.
        Because everything runs locally, your data never leaves the device.
      </p>
      <p>expo-ai-kit gives you two pieces:</p>
      <ul>
        <li>
          <code>embed()</code>, turns text into embedding vectors on{" "}
          <strong>both platforms</strong>: Apple&apos;s zero-download{" "}
          <code>NLContextualEmbedding</code> on iOS, and EmbeddingGemma 300M via
          MediaPipe TextEmbedder on Android (opt-in).
        </li>
        <li>
          A pure-JS toolkit, <code>chunkText</code>,{" "}
          <code>cosineSimilarity</code>, and <code>createVectorStore</code>,
          that does the chunking and retrieval on <strong>both platforms</strong>,
          with any source of vectors.
        </li>
      </ul>

      <h2 id="platform-support">Platform Support</h2>
      <p>One embedding backend per platform, with very different asset models:</p>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>iOS (17+)</th>
            <th>Android (opt-in)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Model</td>
            <td>
              Apple <code>NLContextualEmbedding</code> (script models: Latin /
              Cyrillic / CJK)
            </td>
            <td>EmbeddingGemma 300M via MediaPipe TextEmbedder</td>
          </tr>
          <tr>
            <td>Dimensions</td>
            <td>e.g. 512 (per script model)</td>
            <td>768 (returned as-is)</td>
          </tr>
          <tr>
            <td>Max sequence</td>
            <td>model-dependent</td>
            <td>512 tokens (longer input is truncated)</td>
          </tr>
          <tr>
            <td>Languages</td>
            <td>
              selected via <code>language</code> (see below)
            </td>
            <td>
              natively multilingual, single vector space, {" "}
              <code>language</code> is accepted and <em>ignored</em>
            </td>
          </tr>
          <tr>
            <td>Assets</td>
            <td>OS-managed, zero app-size cost, fetched on demand</td>
            <td>
              ~184 MB Google-hosted download, stored per-app (SHA-256 pinned)
            </td>
          </tr>
          <tr>
            <td>App size</td>
            <td>zero</td>
            <td>~+25 MB APK (arm64) when the flag is enabled</td>
          </tr>
        </tbody>
      </table>
      <Callout type="info" title="The toolkit runs everywhere">
        <p>
          <code>chunkText</code>, <code>cosineSimilarity</code>, and{" "}
          <code>createVectorStore</code> are pure JavaScript and work on{" "}
          <strong>every platform</strong>, pair them with any embedding source
          (the built-in <code>embed()</code>, a cloud embedder, or your own
          native module). They only ever deal in plain <code>number[]</code>{" "}
          vectors.
        </p>
      </Callout>

      <h2 id="android-setup">Android Setup (opt-in)</h2>
      <p>
        The Android backend is <strong>off by default</strong>, zero bytes
        added to your APK, and <code>embed()</code> throws a typed{" "}
        <code>EMBEDDINGS_NOT_ENABLED</code> error explaining the flag. Enable it
        with the config plugin:
      </p>
      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [["expo-ai-kit", { "androidEmbeddings": true }]]
  }
}`}
      </CodeBlock>
      <Callout type="warning" title="Requires a new native build">
        <p>
          The flag adds the MediaPipe <code>tasks-text</code> Gradle dependency
          at prebuild, rebuild your dev client or EAS build to pick it up (an
          OTA update is not enough). Enabling adds ~25 MB to the APK (arm64);
          the ~184 MB model itself downloads at runtime via{" "}
          <code>prepareEmbeddingModel()</code> and is stored per-app, unlike
          the iOS assets, it is Google-hosted, <em>not</em> OS-managed.
          EmbeddingGemma ships under the Gemma Terms of Use, review them
          before shipping.
        </p>
      </Callout>

      <h2 id="embed">Embedding Text</h2>
      <p>
        Pass an array of strings; get one vector back per string, in order, plus
        the shared <code>dimensions</code> and the <code>model</code> identity
        that produced them.
      </p>
      <CodeBlock language="typescript" filename="embed.ts">
        {`import { embed } from 'expo-ai-kit';

const { embeddings, dimensions, model } = await embed([
  'The Eiffel Tower is in Paris.',
  'Mount Fuji is in Japan.',
]);

embeddings.length; // 2, one vector per input
dimensions;        // 512 on iOS (per script model), 768 on Android
model;             // { id, revision }, see Model Identity below`}
      </CodeBlock>
      <Callout type="info" title="Not subject to INFERENCE_BUSY">
        <p>
          Embeddings don&apos;t use the text-generation KV-cache, so{" "}
          <code>embed()</code> is <em>not</em> gated by the single-flight
          inference guard, you can embed while a generation is in flight. (On
          Android, concurrent <code>embed()</code> calls queue behind a native
          mutex rather than failing.)
        </p>
      </Callout>

      <h2 id="tasks">Task Types</h2>
      <p>
        <code>options.task</code> says what the vectors are for. EmbeddingGemma
        (Android) is task-conditioned, telling it the task measurably improves
        retrieval, while iOS accepts the value as semantic intent only (vectors
        are identical across tasks).
      </p>
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Use for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>&apos;semantic-similarity&apos;</code> (default)
            </td>
            <td>symmetric text-to-text comparison</td>
          </tr>
          <tr>
            <td>
              <code>&apos;retrieval-query&apos;</code>
            </td>
            <td>the question side of a RAG lookup</td>
          </tr>
          <tr>
            <td>
              <code>&apos;retrieval-document&apos;</code>
            </td>
            <td>the corpus side, use when indexing chunks</td>
          </tr>
        </tbody>
      </table>

      <h2 id="languages">Languages (iOS)</h2>
      <p>
        <code>options.language</code> (BCP-47, default <code>&apos;en&apos;</code>)
        selects which iOS script model to load, Latin, Cyrillic, or CJK, and
        is passed through to the tokenizer. An unsupported language throws a
        typed <code>LANGUAGE_NOT_SUPPORTED</code> error naming the language,
        never a silent fall-back to the Latin model, and there is deliberately
        no auto-detection (a mixed batch would silently mix vector spaces).
      </p>
      <CodeBlock language="typescript">
        {`import { embed, getSupportedEmbeddingLanguages } from 'expo-ai-kit';

await embed(['привет мир'], { language: 'ru' });      // Cyrillic model
await embed(['你好世界'], { language: 'zh-Hans' });   // CJK model
await embed(['hello'], { language: 'tlh' });          // throws LANGUAGE_NOT_SUPPORTED

// Enumerate what the running device actually supports:
const languages = await getSupportedEmbeddingLanguages();`}
      </CodeBlock>
      <p>
        Verified on a physical iOS 27 device, the catalog covers: bg, cs, da,
        de, en, es, fi, fr, hr, hu, id, it, ja, kk, ko, nb, nl, pl, pt, ro, ru,
        sk, sv, tr, uk, vi, zh-Hans, zh-Hant. Always prefer{" "}
        <code>getSupportedEmbeddingLanguages()</code> at runtime, the list is
        OS-managed and can differ per device/OS. On Android the option is
        accepted and ignored: EmbeddingGemma is natively multilingual with a
        single vector space, so there is nothing to select (and{" "}
        <code>getSupportedEmbeddingLanguages()</code> returns <code>[]</code>).
      </p>

      <h2 id="model-identity">Model Identity</h2>
      <Callout type="warning" title="The index-compatibility rule">
        <p>
          Every result carries <code>model: {"{ id, revision }"}</code> for the
          exact model that produced it.{" "}
          <strong>
            Vectors and persisted indexes are only comparable under identical
            model identity
          </strong>:
          never across platforms, and never across iOS script models (the
          identity changes with <code>language</code>). Store it next to any
          persisted index and rebuild when it changes.
        </p>
      </Callout>
      <p>
        On iOS the identity is the resolved Apple model identifier and OS asset
        revision. On Android it pins every artifact, the MediaPipe version,
        model SHA-256, dimensions, and prompt-protocol version (e.g.{" "}
        <code>1.0.0-913b7a1edc7c-d768-tfc1</code>), so it changes whenever any
        of them does.
      </p>

      <h2 id="lifecycle">Model Lifecycle</h2>
      <p>
        <code>embed()</code> <strong>never</strong> downloads anything, on
        Android it throws a typed <code>MODEL_NOT_DOWNLOADED</code> until you
        prepare the model explicitly:
      </p>
      <CodeBlock language="typescript" filename="prepare.ts">
        {`import {
  getEmbeddingModelStatus,
  prepareEmbeddingModel,
  cancelEmbeddingModelDownload,
  deleteEmbeddingModel,
} from 'expo-ai-kit';

const { status, sizeBytes, model } = await getEmbeddingModelStatus();
// status: 'not-downloaded' | 'downloading' | 'downloaded'
// sizeBytes: 183_816_181 on Android (~184 MB); 0 on iOS (OS-managed)

if (status !== 'downloaded') {
  await prepareEmbeddingModel({ onProgress: (p) => console.log(p) });
  // Android: SHA-256-verified atomic install; partial/corrupt downloads fail closed.
}

// cancelEmbeddingModelDownload() aborts an in-flight Android download;
// deleteEmbeddingModel() reclaims the ~184 MB. Both are safe no-ops on iOS,
// where the OS owns the assets.`}
      </CodeBlock>
      <p>
        On iOS the same calls drive the OS-managed per-language asset flow:{" "}
        <code>prepareEmbeddingModel({"{ language: 'ru' }"})</code> prefetches the
        Cyrillic model ahead of the first embed (no progress granularity, the
        OS doesn&apos;t expose it).
      </p>

      <h2 id="rag">Retrieval-Augmented Generation</h2>
      <p>
        The full loop: index your document once, then retrieve and answer at query
        time.
      </p>
      <CodeBlock language="typescript" filename="rag.ts">
        {`import { embed, chunkText, createVectorStore, sendMessage } from 'expo-ai-kit';

// --- Index once -------------------------------------------------------------
const chunks = chunkText(document);            // overlapping, sentence-aware
const { embeddings } = await embed(chunks, { task: 'retrieval-document' });

const store = createVectorStore<{ text: string }>();
store.addMany(
  chunks.map((text, i) => ({ id: \`c\${i}\`, vector: embeddings[i], metadata: { text } })),
);

// --- Answer at query time ---------------------------------------------------
async function ask(question: string) {
  const { embeddings: [q] } = await embed([question], { task: 'retrieval-query' });
  const hits = store.search(q, { topK: 4 });
  const context = hits.map((h) => h.metadata!.text).join('\\n\\n');

  return sendMessage([
    { role: 'system', content: \`Answer using ONLY this context:\\n\${context}\` },
    { role: 'user', content: question },
  ]);
}`}
      </CodeBlock>

      <h2 id="chunking">Chunking</h2>
      <p>
        <code>chunkText()</code> splits a document into overlapping pieces sized
        for embedding. It breaks on sentence and paragraph boundaries where
        possible so chunks read coherently, and repeats a little context
        (overlap) across boundaries so a fact split between two chunks still
        appears whole in at least one.
      </p>
      <CodeBlock language="typescript">
        {`import { chunkText } from 'expo-ai-kit';

const chunks = chunkText(longDocument, {
  chunkSize: 1000, // target characters of new content per chunk (default 1000)
  overlap: 200,    // characters repeated into the next chunk (default min(200, chunkSize / 5))
});`}
      </CodeBlock>
      <p>
        Returns <code>[]</code> for empty input and a single chunk when the text
        already fits in <code>chunkSize</code>. Tune <code>chunkSize</code> to
        your retrieval granularity, smaller chunks pinpoint facts; larger chunks
        keep more context together.
      </p>

      <h2 id="vector-store">The Vector Store</h2>
      <p>
        <code>createVectorStore()</code> is a lightweight in-memory store. Add
        records (id + vector + optional metadata), then <code>search()</code> by a
        query vector for the top matches by{" "}
        <code>cosineSimilarity</code>.
      </p>
      <CodeBlock language="typescript">
        {`import { createVectorStore } from 'expo-ai-kit';

const store = createVectorStore<{ text: string; source: string }>();

store.add('a', vectorA, { text: '…', source: 'faq.md' });
store.addMany(records);

store.search(queryVector, { topK: 5, minScore: 0.3 });
// → [{ id, vector, metadata, score }, …] sorted by score, highest first

store.get('a');
store.remove('a');
store.size;
store.clear();`}
      </CodeBlock>
      <Callout type="info" title="Scale">
        <p>
          The store does a linear scan per search, plenty fast for the
          thousands-of-chunks scale typical of on-device RAG. Reach for a
          dedicated vector database only beyond that.
        </p>
      </Callout>

      <h2 id="persistence">Persistence</h2>
      <p>
        The store owns no I/O, persistence is yours. <code>toJSON()</code> hands
        you a plain-array snapshot to write anywhere (AsyncStorage, a file, SQLite);
        pass it back to <code>createVectorStore()</code> to rehydrate. Re-embedding
        on every launch would be slow and wasteful, so index once and persist.
      </p>
      <CodeBlock language="typescript">
        {`import AsyncStorage from '@react-native-async-storage/async-storage';
import { createVectorStore } from 'expo-ai-kit';

// Save
await AsyncStorage.setItem('kb', JSON.stringify(store.toJSON()));

// Restore
const saved = await AsyncStorage.getItem('kb');
const store = createVectorStore(saved ? JSON.parse(saved) : undefined);`}
      </CodeBlock>

      <h2 id="tips">Tips</h2>
      <ul>
        <li>
          Embed chunks and the query with the <em>same</em> model, vectors from
          different models aren&apos;t comparable (and a dimension mismatch throws
          from <code>cosineSimilarity</code>).
        </li>
        <li>
          Store the source text as <code>metadata</code> so you can pass it
          straight into the prompt after a search.
        </li>
        <li>
          Use <code>topK</code> to bound how much context you inject, on-device
          models have small context windows, so 3–5 focused chunks usually beat
          stuffing in more.
        </li>
        <li>
          Set a <code>minScore</code> to drop weak matches rather than padding the
          prompt with irrelevant text.
        </li>
      </ul>

      <Callout type="success" title="Private by construction">
        <p>
          Embedding, storage, retrieval, and generation all run on-device, no API
          keys, no servers, and your documents never leave the phone.
        </p>
      </Callout>
    </DocsLayout>
  );
}
