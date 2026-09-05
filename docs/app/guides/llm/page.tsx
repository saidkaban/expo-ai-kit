import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import Link from "next/link";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "LLM",
  "Chat with the on-device model and generate text: availability, preparation, system prompts, cancellation, and where structured output and tool calling fit.",
  "/guides/llm"
);

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "availability", text: "Availability & Preparation", level: 2 },
  { id: "generate", text: "Generate", level: 2 },
  { id: "stream", text: "Stream", level: 2 },
  { id: "system-prompts", text: "System Prompts", level: 2 },
  { id: "cancel", text: "Cancellation", level: 2 },
  { id: "single-flight", text: "One Generation at a Time", level: 2 },
  { id: "beyond-text", text: "Beyond Plain Text", level: 2 },
];

export default function LlmPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>LLM</h1>
      <p className="text-xl text-muted leading-relaxed">
        Chat with the model your users&apos; phones already have, or one you
        download, with two functions: <code>sendMessage()</code> and{" "}
        <code>streamMessage()</code>.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="overview">Overview</h2>
      <p>
        The LLM is the capability that needs no configuration. By default it runs
        on the OS model, <strong>Apple Foundation Models</strong> on iOS 26+
        and the <strong>ML Kit Prompt API</strong> on supported Android devices,
        and you can switch to a downloadable Gemma, Qwen, or Phi model with{" "}
        <code>setModel()</code> (see{" "}
        <Link href="/guides/models" className="text-accent hover:underline">
          Models
        </Link>
        ). Every text function shares the same message shape:
      </p>
      <CodeBlock language="typescript">
        {`type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string };`}
      </CodeBlock>
      <p>
        The message APIs are <strong>stateless</strong>: pass the complete
        history on every call. The{" "}
        <Link href="/guides/multi-turn" className="text-accent hover:underline">
          Multi-turn guide
        </Link>{" "}
        shows the patterns.
      </p>

      <h2 id="availability">Availability &amp; preparation</h2>
      <CodeBlock language="typescript">
        {`import { isAvailable, prepareBuiltInModel } from 'expo-ai-kit';

if (!(await isAvailable())) {
  // No built-in model here, offer a downloadable one (getRecommendedModel) or a fallback UI.
}

// Android may download its OS-managed model on first use; iOS validates availability.
// Resolves immediately when the model is already ready.
await prepareBuiltInModel();`}
      </CodeBlock>
      <Callout type="info" title="Support is not readiness">
        <p>
          On Android, <code>isAvailable()</code> can be <code>true</code> while
          the ML Kit model still needs its first download. Await{" "}
          <code>prepareBuiltInModel()</code> once during setup; generating
          before it completes throws a typed <code>MODEL_NOT_DOWNLOADED</code>.
        </p>
      </Callout>

      <h2 id="generate">Generate</h2>
      <CodeBlock language="typescript">
        {`import { sendMessage } from 'expo-ai-kit';

const { text } = await sendMessage([
  { role: 'user', content: 'Explain local-first AI in one sentence.' },
]);`}
      </CodeBlock>

      <h2 id="stream">Stream</h2>
      <p>
        For a ChatGPT-style experience, stream tokens as they are produced. The
        handle&apos;s <code>promise</code> resolves with the final text and{" "}
        <code>stop()</code> ends the generation early with what was produced so
        far.
      </p>
      <CodeBlock language="typescript">
        {`import { streamMessage } from 'expo-ai-kit';

const { promise, stop } = streamMessage(
  [{ role: 'user', content: 'Write a very short story.' }],
  (event) => setText(event.accumulatedText) // event.token, event.isDone also available
);

const { text } = await promise;`}
      </CodeBlock>

      <h2 id="system-prompts">System prompts</h2>
      <p>
        Put a <code>system</code> message first in the array, or pass{" "}
        <code>systemPrompt</code> in the options, it is used only when the array
        has no system message.
      </p>
      <CodeBlock language="typescript">
        {`const { text } = await sendMessage(
  [{ role: 'user', content: 'Tell me a joke' }],
  { systemPrompt: 'You are a comedian who specializes in dad jokes.' }
);`}
      </CodeBlock>

      <h2 id="cancel">Cancellation</h2>
      <p>
        <code>sendMessage()</code> accepts an <code>AbortSignal</code>; aborting
        rejects with <code>INFERENCE_CANCELLED</code>. On-device, non-streaming
        generation cannot always be interrupted mid-decode, the caller is
        unblocked immediately, but the model may keep computing briefly (a new
        call throws <code>INFERENCE_BUSY</code> until it finishes). To truly
        interrupt a long generation, prefer <code>streamMessage().stop()</code>.
      </p>

      <h2 id="single-flight">One generation at a time</h2>
      <p>
        The device runs a single model context, so <code>sendMessage</code>,{" "}
        <code>streamMessage</code>, <code>generateObject</code>, and{" "}
        <code>generateText</code> share one guard: a second concurrent call
        rejects with <code>INFERENCE_BUSY</code>. Speech, vision, and embeddings
        have their own paths and never trip it, a voice → model → answer
        pipeline works as expected.
      </p>

      <h2 id="beyond-text">Beyond plain text</h2>
      <ul>
        <li>
          <Link href="/guides/structured-output" className="text-accent hover:underline">
            Structured Output
          </Link>:
          <code>generateObject()</code> returns a typed object validated
          against a JSON Schema, with a bounded repair loop.
        </li>
        <li>
          <Link href="/guides/tool-calling" className="text-accent hover:underline">
            Tool Calling
          </Link>:
          <code>generateText()</code> lets the model call functions you
          provide and answer from their results.
        </li>
        <li>
          <Link href="/guides/embeddings" className="text-accent hover:underline">
            Embeddings
          </Link>:
          retrieve the most relevant chunks of your own data and add them to
          the conversation.
        </li>
        <li>
          <Link href="/guides/vercel-ai-sdk" className="text-accent hover:underline">
            Vercel AI SDK
          </Link>:
          the same engine behind <code>generateText</code> /{" "}
          <code>streamText</code> from <code>ai</code>.
        </li>
      </ul>
    </DocsLayout>
  );
}
