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
  { id: "why-expo-ai-kit", text: "Why expo-ai-kit", level: 2 },
  { id: "model-paths", text: "Model paths", level: 2 },
  { id: "quick-start", text: "Quick start", level: 2 },
  { id: "capabilities", text: "Capabilities", level: 2 },
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

const capabilityCards = [
  {
    title: "Generate",
    copy: "Stream text, preserve conversation context, and cancel work in progress.",
  },
  {
    title: "Structure",
    copy: "Turn model output into validated objects with JSON Schema repair loops.",
  },
  {
    title: "Act",
    copy: "Give local models typed tools and keep human approval in the loop.",
  },
  {
    title: "Retrieve",
    copy: "Create embeddings and build private, on-device semantic search and RAG.",
  },
  {
    title: "Transcribe",
    copy: "Turn speech into text — live from the microphone or from audio files.",
  },
  {
    title: "Switch",
    copy: "Move between OS-native and downloadable models at runtime.",
  },
  {
    title: "Integrate",
    copy: "Use the same local engine through the Vercel AI SDK provider.",
  },
];

export default function Home() {
  return (
    <DocsLayout headings={headings}>
      <section className="docs-hero">
        <div className="docs-hero-glow" aria-hidden="true" />
        <p className="docs-eyebrow">LOCAL AI · NATIVE SPEED · PRIVATE BY DEFAULT</p>
        <h1>Build on-device AI into Expo apps.</h1>
        <p className="docs-hero-copy">
          Text generation, speech-to-text, embeddings, and RAG on the models
          your users&apos; phones already ship with — Apple Foundation Models,
          ML Kit, SpeechAnalyzer — plus downloadable LiteRT-LM models when you
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

      <h2 id="why-expo-ai-kit">Why expo-ai-kit</h2>
      <p>
        Most AI features don&apos;t need a server — phones ship with capable
        models of their own now. expo-ai-kit is a small, typed API over the best
        of them, so your app can generate text, transcribe speech, and search
        its own data while offline, in private, and at no cost per request.
      </p>

      <div className="docs-proof-grid">
        <div>
          <strong>No inference account</strong>
          <span>Install the package and run models without provisioning a backend.</span>
        </div>
        <div>
          <strong>Cross-platform primitives</strong>
          <span>One API for generation, tools, embeddings, RAG, and model lifecycle.</span>
        </div>
        <div>
          <strong>Zero runtime dependencies</strong>
          <span>A deliberately lean native module, not another application framework.</span>
        </div>
      </div>

      <Callout type="warning" title="Use a development build">
        <p>
          expo-ai-kit contains native code and does not run in Expo Go. Use
          <code>npx expo run:ios</code>, <code>npx expo run:android</code>, or an
          EAS development build.
        </p>
      </Callout>

      <h2 id="model-paths">Choose the right model path</h2>
      <div className="docs-model-grid">
        <div>
          <span className="docs-model-kicker">iOS 26+</span>
          <h3>Apple Foundation Models</h3>
          <p>Use Apple&apos;s OS-provided language model with no model bundled into your app.</p>
        </div>
        <div>
          <span className="docs-model-kicker">Android API 26+</span>
          <h3>ML Kit</h3>
          <p>Prepare Google&apos;s OS-managed model on supported Android devices.</p>
        </div>
        <div>
          <span className="docs-model-kicker">iOS + Android</span>
          <h3>LiteRT-LM</h3>
          <p>Download curated Gemma, Qwen, and Phi models—or register your own.</p>
        </div>
      </div>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock language="bash" filename="Terminal">
        {`npx expo install expo-ai-kit`}
      </CodeBlock>
      <CodeBlock language="typescript" filename="App.tsx">
        {`import {
  isAvailable,
  prepareBuiltInModel,
  sendMessage,
} from 'expo-ai-kit';

if (!(await isAvailable())) {
  throw new Error('On-device AI is unavailable');
}

await prepareBuiltInModel();

const { text } = await sendMessage([
  { role: 'user', content: 'Explain local AI in one sentence.' },
]);

console.log(text);`}
      </CodeBlock>

      <h2 id="capabilities">A practical local AI toolkit</h2>
      <div className="docs-capability-grid">
        {capabilityCards.map((capability) => (
          <div key={capability.title}>
            <h3>{capability.title}</h3>
            <p>{capability.copy}</p>
          </div>
        ))}
      </div>

      <h2 id="next-steps">Go deeper</h2>
      <div className="docs-next-grid">
        <Link href="/get-started">
          <strong>Installation and first run</strong>
          <span>Configure a native build and make your first request.</span>
        </Link>
        <Link href="/guides/models">
          <strong>Model management</strong>
          <span>Compare OS models, open models, and custom LiteRT-LM files.</span>
        </Link>
        <Link href="/guides/speech">
          <strong>Speech-to-text</strong>
          <span>Transcribe the microphone live or audio files, on-device.</span>
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
