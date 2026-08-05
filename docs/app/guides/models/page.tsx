import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "built-in-vs-downloadable", text: "Built-in vs Downloadable", level: 2 },
  { id: "the-catalog", text: "The Catalog", level: 2 },
  { id: "download-and-switch", text: "Download & Switch", level: 2 },
  { id: "recommended", text: "Pick the Right Model", level: 2 },
  { id: "lifecycle", text: "Status & Lifecycle", level: 2 },
  { id: "bring-your-own-model", text: "Bring Your Own Model", level: 2 },
  { id: "fetch-metadata", text: "fetchModelMetadata()", level: 2 },
];

export default function ModelsPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Models</h1>
      <p className="text-xl text-muted leading-relaxed">
        Use the zero-download OS models, download open models at runtime, or
        register your own — all behind one API.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="overview">Overview</h2>
      <p>
        expo-ai-kit runs two kinds of model. <strong>Built-in</strong> models are
        provided by the OS and need no download — Apple Foundation Models on iOS,
        ML Kit on Android. <strong>Downloadable</strong> models (Gemma, Qwen,
        Phi) are fetched at runtime via LiteRT-LM and run on both platforms. You
        switch between any of them with <code>setModel()</code>.
      </p>

      <h2 id="built-in-vs-downloadable">Built-in vs Downloadable</h2>
      <table>
        <thead>
          <tr>
            <th>Built-in (OS)</th>
            <th>Downloadable (LiteRT-LM)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Zero download, zero app-size cost</td>
            <td>0.5–4 GB download, managed by you</td>
          </tr>
          <tr>
            <td>OS-maintained &amp; updated</td>
            <td>Pinned version you control</td>
          </tr>
          <tr>
            <td><code>apple-fm</code> (iOS), <code>mlkit</code> (Android)</td>
            <td>Same model on iOS <em>and</em> Android</td>
          </tr>
        </tbody>
      </table>

      <h2 id="the-catalog">The Catalog</h2>
      <p>
        The built-in registry ships a size ladder across three families. Each
        entry carries a <code>license</code> — check it before shipping a model
        to your users.
      </p>
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>Params</th>
            <th>Download</th>
            <th>License</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>qwen3-0.6b</code></td><td>0.6B</td><td>~0.5 GB</td><td>Apache-2.0</td></tr>
          <tr><td><code>qwen3-1.7b</code></td><td>1.7B</td><td>~2.1 GB</td><td>Apache-2.0</td></tr>
          <tr><td><code>gemma-e2b</code></td><td>2.3B</td><td>~2.6 GB</td><td>Gemma</td></tr>
          <tr><td><code>qwen3-4b</code></td><td>4B</td><td>~2.7 GB</td><td>Apache-2.0</td></tr>
          <tr><td><code>gemma-e4b</code></td><td>4.5B</td><td>~3.7 GB</td><td>Gemma</td></tr>
          <tr><td><code>phi-4-mini</code></td><td>3.8B</td><td>~3.9 GB</td><td>MIT</td></tr>
        </tbody>
      </table>

      <Callout type="info" title="Qwen3 runs on the CPU backend by default">
        <p>
          Registry entries can pin a <code>preferredBackend</code> that{" "}
          <code>setModel()</code> uses when you don&apos;t pass one. The Qwen3
          entries pin <code>&apos;cpu&apos;</code>: their GPU path is broken in
          the current LiteRT-LM runtime (device-verified — a native crash on
          Android and degenerate output on iOS), while CPU generates correctly
          on both platforms. An explicit{" "}
          <code>setModel(id, {"{ backend }"})</code> always wins. Qwen3 is also
          a thinking model — see <code>stripThinking()</code> if you call the
          raw <code>sendMessage()</code> (the orchestrated APIs and the AI SDK
          provider already handle its <code>&lt;think&gt;</code> blocks).
        </p>
      </Callout>

      <h2 id="download-and-switch">Download &amp; Switch</h2>
      <p>
        Download a model (with progress), then activate it with{" "}
        <code>setModel()</code>. After that, every inference call —{" "}
        <code>sendMessage</code>, <code>streamMessage</code>,{" "}
        <code>generateObject</code>, <code>generateText</code> — uses it.{" "}
        <code>unloadModel()</code> reverts to the OS built-in.
      </p>

      <CodeBlock language="typescript" filename="setup.ts">
        {`import { downloadModel, setModel, unloadModel } from 'expo-ai-kit';

await downloadModel('qwen3-1.7b', {
  onProgress: (p) => console.log(\`\${Math.round(p * 100)}%\`),
});

await setModel('qwen3-1.7b', { generation: { temperature: 0.7 } });
// ...all inference now runs on Qwen3 1.7B

await unloadModel(); // back to the OS model`}
      </CodeBlock>

      <Callout type="info" title="Sampling is set at activation">
        <p>
          Generation options (<code>temperature</code>, <code>topK</code>, …) are
          fixed when you call <code>setModel()</code>, not per request —
          LiteRT-LM builds the sampler when the model session is created.
        </p>
      </Callout>

      <h2 id="recommended">Pick the Right Model</h2>
      <p>
        <code>getDownloadableModels()</code> returns the full catalog enriched
        with per-device status, size, license, and whether the device meets the
        model&apos;s RAM requirement. <code>getRecommendedModel()</code> returns
        the most capable model the current device can actually run, or{" "}
        <code>null</code>.
      </p>

      <CodeBlock language="typescript">
        {`import { getDownloadableModels, getRecommendedModel } from 'expo-ai-kit';

const all = await getDownloadableModels();
all.forEach((m) => console.log(m.id, m.meetsRequirements, m.status, m.license));

const best = await getRecommendedModel();
if (best) await downloadModel(best.id);`}
      </CodeBlock>

      <h2 id="lifecycle">Status &amp; Lifecycle</h2>
      <p>
        Each downloadable model reports a <code>status</code>:
      </p>
      <ul>
        <li><code>not-downloaded</code> — no file on disk</li>
        <li><code>downloading</code> — fetch in progress</li>
        <li><code>downloaded</code> — on disk but not loaded; survives app restarts</li>
        <li><code>loading</code> — being loaded into memory</li>
        <li><code>ready</code> — loaded and ready for inference</li>
      </ul>
      <p>
        Downloads are integrity-checked (SHA256) and resumable to delete with{" "}
        <code>cancelDownload(id)</code> / <code>deleteModel(id)</code>.
      </p>

      <h2 id="bring-your-own-model">Bring Your Own Model</h2>
      <p>
        Not limited to the built-in list — register any LiteRT-LM model at
        runtime with <code>registerModel()</code>. Once registered, the id works
        with <code>downloadModel</code> / <code>setModel</code> /{" "}
        <code>getDownloadableModels</code> exactly like a built-in, and the
        download is still integrity-checked against the <code>sha256</code> you
        provide.
      </p>

      <CodeBlock language="typescript" filename="App.tsx">
        {`import { registerModel, downloadModel, setModel } from 'expo-ai-kit';

registerModel({
  id: 'qwen3-4b-custom',
  name: 'Qwen3 4B',
  parameterCount: '4B',
  quantization: 'int4',
  downloadUrl:
    'https://huggingface.co/litert-community/Qwen3-4B/resolve/main/qwen3_4b_mixed_int4.litertlm',
  sha256: 'f0794bc77efeaaf4f7af815f04c483b19b8f2ae4a102cef1b7b760a25848a18e',
  sizeBytes: 2_659_057_664,
  contextWindow: 4096,
  minRamBytes: 3_000_000_000,
  supportedPlatforms: ['ios', 'android'],
  license: 'Apache-2.0',
});

await downloadModel('qwen3-4b-custom');
await setModel('qwen3-4b-custom');`}
      </CodeBlock>

      <Callout type="warning" title="Re-register on each launch">
        <p>
          Custom models live in memory — call <code>registerModel()</code> at
          startup every launch. The downloaded file persists on disk (keyed by
          id), so a model&apos;s <code>downloaded</code> status survives restarts
          once you re-register it. Curated and native ids are reserved;{" "}
          <code>registerModel()</code> rejects collisions.
        </p>
      </Callout>

      <h2 id="fetch-metadata">fetchModelMetadata()</h2>
      <p>
        Rather than computing the <code>sha256</code> and <code>sizeBytes</code>{" "}
        by hand, <code>fetchModelMetadata()</code> looks them up from a
        HuggingFace resolve URL.
      </p>

      <CodeBlock language="typescript">
        {`import { fetchModelMetadata } from 'expo-ai-kit';

const { sha256, sizeBytes } = await fetchModelMetadata(
  'https://huggingface.co/litert-community/Qwen3-4B/resolve/main/qwen3_4b_mixed_int4.litertlm',
);`}
      </CodeBlock>

      <Callout type="info" title="Trust note">
        <p>
          It reads the hash from the same host you download from, so it only
          guards against transit corruption — not a maliciously changed upstream
          repo. For a real supply-chain guarantee, run it once at dev time and{" "}
          <strong>pin</strong> the returned <code>sha256</code> in your source,
          exactly like the built-in registry does.
        </p>
      </Callout>
    </DocsLayout>
  );
}
