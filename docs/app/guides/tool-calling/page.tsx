import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import Link from "next/link";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Tool Calling",
  "Define typed functions that on-device models can request and execute through expo-ai-kit.",
  "/guides/tool-calling"
);

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "how-it-works", text: "How It Works", level: 2 },
  { id: "defining-tools", text: "Defining Tools", level: 2 },
  { id: "the-result", text: "The Result", level: 2 },
  { id: "human-in-the-loop", text: "Human in the Loop", level: 2 },
  { id: "reliability", text: "Reliability", level: 2 },
  { id: "error-handling", text: "Error Handling", level: 2 },
  { id: "tips", text: "Tips", level: 2 },
];

export default function ToolCallingPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Tool Calling</h1>
      <p className="text-xl text-muted leading-relaxed">
        Let the model call functions you provide, fetch data, take actions,
        and use the results to answer, all on-device with{" "}
        <code>generateText()</code>.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="overview">Overview</h2>
      <p>
        Where{" "}
        <Link href="/guides/structured-output" className="text-accent hover:underline">
          structured output
        </Link>{" "}
        gives you JSON as the final answer, tool calling is a loop: the model
        <em> proposes</em> a function call, your code runs it, the result is fed
        back, and the model continues, until it produces a plain-text answer.
        This is how you connect an on-device model to live data (weather, a
        database, search) or actions.
      </p>

      <h2 id="how-it-works">How It Works</h2>
      <p>
        <code>generateText()</code> drives the loop in JavaScript over{" "}
        <code>sendMessage()</code>, so it works on every backend and inherits the
        single-flight guard, <code>AbortSignal</code>, and{" "}
        <code>systemPrompt</code> semantics:
      </p>
      <ol>
        <li>The tool descriptions are added to the prompt.</li>
        <li>The model replies with a tool call, or with a plain-text answer.</li>
        <li>The proposed arguments are validated against the tool&apos;s schema.</li>
        <li>Your <code>execute</code> runs; its result is fed back into the conversation.</li>
        <li>Repeat until the model answers in plain text, or <code>maxSteps</code> (default 5) is reached.</li>
      </ol>

      <h2 id="defining-tools">Defining Tools</h2>
      <p>
        Each tool has a <code>description</code> (how the model decides when to
        use it), a JSON-Schema <code>parameters</code> object, and an{" "}
        <code>execute</code> function that receives the validated arguments.
      </p>

      <CodeBlock language="typescript" filename="weather.ts">
        {`import { generateText } from 'expo-ai-kit';

const { text } = await generateText(
  [{ role: 'user', content: 'What should I wear in Paris today?' }],
  {
    tools: {
      getWeather: {
        description: 'Get the current weather for a city.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
        execute: async ({ city }: { city: string }) => {
          const w = await fetchWeather(city);
          return { tempC: w.tempC, conditions: w.conditions };
        },
      },
    },
    maxSteps: 5,
  },
);

console.log(text); // "Bring a jacket and an umbrella, it's 12°C and raining."`}
      </CodeBlock>

      <h2 id="the-result">The Result</h2>
      <p>
        <code>generateText()</code> returns the final{" "}
        <code>text</code> plus a full trace, every <code>step</code>, all{" "}
        <code>toolCalls</code> and <code>toolResults</code>, and a{" "}
        <code>finishReason</code>.
      </p>

      <CodeBlock language="typescript">
        {`const res = await generateText(messages, { tools });

res.text;         // final assistant answer
res.steps;        // each model round-trip (text + toolCalls + toolResults)
res.toolCalls;    // every call across all steps, flattened
res.toolResults;  // every result, flattened
res.finishReason; // 'stop' | 'tool-calls' | 'max-steps'`}
      </CodeBlock>

      <ul>
        <li><code>&apos;stop&apos;</code>, the model produced a final text answer.</li>
        <li><code>&apos;tool-calls&apos;</code>, stopped because a tool has no <code>execute</code> (see below).</li>
        <li><code>&apos;max-steps&apos;</code>, hit the <code>maxSteps</code> cap while still calling tools; raise it.</li>
      </ul>

      <h2 id="human-in-the-loop">Human in the Loop</h2>
      <p>
        Omit a tool&apos;s <code>execute</code> and the loop stops the moment the
        model wants to call it, returning the proposed call instead of running
        anything. Use this to confirm or gate sensitive actions.
      </p>

      <CodeBlock language="typescript">
        {`const res = await generateText(messages, {
  tools: {
    deleteAccount: {
      description: 'Permanently delete the user account.',
      parameters: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
      // no execute, we want to confirm first
    },
  },
});

if (res.finishReason === 'tool-calls') {
  const call = res.toolCalls[0]; // { toolName, args }
  const ok = await confirmWithUser(call);
  if (ok) await reallyDelete(call.args);
}`}
      </CodeBlock>

      <h2 id="reliability">Reliability</h2>
      <p>
        On-device models are weaker at tool selection than frontier cloud
        models, so the loop is defensive. A malformed call, an unknown tool name,
        or arguments that fail schema validation are re-prompted with the error
        up to <code>maxRepairAttempts</code> times (default <code>2</code>). If
        the model still can&apos;t comply, <code>generateText()</code> throws
        rather than executing bad input. An <code>execute</code> that throws is
        caught and fed back to the model as <code>{`{ error }`}</code> so it can
        recover.
      </p>

      <Callout type="warning" title="Keep tool sets small">
        <p>
          Fewer tools with sharp, action-oriented descriptions and flat{" "}
          <code>parameters</code> dramatically improve tool selection on-device.
          Prefer a focused set over a large toolbox.
        </p>
      </Callout>

      <h2 id="error-handling">Error Handling</h2>
      <CodeBlock language="typescript">
        {`import { generateText, ModelError } from 'expo-ai-kit';

try {
  const { text } = await generateText(messages, { tools });
} catch (e) {
  if (e instanceof ModelError && e.code === 'INFERENCE_FAILED') {
    // Model kept proposing an unknown tool or invalid args after repairs.
  }
}`}
      </CodeBlock>

      <h2 id="tips">Tips</h2>
      <ul>
        <li>Set <code>maxSteps</code> high enough for the model to call tools <em>and</em> then answer (a typical task is 2 steps).</li>
        <li>Return small, plain results from <code>execute</code>, strings or shallow objects the model can read easily.</li>
        <li>With no <code>tools</code>, <code>generateText()</code> is just a single text generation.</li>
        <li>Validate again inside <code>execute</code> for anything destructive, schema validation guards shape, not intent.</li>
      </ul>

      <Callout type="success" title="Stable by design">
        <p>
          Like structured output, the protocol is parsed out of the model&apos;s
          text today, keeping the signature stable so native guided generation
          (Apple <code>Tool</code> protocol / LiteRT-LM) can slot in behind{" "}
          <code>generateText()</code> later.
        </p>
      </Callout>
    </DocsLayout>
  );
}
