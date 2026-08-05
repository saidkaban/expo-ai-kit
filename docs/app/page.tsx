import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import Link from "next/link";

const headings = [
  { id: "what-is-expo-ai-kit", text: "What is expo-ai-kit?", level: 2 },
  { id: "key-features", text: "Key Features", level: 2 },
  { id: "models", text: "Models", level: 2 },
  { id: "quick-example", text: "Quick Example", level: 2 },
  { id: "next-steps", text: "Next Steps", level: 2 },
];

export default function Home() {
  return (
    <DocsLayout headings={headings}>
      <h1>expo-ai-kit</h1>
      <p className="text-xl text-muted leading-relaxed">
        On-device AI for Expo &amp; React Native. Run language models locally —
        no API keys, no cloud, no cost. Streaming, structured output, tool
        calling, embeddings &amp; RAG, and runtime model switching, all on the
        device.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <Callout type="success" title="New in 0.11: Vercel AI SDK provider">
        <p>
          Use the AI SDK&apos;s <code>generateText</code>, <code>streamText</code>,{" "}
          <code>generateObject</code>, and <code>embed</code> with on-device
          models — <code>{`model: expoAiKit()`}</code> and the code you&apos;d
          write for OpenAI runs locally instead. See the{" "}
          <Link href="/guides/vercel-ai-sdk" className="text-accent hover:underline">
            Vercel AI SDK guide
          </Link>
          .
        </p>
      </Callout>

      <h2 id="what-is-expo-ai-kit">What is expo-ai-kit?</h2>
      <p>
        <strong>expo-ai-kit</strong> gives you one API over several on-device
        backends. It runs the OS-native models with zero download —{" "}
        <a
          href="https://developer.apple.com/documentation/FoundationModels"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Apple Foundation Models
        </a>{" "}
        on iOS and{" "}
        <a
          href="https://developers.google.com/ml-kit/genai"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          ML Kit
        </a>{" "}
        on Android — and can also download open models (Gemma, Qwen, Phi) that
        run on both platforms via{" "}
        <a
          href="https://ai.google.dev/edge/litert-lm"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          LiteRT-LM
        </a>
        .
      </p>

      <Callout type="info" title="Privacy First">
        <p>
          All inference happens locally on the device. Your users&apos; data
          never leaves their phone — complete privacy, no network round-trips,
          and no per-request cost.
        </p>
      </Callout>

      <h2 id="key-features">Key Features</h2>
      <ul>
        <li>
          <strong>Zero-download OS models</strong> — Apple Foundation Models &amp;
          ML Kit, no app-size bloat
        </li>
        <li>
          <strong>Streaming</strong> — progressive token updates with{" "}
          <code>streamMessage()</code>, cancellable mid-stream
        </li>
        <li>
          <strong>Structured output</strong> — typed objects from a JSON Schema
          with <code>generateObject()</code>
        </li>
        <li>
          <strong>Tool calling</strong> — let the model call your functions with{" "}
          <code>generateText()</code>
        </li>
        <li>
          <strong>Embeddings &amp; RAG</strong> — <code>embed()</code> plus a
          chunking + vector-store toolkit for on-device retrieval
        </li>
        <li>
          <strong>Vercel AI SDK provider</strong> — <code>expo-ai-kit/ai</code>{" "}
          plugs on-device models into the AI SDK&apos;s <code>generateText</code>,{" "}
          <code>streamText</code>, and friends
        </li>
        <li>
          <strong>Downloadable models</strong> — a Gemma / Qwen / Phi size
          ladder, plus bring-your-own-model
        </li>
        <li>
          <strong>Runtime switching</strong> — change models on the fly with{" "}
          <code>setModel()</code>
        </li>
        <li>
          <strong>Typed errors</strong> — a single <code>ModelError</code> with a
          reliable <code>.code</code>
        </li>
        <li>
          <strong>Zero runtime dependencies</strong> — lean, sharp primitives
        </li>
      </ul>

      <h2 id="models">Models</h2>
      <p>
        Use the built-in OS model, or download an open model and switch to it at
        runtime. Each downloadable model carries a license — check it before
        shipping.
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
          <tr><td><code>gemma-e2b</code></td><td>2.3B</td><td>~2.6 GB</td><td>Gemma</td></tr>
          <tr><td><code>qwen3-4b</code></td><td>4B</td><td>~2.7 GB</td><td>Apache-2.0</td></tr>
          <tr><td><code>gemma-e4b</code></td><td>4.5B</td><td>~3.7 GB</td><td>Gemma</td></tr>
          <tr><td><code>phi-4-mini</code></td><td>3.8B</td><td>~3.9 GB</td><td>MIT</td></tr>
        </tbody>
      </table>
      <p>
        Plus <code>qwen3-1.7b</code> — and any LiteRT-LM model you{" "}
        <Link href="/guides/models#bring-your-own-model" className="text-accent hover:underline">
          register yourself
        </Link>
        . See the{" "}
        <Link href="/guides/models" className="text-accent hover:underline">
          Models guide
        </Link>
        .
      </p>

      <Callout type="info" title="Requirements">
        <ul className="list-disc pl-4 space-y-1">
          <li>Expo SDK 54+</li>
          <li>
            <strong>iOS:</strong> iOS 26+ for the built-in Apple Foundation Model;
            downloadable models run more broadly
          </li>
          <li>
            <strong>Android:</strong> API 26+ (<code>minSdkVersion 26</code>)
          </li>
        </ul>
      </Callout>

      <h2 id="quick-example">Quick Example</h2>
      <p>Check availability, then send a message:</p>

      <CodeBlock language="typescript" filename="App.tsx">
        {`import { isAvailable, sendMessage } from 'expo-ai-kit';

if (await isAvailable()) {
  const { text } = await sendMessage([
    { role: 'user', content: 'Hello! What can you do?' },
  ]);
  console.log(text);
}`}
      </CodeBlock>

      <h2 id="next-steps">Next Steps</h2>
      <ul>
        <li>
          <Link href="/get-started" className="text-accent hover:underline">
            Get Started
          </Link>{" "}
          — install and run your first query
        </li>
        <li>
          <Link href="/guides/structured-output" className="text-accent hover:underline">
            Structured Output
          </Link>{" "}
          — get typed objects from a JSON Schema
        </li>
        <li>
          <Link href="/guides/tool-calling" className="text-accent hover:underline">
            Tool Calling
          </Link>{" "}
          — let the model call your functions
        </li>
        <li>
          <Link href="/guides/vercel-ai-sdk" className="text-accent hover:underline">
            Vercel AI SDK
          </Link>{" "}
          — drive on-device models through the AI SDK
        </li>
        <li>
          <Link href="/guides/models" className="text-accent hover:underline">
            Models
          </Link>{" "}
          — download open models or bring your own
        </li>
        <li>
          <Link href="/api" className="text-accent hover:underline">
            API Reference
          </Link>{" "}
          — the complete API
        </li>
      </ul>
    </DocsLayout>
  );
}
