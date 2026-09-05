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
  { id: "one-import", text: "Everything in one import", level: 2 },
  { id: "what-you-can-do", text: "What your app can do", level: 2 },
  { id: "capabilities", text: "Capabilities", level: 2 },
  { id: "recipes", text: "Recipes", level: 2 },
  { id: "design-notes", text: "Design notes", level: 2 },
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

// Rows of the "what your app can do" table: the job, the function, and the
// engine per platform. Same content as the README table.
const useCases = [
  {
    emoji: "💬",
    job: "Chat with a local model, stream tokens",
    call: "sendMessage, streamMessage",
    ios: "Apple Foundation Models",
    android: "ML Kit Prompt API",
  },
  {
    emoji: "🧾",
    job: "Typed JSON from the model",
    call: "generateObject",
    ios: "Apple Foundation Models",
    android: "ML Kit Prompt API",
  },
  {
    emoji: "🛠️",
    job: "Let the model call your functions",
    call: "generateText({ tools })",
    ios: "Apple Foundation Models",
    android: "ML Kit Prompt API",
  },
  {
    emoji: "🎙️",
    job: "Speech to text, live or from a file",
    call: "streamTranscription, transcribe",
    ios: "SpeechAnalyzer",
    android: "ML Kit Speech Recognition",
  },
  {
    emoji: "✂️",
    job: "Cut the subject out of a photo",
    call: "removeBackground",
    ios: "Apple Vision",
    android: "ML Kit Subject Segmentation",
  },
  {
    emoji: "🏷️",
    job: "Label what is in a photo",
    call: "labelImage",
    ios: "Apple Vision",
    android: "ML Kit Image Labeling",
  },
  {
    emoji: "🔤",
    job: "Read the text in a photo",
    call: "recognizeText",
    ios: "Apple Vision",
    android: "ML Kit Text Recognition",
  },
  {
    emoji: "🔎",
    job: "Search by meaning",
    call: "embed, createVectorStore",
    ios: "NLContextualEmbedding",
    android: "EmbeddingGemma",
  },
  {
    emoji: "🧠",
    job: "Run a Gemma, Qwen, or Phi model you pick",
    call: "downloadModel, setModel",
    ios: "LiteRT-LM",
    android: "LiteRT-LM",
  },
];

// One card per capability: what an app can do, then the functions behind it.
// Same grouping as the sidebar and README; a new capability gets a new card.
const capabilities = [
  {
    emoji: "💬",
    title: "LLM",
    copy: "Chat and stream, get typed JSON back, let the model call your functions.",
    api: "sendMessage · streamMessage · generateObject · generateText",
    href: "/guides/llm",
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
    copy: "Turn text into vectors for semantic search and retrieval over your own data.",
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
          A local LLM, speech-to-text, vision, and embeddings as plain async
          functions. Uses the models already on the phone (Apple
          Foundation Models, Apple Vision, SpeechAnalyzer, ML Kit) and
          downloadable LiteRT-LM models when you want a specific one. No API
          keys, nothing leaves the device.
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
  sendMessage, streamMessage, generateObject, generateText, // 💬 LLM
  transcribe, streamTranscription,                          // 🎙️ Speech
  removeBackground, labelImage, recognizeText,              // 👁️ Vision
  embed, chunkText, createVectorStore,                      // 🔎 Embeddings
} from 'expo-ai-kit';`}
      </CodeBlock>
      <p>
        Every capability follows the same three steps: check availability,
        prepare once, use. Only the prepare step downloads anything, and
        failures throw a <code>ModelError</code> with a typed <code>code</code>.
      </p>

      <h2 id="what-you-can-do">What your app can do</h2>
      <div className="docs-table-scroll">
        <table>
          <thead>
            <tr>
              <th>What you want</th>
              <th>Call</th>
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
        The LLM works with no configuration. Speech, vision (Android), and Android
        embeddings are opt-in build flags, so apps that don&apos;t use them add
        no size or permissions, see the{" "}
        <Link href="/api#config-plugin" className="text-accent hover:underline">
          config plugin
        </Link>
        .
      </p>

      <h2 id="recipes">Recipes</h2>
      <p>
        A few patterns that combine capabilities. The LLM and speech are
        single-flight; vision and embeddings are not, so these can run
        alongside each other.
      </p>
      <CodeBlock language="typescript" filename="voice-memo.ts">
        {`// 🎙️ Speech → 💬 LLM: a voice memo becomes a structured summary
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
        {`// 👁️ Vision → 💬 LLM: a photo of a receipt becomes typed data
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

      <h2 id="design-notes">Design notes</h2>
      <div className="docs-proof-grid">
        <div>
          <strong>Same shape everywhere</strong>
          <span>Check availability, prepare once, use. Failures are <code>ModelError</code>s with a typed code.</span>
        </div>
        <div>
          <strong>Opt-in build flags</strong>
          <span>Speech, vision (Android), and Android embeddings are flags; the LLM works with no configuration.</span>
        </div>
        <div>
          <strong>Zero runtime dependencies</strong>
          <span>Plain async functions with no hooks or hidden state.</span>
        </div>
        <div>
          <strong>OS models by default</strong>
          <span>Apple Foundation Models, Apple Vision, SpeechAnalyzer, and ML Kit, plus downloadable LiteRT-LM models when you want a specific one.</span>
        </div>
        <div>
          <strong>Vercel AI SDK provider</strong>
          <span><code>expo-ai-kit/ai</code> exposes the same engines to the AI SDK.</span>
        </div>
        <div>
          <strong>Readable by coding agents</strong>
          <span>Typed errors, explicit lifecycles, and an <a href={`${siteConfig.url}/llms.txt`}>llms.txt</a>.</span>
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
