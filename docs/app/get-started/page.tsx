import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/Badge";
import Link from "next/link";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Get Started",
  "Install expo-ai-kit, configure a native Expo build, prepare the device model, and run your first local AI request.",
  "/get-started"
);

const headings = [
  { id: "prerequisites", text: "Prerequisites", level: 2 },
  { id: "installation", text: "Installation", level: 2 },
  { id: "android-configuration", text: "Android Configuration", level: 2 },
  { id: "optional-features", text: "Optional Features", level: 2 },
  { id: "basic-usage", text: "Basic Usage", level: 2 },
  { id: "simple-prompt", text: "Simple Prompt", level: 3 },
  { id: "with-system-prompt", text: "With Custom System Prompt", level: 3 },
  {
    id: "multi-turn-conversations",
    text: "Multi-turn Conversations",
    level: 3,
  },
  { id: "streaming-responses", text: "Streaming Responses", level: 3 },
  { id: "next-steps", text: "Next Steps", level: 2 },
];

export default function GetStartedPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Get Started</h1>
      <p className="text-xl text-muted leading-relaxed">
        Install expo-ai-kit and run your first on-device AI query in minutes.
      </p>

      <h2 id="prerequisites">Prerequisites</h2>
      <p>Before you begin, make sure you have:</p>
      <ul>
        <li>Expo SDK 54+</li>
        <li>
          <strong>iOS:</strong> iOS 15.1+ (library minimum); iOS 26+ for the
          built-in text model; iOS 17+ for background removal and embeddings
        </li>
        <li>
          <strong>Android:</strong> API 26+,{" "}
          <a
            href="https://developers.google.com/ml-kit/genai#prompt-device"
            className="text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Supported devices
          </a>
        </li>
      </ul>

      <Callout type="info" title="Expo SDK Requirement">
        <p>
          expo-ai-kit requires Expo SDK 54 or later. If you&apos;re using an
          older SDK version, you&apos;ll need to upgrade your project first.
        </p>
      </Callout>

      <Callout type="warning" title="Development build required">
        <p>
          expo-ai-kit includes native Swift and Kotlin code, so it does not run
          in Expo Go. Use a development build created with <code>npx expo
          run:ios</code>, <code>npx expo run:android</code>, or EAS Build.
        </p>
      </Callout>

      <h2 id="installation">Installation</h2>
      <p>Install expo-ai-kit using your preferred package manager:</p>

      <CodeBlock language="bash" filename="Terminal">
        {`npx expo install expo-ai-kit`}
      </CodeBlock>

      <p>
        For bare React Native projects, run <code>npx pod-install</code> after
        installing.
      </p>

      <h2 id="android-configuration">Android Configuration</h2>
      <p>
        <span className="inline-flex items-center gap-2">
          <Badge platform="android" /> For Android,
        </span>{" "}
        install <code>expo-build-properties</code> and set the minimum SDK
        version:
      </p>

      <CodeBlock language="bash" filename="Terminal">
        {`npx expo install expo-build-properties`}
      </CodeBlock>

      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [
      [
        "expo-build-properties",
        {
          "android": {
            "minSdkVersion": 26
          }
        }
      ]
    ]
  }
}`}
      </CodeBlock>

      <h2 id="optional-features">Optional Features</h2>
      <p>
        Text generation works out of the box. Speech, vision (Android), and
        Android embeddings are opt-in flags, so apps that don&apos;t use them
        add no size or permissions. Turn on what you need and make a new native
        build:
      </p>
      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [["expo-ai-kit", { "speech": true, "vision": true, "androidEmbeddings": true }]]
  }
}`}
      </CodeBlock>
      <p>
        See the{" "}
        <Link href="/api#config-plugin" className="text-accent hover:underline">
          config plugin reference
        </Link>{" "}
        for what each flag adds.
      </p>

      <h2 id="basic-usage">Basic Usage</h2>

      <h3 id="simple-prompt">Simple Prompt</h3>
      <p>The simplest way to use on-device AI:</p>

      <CodeBlock language="typescript" filename="App.tsx">
        {`import {
  isAvailable,
  prepareBuiltInModel,
  sendMessage,
} from 'expo-ai-kit';

async function askAI(question: string) {
  const supported = await isAvailable();

  if (!supported) {
    console.log('On-device AI not available');
    return null;
  }

  // Downloads Android's OS-managed ML Kit model when needed.
  // On iOS, this validates Apple Foundation Models availability.
  await prepareBuiltInModel();

  const response = await sendMessage([
    { role: 'user', content: question }
  ]);
  return response.text;
}

const answer = await askAI('What is the capital of France?');`}
      </CodeBlock>

      <Callout type="info" title="Support is not readiness">
        <p>
          On Android, <code>isAvailable()</code> can return <code>true</code>
          while the supported ML Kit model still needs to download. Await
          <code>prepareBuiltInModel()</code> once during setup before starting
          inference.
        </p>
      </Callout>

      <h3 id="with-system-prompt">With Custom System Prompt</h3>
      <p>Customize the AI&apos;s behavior with a system prompt:</p>

      <CodeBlock language="typescript" filename="App.tsx">
        {`import { sendMessage } from 'expo-ai-kit';

const response = await sendMessage(
  [{ role: 'user', content: 'Tell me a joke' }],
  { systemPrompt: 'You are a comedian who specializes in dad jokes.' }
);

console.log(response.text);`}
      </CodeBlock>

      <h3 id="multi-turn-conversations">Multi-turn Conversations</h3>
      <p>
        On-device models are stateless, keep an array of messages and pass the
        full history on each call:
      </p>

      <CodeBlock language="typescript" filename="chat.ts">
        {`import { sendMessage, type LLMMessage } from 'expo-ai-kit';

const messages: LLMMessage[] = [
  { role: 'user', content: 'My name is Alice.' },
];

const first = await sendMessage(messages);
messages.push({ role: 'assistant', content: first.text });

// Add the next turn, the full history gives the model context
messages.push({ role: 'user', content: 'What is my name?' });
const second = await sendMessage(messages);
// second.text -> "Your name is Alice."`}
      </CodeBlock>

      <Callout type="info">
        <p>
          You own the history array, append each turn and pass it back. See the{" "}
          <a href="/guides/multi-turn" className="text-accent hover:underline">
            Multi-turn guide
          </a>{" "}
          for patterns like trimming long conversations.
        </p>
      </Callout>

      <h3 id="streaming-responses">Streaming Responses</h3>
      <p>
        For a ChatGPT-like experience where text appears progressively:
      </p>

      <CodeBlock language="typescript" filename="StreamingChat.tsx">
        {`import { useState } from 'react';
import { streamMessage } from 'expo-ai-kit';

const [responseText, setResponseText] = useState('');

const { promise, stop } = streamMessage(
  [{ role: 'user', content: 'Tell me a story' }],
  (event) => {
    // Update UI with each token
    setResponseText(event.accumulatedText);

    // event.token - the new token/chunk
    // event.accumulatedText - full text so far
    // event.isDone - whether streaming is complete
  },
  { systemPrompt: 'You are a creative storyteller.' }
);

// Optionally cancel the stream
// stop();

// Wait for completion
await promise;`}
      </CodeBlock>

      <Callout type="success" title="You're Ready!">
        <p>
          You now have expo-ai-kit installed and configured. The library handles
          all the complexity of interfacing with platform-native AI frameworks.
        </p>
      </Callout>

      <h2 id="next-steps">Next Steps</h2>
      <p>Now that you have the basics working, explore more features:</p>
      <ul>
        <li>
          <Link
            href="/guides/structured-output"
            className="text-accent hover:underline"
          >
            Structured Output
          </Link>:
          Get typed objects back with a JSON Schema
        </li>
        <li>
          <Link
            href="/guides/tool-calling"
            className="text-accent hover:underline"
          >
            Tool Calling
          </Link>:
          Let the model call your functions
        </li>
        <li>
          <Link href="/guides/speech" className="text-accent hover:underline">
            Speech-to-Text
          </Link>:
          Transcribe the microphone or audio files on-device
        </li>
        <li>
          <Link href="/guides/vision" className="text-accent hover:underline">
            Vision
          </Link>:
          Remove backgrounds, label images, and read text in photos
        </li>
        <li>
          <Link href="/guides/embeddings" className="text-accent hover:underline">
            Embeddings
          </Link>:
          Semantic search over your own data
        </li>
        <li>
          <Link href="/guides/models" className="text-accent hover:underline">
            Models
          </Link>:
          Download open models or bring your own
        </li>
        <li>
          <Link href="/api" className="text-accent hover:underline">
            API Reference
          </Link>:
          Explore all available methods and options
        </li>
        <li>
          <Link href="/examples" className="text-accent hover:underline">
            Examples
          </Link>:
          See complete code examples
        </li>
      </ul>
    </DocsLayout>
  );
}
