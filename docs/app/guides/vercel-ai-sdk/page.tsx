import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "install", text: "Install & Polyfills", level: 2 },
  { id: "text", text: "Generate & Stream Text", level: 2 },
  { id: "models", text: "Choosing a Model", level: 2 },
  { id: "tools", text: "Tool Calling", level: 2 },
  { id: "objects", text: "Structured Output", level: 2 },
  { id: "embeddings", text: "Embeddings", level: 2 },
  { id: "caveats", text: "On-Device Caveats", level: 2 },
];

export default function VercelAiSdkPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Vercel AI SDK</h1>
      <p className="text-xl text-muted leading-relaxed">
        Use the AI SDK&apos;s <code>generateText</code>, <code>streamText</code>,{" "}
        <code>generateObject</code>, and <code>embed</code> with on-device models —
        the same code you&apos;d write for a cloud provider, with no API key and no
        data leaving the phone.
      </p>

      <BadgeGroup platforms={["ios", "android", "new"]} />

      <h2 id="overview">Overview</h2>
      <p>
        <code>expo-ai-kit/ai</code> is a first-class{" "}
        <a
          href="https://ai-sdk.dev"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Vercel AI SDK
        </a>{" "}
        provider implementing the <code>LanguageModelV3</code> spec — native to AI
        SDK 6, and accepted by AI SDK 7 as well. Point <code>model:</code> at{" "}
        <code>expoAiKit()</code> and everything the SDK offers rides on the same
        on-device engine as the core API: the ecosystem&apos;s patterns, examples,
        and abstractions, running locally.
      </p>
      <p>
        It&apos;s a thin wrapper over the same <code>sendMessage</code> /{" "}
        <code>streamMessage</code> / <code>embed</code> calls — you can mix AI SDK
        calls and core calls freely in one app. The core package stays{" "}
        <strong>zero-dependency</strong>; <code>@ai-sdk/provider</code> is an
        optional peer used only for types.
      </p>

      <h2 id="install">Install &amp; Polyfills</h2>
      <CodeBlock language="bash">
        {`npx expo install expo-ai-kit
npm i ai   # AI SDK 6+`}
      </CodeBlock>
      <Callout type="warning" title="React Native needs the AI SDK's polyfills">
        <p>
          The AI SDK uses web platform APIs that React Native doesn&apos;t ship:{" "}
          <code>ReadableStream</code>, <code>TextEncoder</code>/
          <code>TextDecoder</code>, and <code>structuredClone</code>. Install
          polyfills once at your app&apos;s entry point (this is an AI SDK
          requirement in RN, not specific to expo-ai-kit):
        </p>
        <CodeBlock language="typescript" filename="polyfills.ts">
          {`import 'web-streams-polyfill/polyfill';
import 'text-encoding-polyfill';
import structuredClone from '@ungap/structured-clone';

if (!('structuredClone' in globalThis)) {
  (globalThis as any).structuredClone = structuredClone;
}`}
        </CodeBlock>
      </Callout>

      <h2 id="text">Generate &amp; Stream Text</h2>
      <p>
        <code>expoAiKit()</code> with no arguments targets whatever model is
        currently active — the OS built-in by default.
      </p>
      <CodeBlock language="typescript" filename="App.tsx">
        {`import { generateText, streamText } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';

// One-shot
const { text } = await generateText({
  model: expoAiKit(),
  prompt: 'Capital of France?',
});

// Streaming — token-by-token for plain text
const result = streamText({
  model: expoAiKit(),
  messages: [{ role: 'user', content: 'Write a short story' }],
});
for await (const chunk of result.textStream) {
  setText((t) => t + chunk);
}`}
      </CodeBlock>

      <h2 id="models">Choosing a Model</h2>
      <p>
        Pass any model id <code>setModel()</code> accepts — a downloadable id like{" "}
        <code>&apos;gemma-e2b&apos;</code>, a built-in, or an id you registered
        with <code>registerModel()</code>. The provider activates it before
        generating (the model must already be downloaded). Settings take the same
        shape as <code>setModel()</code>&apos;s options and apply on activation:
      </p>
      <CodeBlock language="typescript">
        {`import { downloadModel } from 'expo-ai-kit';
import { expoAiKit } from 'expo-ai-kit/ai';

await downloadModel('gemma-e2b');

const gemma = expoAiKit('gemma-e2b', {
  generation: { temperature: 0.7, topK: 40 },
});

const { text } = await generateText({ model: gemma, prompt: '…' });`}
      </CodeBlock>
      <Callout type="info" title="Sampling is fixed at activation">
        <p>
          On-device runtimes build their sampler when the model loads, so a{" "}
          <em>per-call</em> <code>temperature</code>/<code>topK</code> passed
          through the AI SDK can&apos;t be honored — it&apos;s reported as an{" "}
          <code>unsupported</code> call warning and ignored. Set sampling in the
          provider settings (above) or via <code>setModel()</code>. If the model
          is already active, the provider does <em>not</em> reload it to apply new
          settings — reloading a multi-GB model per call would be far worse.
        </p>
      </Callout>

      <h2 id="tools">Tool Calling</h2>
      <p>
        AI SDK tools work — they ride the exact same prompt protocol as the core{" "}
        <code>generateText()</code>, so a model behaves identically through either
        API. The SDK owns the loop (<code>stopWhen</code>, step callbacks, etc.);
        the provider translates each round.
      </p>
      <CodeBlock language="typescript">
        {`import { generateText, tool, stepCountIs } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';
import { z } from 'zod';

const { text } = await generateText({
  model: expoAiKit(),
  prompt: 'What should I wear in Paris today?',
  tools: {
    getWeather: tool({
      description: 'Get the current weather for a city.',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => fetchWeather(city),
    }),
  },
  stopWhen: stepCountIs(5),
});`}
      </CodeBlock>
      <p>
        Keep tool sets small and schemas flat — on-device models pick tools far
        more reliably that way. <code>toolChoice: &apos;required&apos;</code> and{" "}
        <code>{`{ type: 'tool' }`}</code> are best-effort prompt nudges (flagged
        with a <code>compatibility</code> warning) until native constrained
        decoding lands.
      </p>

      <h2 id="objects">Structured Output</h2>
      <CodeBlock language="typescript">
        {`import { generateObject } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: expoAiKit(),
  prompt: 'A quick weeknight pasta.',
  schema: z.object({
    title: z.string(),
    minutes: z.number(),
    ingredients: z.array(z.string()),
  }),
});`}
      </CodeBlock>
      <Callout type="info" title="Single-shot via the SDK">
        <p>
          The provider extracts JSON from the model&apos;s output with the same
          tolerant parser as the core <code>generateObject()</code>, but it is{" "}
          <strong>single-shot</strong> — the SDK doesn&apos;t re-prompt on schema
          mismatches. Small on-device models sometimes need a repair round, so if
          you want the retry loop, use the core{" "}
          <code>generateObject()</code> from <code>expo-ai-kit</code> — it repairs
          and retries automatically.
        </p>
      </Callout>

      <h2 id="embeddings">Embeddings</h2>
      <p>
        <code>expoAiKit.embeddingModel()</code> wraps <code>embed()</code> and
        resolves the platform default honestly — Apple&apos;s{" "}
        <code>NLContextualEmbedding</code> on iOS (reported as{" "}
        <code>apple-nl-contextual</code>), EmbeddingGemma 300M on Android
        (reported as <code>embedding-gemma-300m</code>; needs the{" "}
        <code>androidEmbeddings</code> config-plugin flag plus a{" "}
        <code>prepareEmbeddingModel()</code> download — see the{" "}
        <a href="/guides/embeddings" className="text-accent hover:underline">
          Embeddings guide
        </a>
        ). Pass <code>{"{ task, language }"}</code> as settings or per-call via{" "}
        <code>providerOptions[&apos;expo-ai-kit&apos;]</code>; dev builds warn
        when you embed without an explicit task, since EmbeddingGemma vectors
        are task-conditioned.
      </p>
      <CodeBlock language="typescript">
        {`import { embed, embedMany, cosineSimilarity } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';

const { embedding } = await embed({
  model: expoAiKit.embeddingModel(undefined, { task: 'retrieval-query' }),
  value: 'sunny day at the beach',
});

const { embeddings } = await embedMany({
  model: expoAiKit.embeddingModel(undefined, { task: 'retrieval-document' }),
  values: chunks,
});`}
      </CodeBlock>
      <Callout type="info" title="Thinking models surface reasoning parts">
        <p>
          When the active model reasons in <code>&lt;think&gt;</code> blocks
          (e.g. Qwen3), the provider strips them out of text and tool output and
          emits them as spec <code>reasoning</code> parts — so{" "}
          <code>generateText()</code>&apos;s <code>reasoning</code> field just
          works and JSON/tool parsing can&apos;t be derailed by reasoning text.
        </p>
      </Callout>

      <h2 id="caveats">On-Device Caveats</h2>
      <p>
        On-device models aren&apos;t cloud models; the provider reports every
        mismatch honestly through the AI SDK&apos;s warning system rather than
        failing silently:
      </p>
      <ul>
        <li>
          <strong>One generation at a time.</strong> On-device models share a
          single KV-cache, so concurrent calls reject with{" "}
          <code>INFERENCE_BUSY</code>. Await one call before starting the next.
        </li>
        <li>
          <strong>Per-call sampling is ignored</strong> (with an{" "}
          <code>unsupported</code> warning) — see{" "}
          <a href="#models" className="text-accent hover:underline">
            Choosing a Model
          </a>
          .
        </li>
        <li>
          <strong>Streaming buffers when tools or JSON output are requested</strong>{" "}
          — a half-streamed tool-call envelope would surface as garbage text
          deltas, so those runs emit the parsed result in one piece. Plain text
          streams token-by-token.
        </li>
        <li>
          <strong>No token usage numbers</strong> — on-device runtimes don&apos;t
          report them; all usage fields are <code>undefined</code>.
        </li>
        <li>
          <strong>No image or file prompt parts</strong> — text only for now
          (vision input is on the roadmap); they throw{" "}
          <code>DEVICE_NOT_SUPPORTED</code>.
        </li>
        <li>
          <strong>Errors are still typed</strong> — everything the provider throws
          is the same <code>ModelError</code> (with <code>.code</code>) as the
          core API.
        </li>
      </ul>

      <Callout type="success" title="Mix and match">
        <p>
          The provider and the core API drive the same engine — use{" "}
          <code>streamText()</code> for your chat screen and the core{" "}
          <code>generateObject()</code> where you want automatic schema repair, in
          the same app, against the same active model.
        </p>
      </Callout>
    </DocsLayout>
  );
}
