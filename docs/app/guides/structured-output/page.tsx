import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import Link from "next/link";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Structured Output",
  "Generate typed, schema-validated objects locally with expo-ai-kit JSON extraction and repair loops.",
  "/guides/structured-output"
);

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "how-it-works", text: "How It Works", level: 2 },
  { id: "your-first-object", text: "Your First Object", level: 2 },
  { id: "the-schema", text: "The Schema", level: 2 },
  { id: "repair-retries", text: "Repair & Retries", level: 2 },
  { id: "error-handling", text: "Error Handling", level: 2 },
  { id: "tips", text: "Tips", level: 2 },
];

export default function StructuredOutputPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Structured Output</h1>
      <p className="text-xl text-muted leading-relaxed">
        Get a typed object back instead of a string. Describe the shape with a
        JSON Schema and <code>generateObject()</code> handles the rest.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="overview">Overview</h2>
      <p>
        <code>generateObject()</code> turns free-form model output into a
        validated, typed value. You pass a JSON Schema describing the shape you
        want; the model is prompted to produce it, the JSON is extracted and
        validated against the schema, and on a mismatch the error is fed back and
        the model is re-prompted. It works on every backend — Apple Foundation
        Models, ML Kit, and downloadable Gemma / Qwen / Phi.
      </p>

      <Callout type="info" title="When to use it">
        <p>
          Reach for <code>generateObject()</code> when the JSON{" "}
          <em>is</em> the answer — extraction, classification, or any
          &ldquo;give me X as a struct&rdquo; task. When you instead want the
          model to <em>call a function</em> and use the result, see{" "}
          <Link href="/guides/tool-calling" className="text-accent hover:underline">
            Tool Calling
          </Link>
          .
        </p>
      </Callout>

      <h2 id="how-it-works">How It Works</h2>
      <p>
        Structured output is orchestrated in JavaScript over{" "}
        <code>sendMessage()</code>, so it honors the same single-flight guard,{" "}
        <code>systemPrompt</code>, and <code>AbortSignal</code> semantics. Each
        call:
      </p>
      <ul>
        <li>Appends a strict JSON-Schema instruction to the system prompt</li>
        <li>Runs the model and extracts JSON from its output (tolerating prose and <code>```json</code> fences)</li>
        <li>Validates the value against a pragmatic subset of JSON Schema</li>
        <li>On a parse or schema mismatch, feeds the error back and re-prompts (up to <code>maxRepairAttempts</code>)</li>
      </ul>

      <h2 id="your-first-object">Your First Object</h2>
      <p>
        Pass the conversation and a schema. The result is{" "}
        <code>{`{ object, text }`}</code> — the validated value plus the raw
        output that produced it.
      </p>

      <CodeBlock language="typescript" filename="recipe.ts">
        {`import { generateObject } from 'expo-ai-kit';

type Recipe = { title: string; minutes: number; ingredients: string[] };

const { object } = await generateObject<Recipe>(
  [{ role: 'user', content: 'A quick weeknight pasta.' }],
  {
    type: 'object',
    properties: {
      title: { type: 'string' },
      minutes: { type: 'integer' },
      ingredients: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'minutes', 'ingredients'],
  },
);

object.title;       // string
object.minutes;     // number
object.ingredients; // string[]`}
      </CodeBlock>

      <h2 id="the-schema">The Schema</h2>
      <p>
        A pragmatic subset is enforced locally:{" "}
        <code>type</code>, <code>properties</code>, <code>required</code>,{" "}
        <code>items</code>, <code>enum</code>, and type unions. Other keywords
        you include (like <code>description</code> or <code>minLength</code>) are
        still sent to the model to guide it, but are not validated on-device.
      </p>

      <CodeBlock language="typescript">
        {`// enum + nested arrays + a passthrough description
const { object } = await generateObject(
  [{ role: 'user', content: 'Classify: "the package never arrived"' }],
  {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
      topics: { type: 'array', items: { type: 'string' } },
      urgent: { type: 'boolean', description: 'true if it needs a fast reply' },
    },
    required: ['sentiment', 'urgent'],
  },
);`}
      </CodeBlock>

      <Callout type="warning" title="Keep schemas small and shallow">
        <p>
          On-device models follow flat, shallow shapes far more reliably than
          deeply nested ones. Prefer a handful of top-level fields over deep
          object trees, and split complex extractions into multiple calls.
        </p>
      </Callout>

      <h2 id="repair-retries">Repair &amp; Retries</h2>
      <p>
        If the model returns invalid JSON or a value that violates the schema,
        the error is fed back and the model is asked to correct it — up to{" "}
        <code>maxRepairAttempts</code> times (default <code>2</code>, i.e. up to
        3 generations total). Lower it to fail fast, or raise it for stubborn
        schemas.
      </p>

      <CodeBlock language="typescript">
        {`const { object, text } = await generateObject(messages, schema, {
  maxRepairAttempts: 3,
  systemPrompt: 'You extract structured data from support tickets.',
});`}
      </CodeBlock>

      <h2 id="error-handling">Error Handling</h2>
      <p>
        If no schema-valid JSON is produced after the repair attempts,{" "}
        <code>generateObject()</code> throws a{" "}
        <code>ModelError</code> with code <code>INFERENCE_FAILED</code>. It also
        propagates <code>INFERENCE_BUSY</code> (a generation is already running)
        and <code>INFERENCE_CANCELLED</code> (the signal fired).
      </p>

      <CodeBlock language="typescript">
        {`import { generateObject, ModelError } from 'expo-ai-kit';

try {
  const { object } = await generateObject(messages, schema);
} catch (e) {
  if (e instanceof ModelError && e.code === 'INFERENCE_FAILED') {
    // Model couldn't produce valid JSON — fall back to plain text, or retry.
  }
}`}
      </CodeBlock>

      <h2 id="tips">Tips</h2>
      <ul>
        <li>Mark every field you truly need in <code>required</code> — optional fields are often omitted by small models.</li>
        <li>Use <code>enum</code> for classification — it constrains the model far better than a free-form string.</li>
        <li>Pass a focused <code>systemPrompt</code> describing the task; the schema instruction is appended to it automatically.</li>
        <li>Read <code>text</code> (the raw output) when debugging why a value didn&apos;t validate.</li>
      </ul>

      <Callout type="success" title="Stable by design">
        <p>
          The call signature is intentionally stable, so native constrained
          decoding (Apple guided generation / LiteRT-LM) can slot in behind{" "}
          <code>generateObject()</code> later with no change to your code.
        </p>
      </Callout>
    </DocsLayout>
  );
}
