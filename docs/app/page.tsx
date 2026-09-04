import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BadgeGroup } from "@/components/Badge";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { DocsLayout } from "@/components/DocsLayout";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const headings = [
  { id: "see-it", text: "See it", level: 2 },
  { id: "one-import", text: "Everything in one import", level: 2 },
  { id: "what-you-can-do", text: "What your app can do", level: 2 },
  { id: "capabilities", text: "Capabilities", level: 2 },
  { id: "recipes", text: "Recipes", level: 2 },
  { id: "why-expo-ai-kit", text: "Why expo-ai-kit", level: 2 },
  { id: "quick-start", text: "Quick start", level: 2 },
  { id: "next-steps", text: "Next steps", level: 2 },
];

const liveBadges = [
  {
    href: siteConfig.npm,
    src: "https://img.shields.io/npm/v/expo-ai-kit.svg",
    alt: "Current expo-ai-kit version on npm",
    width: 94,
  },
  {
    href: siteConfig.npm,
    src: "https://img.shields.io/npm/dw/expo-ai-kit.svg",
    alt: "Weekly expo-ai-kit downloads on npm",
    width: 116,
  },
  {
    href: siteConfig.repository,
    src: "https://img.shields.io/github/stars/saidkaban/expo-ai-kit",
    alt: "expo-ai-kit stars on GitHub",
    width: 82,
  },
  {
    href: `${siteConfig.repository}/actions/workflows/ci.yml`,
    src: "https://github.com/saidkaban/expo-ai-kit/actions/workflows/ci.yml/badge.svg",
    alt: "expo-ai-kit continuous integration status",
    width: 100,
  },
  {
    href: "https://opensource.org/licenses/MIT",
    src: "https://img.shields.io/badge/License-MIT-yellow.svg",
    alt: "MIT license",
    width: 92,
  },
];

// Demo clips (docs/public/demos/*.mp4), one per capability, in capability order.
const demos = [
  { file: "text", emoji: "💬", call: "streamMessage", alt: "Tokens streaming from an on-device model" },
  { file: "speech", emoji: "🎙️", call: "streamTranscription", alt: "A live transcript revising as it listens" },
  { file: "vision", emoji: "👁️", call: "removeBackground · labelImage", alt: "Tap a subject, get a transparent cutout, labels, and a mask" },
  { file: "embeddings", emoji: "🔎", call: "embed · createVectorStore", alt: "Notes ranked by meaning" },
];

// Rows of the "what your app can do" table: the job, the function, what it
// replaces, and the engine per platform. Same content as the README table.
const useCases = [
  {
    emoji: "💬",
    job: "Chat with a local model, stream tokens",
    call: "sendMessage / streamMessage",
    insteadOf: "a hosted LLM API",
    ios: "Apple Foundation Models",
    android: "ML Kit Prompt API",
  },
  {
    emoji: "🧾",
    job: "Get a typed object back",
    call: "generateObject",
    insteadOf: "prompt hacks + JSON parsing",
    ios: "″",
    android: "″",
  },
  {
    emoji: "🛠️",
    job: "Let the model call your functions",
    call: "generateText({ tools })",
    insteadOf: "a function-calling API",
    ios: "″",
    android: "″",
  },
  {
    emoji: "🎙️",
    job: "Transcribe voice, live or from a file",
    call: "streamTranscription / transcribe",
    insteadOf: "a speech-to-text API",
    ios: "SpeechAnalyzer",
    android: "ML Kit Speech Recognition",
  },
  {
    emoji: "✂️",
    job: "Cut the subject out of a photo",
    call: "removeBackground",
    insteadOf: "a background-removal API",
    ios: "Apple Vision",
    android: "ML Kit Subject Segmentation",
  },
  {
    emoji: "🏷️",
    job: "Describe what is in a photo",
    call: "labelImage",
    insteadOf: "an image-tagging API",
    ios: "Apple Vision",
    android: "ML Kit Image Labeling",
  },
  {
    emoji: "🔤",
    job: "Read the text in a photo",
    call: "recognizeText",
    insteadOf: "an OCR API",
    ios: "Apple Vision",
    android: "ML Kit Text Recognition",
  },
  {
    emoji: "🔎",
    job: "Search by meaning, build RAG",
    call: "embed + createVectorStore",
    insteadOf: "an embeddings API + a vector DB",
    ios: "NLContextualEmbedding",
    android: "EmbeddingGemma",
  },
  {
    emoji: "🧠",
    job: "Run a Gemma, Qwen, or Phi model you choose",
    call: "downloadModel + setModel",
    insteadOf: "a model-hosting service",
    ios: "LiteRT-LM",
    android: "LiteRT-LM",
  },
];

// One card per capability: what an app can do, then the functions behind it.
// Same grouping as the sidebar and README; a new capability gets a new card.
const capabilities = [
  {
    emoji: "💬",
    title: "Text",
    copy: "Chat and stream, get typed JSON back, let the model call your functions.",
    api: "sendMessage · streamMessage · generateObject · generateText",
    href: "/guides/text-generation",
  },
  {
    emoji: "🎙️",
    title: "Speech",
    copy: "Live dictation with revising updates, or a transcript from an audio file.",
    api: "streamTranscription · transcribe",
    href: "/guides/speech",
  },
  {
    emoji: "👁️",
    title: "Vision",
    copy: "Cut the subject out of a photo, label what is in it, read the text in it.",
    api: "removeBackground · labelImage · recognizeText",
    href: "/guides/vision",
  },
  {
    emoji: "🔎",
    title: "Embeddings",
    copy: "Vectors for semantic search and on-device retrieval-augmented generation.",
    api: "embed · chunkText · createVectorStore",
    href: "/guides/embeddings",
  },
];

export default function Home() {
  return (
    <DocsLayout headings={headings}>
      <section className="docs-hero">
        <div className="docs-hero-glow" aria-hidden="true" />
        <p className="docs-eyebrow">ON-DEVICE · iOS AND ANDROID · TYPESCRIPT</p>
        <h1>On-device AI primitives for Expo apps.</h1>
        <p className="docs-hero-copy">
          Text generation, speech-to-text, vision, and embeddings as plain
          async functions, running on the models your users&apos; phones
          already ship with (Apple Foundation Models, Apple Vision,
          SpeechAnalyzer, ML Kit) plus downloadable LiteRT-LM models when you
          need more. No API keys, no per-token bill, no cloud round-trip.
        </p>

        <div className="docs-hero-actions">
          <Link href="/get-started" className="docs-button docs-button-primary">
            Get started
          </Link>
          <a
            href={siteConfig.repository}
            target="_blank"
            rel="noopener noreferrer"
            className="docs-button docs-button-secondary"
          >
            View on GitHub
          </a>
        </div>

        <div className="docs-badges" aria-label="Live project statistics">
          {liveBadges.map((badge) => (
            <a
              key={badge.src}
              href={badge.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={badge.alt}
            >
              <Image
                src={badge.src}
                alt={badge.alt}
                width={badge.width}
                height={20}
                unoptimized
              />
            </a>
          ))}
        </div>
      </section>

      <h2 id="see-it">See it</h2>
      <p>
        Real outputs captured on a Galaxy A16, replayed with their original
        timing. Each clip is one call.
      </p>
      <div className="docs-demo-grid">
        {demos.map((demo) => (
          <figure key={demo.file}>
            <video src={`/demos/${demo.file}.mp4`} autoPlay loop muted playsInline aria-label={demo.alt} />
            <figcaption>
              <span aria-hidden="true">{demo.emoji} </span>
              <code>{demo.call}</code>
            </figcaption>
          </figure>
        ))}
      </div>

      <h2 id="one-import">Everything in one import</h2>
      <CodeBlock language="typescript" filename="app.ts">
        {`import {
  sendMessage, streamMessage, generateObject, generateText, // 💬 Text
  transcribe, streamTranscription,                          // 🎙️ Speech
  removeBackground, labelImage, recognizeText,              // 👁️ Vision
  embed, chunkText, createVectorStore,                      // 🔎 Embeddings & RAG
} from 'expo-ai-kit';`}
      </CodeBlock>
      <p>
        Plain async functions, one package, both platforms. Every capability
        follows the same three steps, <strong>check availability → prepare
        once → use</strong>, and every failure is a <code>ModelError</code>{" "}
        with a typed <code>.code</code>, never a fake success.
      </p>

      <h2 id="what-you-can-do">What your app can do</h2>
      <div className="docs-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>You call</th>
              <th>Instead of</th>
              <th>iOS</th>
              <th>Android</th>
            </tr>
          </thead>
          <tbody>
            {useCases.map((row) => (
              <tr key={row.job}>
                <td>
                  <span aria-hidden="true">{row.emoji} </span>
                  {row.job}
                </td>
                <td>
                  <code>{row.call}</code>
                </td>
                <td>{row.insteadOf}</td>
                <td>{row.ios}</td>
                <td>{row.android}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="capabilities">Capabilities</h2>
      <div className="docs-capability-grid">
        {capabilities.map((capability) => (
          <Link key={capability.title} href={capability.href} className="docs-capability-card">
            <h3>
              <span aria-hidden="true">{capability.emoji} </span>
              {capability.title}
            </h3>
            <p>{capability.copy}</p>
            <code>{capability.api}</code>
          </Link>
        ))}
      </div>
      <p>
        Text works with no configuration. Speech, vision (Android), and Android
        embeddings are opt-in build flags, so apps that don&apos;t use them add
        no size or permissions, see the{" "}
        <Link href="/api#config-plugin" className="text-accent hover:underline">
          config plugin
        </Link>
        .
      </p>

      <h2 id="recipes">Recipes: the capabilities compose</h2>
      <p>
        The primitives are designed to chain, and their concurrency rules never
        collide (text and speech are single-flight; vision and embeddings are
        not). Three patterns that fit in a screen of code:
      </p>
      <CodeBlock language="typescript" filename="voice-memo.ts">
        {`// 🎙️ Speech → 💬 Text: a voice memo becomes a structured summary
const { text } = await transcribe({ audio: { uri: memoUri } });
const { object } = await generateObject<{ title: string; actionItems: string[] }>(
  [{ role: 'user', content: \`Summarize this voice memo:\\n\${text}\` }],
  {
    type: 'object',
    properties: { title: { type: 'string' }, actionItems: { type: 'array', items: { type: 'string' } } },
    required: ['title', 'actionItems'],
  }
);`}
      </CodeBlock>
      <CodeBlock language="typescript" filename="receipt.ts">
        {`// 👁️ Vision → 💬 Text: a photo of a receipt becomes typed data
const { text } = await recognizeText({ uri: receipt.uri });
const { object } = await generateObject<{ merchant: string; total: number; date: string }>(
  [{ role: 'user', content: \`Extract the merchant, total, and date from this receipt:\\n\${text}\` }],
  {
    type: 'object',
    properties: { merchant: { type: 'string' }, total: { type: 'number' }, date: { type: 'string' } },
    required: ['merchant', 'total'],
  }
);`}
      </CodeBlock>
      <CodeBlock language="typescript" filename="photo-search.ts">
        {`// 👁️ Vision → 🔎 Embeddings: search your photos by meaning
const labels = await labelImage({ uri: photo.uri });
const { embeddings: [vector] } = await embed([labels.map((l) => l.label).join(', ')], {
  task: 'retrieval-document',
});
photoIndex.add(photo.id, vector, { uri: photo.uri });
// later: embed the user's query with task 'retrieval-query' and photoIndex.search(queryVector)`}
      </CodeBlock>
      <p>
        More complete patterns live on the{" "}
        <Link href="/examples" className="text-accent hover:underline">
          Examples
        </Link>{" "}
        page.
      </p>

      <h2 id="why-expo-ai-kit">Why expo-ai-kit</h2>
      <p>
        Most AI features don&apos;t need a server, phones ship with capable
        models of their own now. expo-ai-kit is a small, typed API over the best
        of them, so your app can chat, transcribe, see, and search its own data
        while offline, in private, and at no cost per request.
      </p>

      <div className="docs-proof-grid">
        <div>
          <strong>Same shape everywhere</strong>
          <span>Check availability, prepare once, use. Failures are typed errors, never fake output.</span>
        </div>
        <div>
          <strong>Pay only for what you use</strong>
          <span>Opt-in build flags for speech, vision, and Android embeddings; text works out of the box.</span>
        </div>
        <div>
          <strong>Zero runtime dependencies</strong>
          <span>A deliberately lean native module, not another application framework.</span>
        </div>
        <div>
          <strong>Native models, no bundling</strong>
          <span>OS-provided engines on both platforms; download open models only when you choose to.</span>
        </div>
        <div>
          <strong>AI SDK compatible</strong>
          <span><code>expo-ai-kit/ai</code> plugs the same engines into the Vercel AI SDK.</span>
        </div>
        <div>
          <strong>Agent friendly</strong>
          <span>Explicit lifecycles, typed errors, and an <a href={`${siteConfig.url}/llms.txt`}>llms.txt</a> your coding agent can read.</span>
        </div>
      </div>

      <Callout type="warning" title="Use a development build">
        <p>
          expo-ai-kit contains native code and does not run in Expo Go. Use
          <code>npx expo run:ios</code>, <code>npx expo run:android</code>, or an
          EAS development build.
        </p>
      </Callout>

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock language="bash" filename="Terminal">
        {`npx expo install expo-ai-kit`}
      </CodeBlock>
      <CodeBlock language="typescript" filename="App.tsx">
        {`import { isAvailable, prepareBuiltInModel, sendMessage } from 'expo-ai-kit';

if (!(await isAvailable())) {
  throw new Error('On-device AI is unavailable');
}

await prepareBuiltInModel();

const { text } = await sendMessage([
  { role: 'user', content: 'Explain local AI in one sentence.' },
]);`}
      </CodeBlock>
      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [["expo-ai-kit", { "speech": true, "vision": true, "androidEmbeddings": true }]]
  }
}`}
      </CodeBlock>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="next-steps">Go deeper</h2>
      <div className="docs-next-grid">
        <Link href="/get-started">
          <strong>Installation and first run</strong>
          <span>Configure a native build and make your first request.</span>
        </Link>
        <Link href="/guides/vision">
          <strong>Vision</strong>
          <span>Background removal, image labels, and OCR from one photo.</span>
        </Link>
        <Link href="/guides/speech">
          <strong>Speech-to-text</strong>
          <span>Transcribe the microphone live or audio files, on-device.</span>
        </Link>
        <Link href="/guides/models">
          <strong>Models</strong>
          <span>Compare OS models, open models, and custom LiteRT-LM files.</span>
        </Link>
        <Link href="/guides/vercel-ai-sdk">
          <strong>Vercel AI SDK</strong>
          <span>Use the familiar AI SDK interface with local inference.</span>
        </Link>
        <Link href="/api">
          <strong>API reference</strong>
          <span>Browse every public function, type, option, and error.</span>
        </Link>
      </div>
    </DocsLayout>
  );
}
