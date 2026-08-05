import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Migration Guide",
  "Upgrade early expo-ai-kit applications from the session-based API to the current stateless conversation API.",
  "/guides/migration"
);

const headings = [
  { id: "breaking-changes", text: "Breaking Changes", level: 2 },
  { id: "api-changes", text: "API Changes", level: 3 },
  { id: "before-after", text: "Before & After", level: 2 },
  { id: "session-removal", text: "Session Removal", level: 3 },
  { id: "response-property", text: "Response Property", level: 3 },
  { id: "prepare-model-replacement", text: "Model Preparation", level: 3 },
];

export default function MigrationPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Migration from v0.1.4</h1>
      <p className="text-xl text-muted leading-relaxed">
        Guide for upgrading from expo-ai-kit v0.1.4 to the latest version.
      </p>

      <h2 id="breaking-changes">Breaking Changes</h2>
      <p>
        The latest version simplifies the API by removing sessions and
        streamlining the response format.
      </p>

      <h3 id="api-changes">API Changes</h3>
      <table>
        <thead>
          <tr>
            <th>Old API</th>
            <th>New API</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>sendPrompt(prompt)</code>
            </td>
            <td>
              <code>sendMessage([&#123; role: &apos;user&apos;, content: prompt &#125;])</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>createSession(options)</code>
            </td>
            <td>
              <strong>Removed</strong> &mdash; no longer needed
            </td>
          </tr>
          <tr>
            <td>
              <code>sendMessage(sessionId, messages, options)</code>
            </td>
            <td>
              <code>sendMessage(messages, options)</code> &mdash; no session ID
            </td>
          </tr>
          <tr>
            <td>
              <code>prepareModel(options)</code>
            </td>
            <td>
              <code>prepareBuiltInModel()</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>&#123; reply: string &#125;</code>
            </td>
            <td>
              <code>&#123; text: string &#125;</code>
            </td>
          </tr>
        </tbody>
      </table>

      <hr />

      <h2 id="before-after">Before &amp; After</h2>

      <h3 id="session-removal">Session Removal</h3>
      <p>
        Sessions have been removed entirely. You no longer need to create or
        manage session IDs.
      </p>

      <CodeBlock language="typescript" filename="Before (v0.1.4)">
        {`// Old API - required session management
const sessionId = await createSession({ systemPrompt: '...' });
const { reply } = await sendMessage(sessionId, messages, {});`}
      </CodeBlock>

      <CodeBlock language="typescript" filename="After (latest)">
        {`// New API - no sessions needed
const { text } = await sendMessage(messages, { systemPrompt: '...' });`}
      </CodeBlock>

      <h3 id="response-property">Response Property</h3>
      <p>
        The response property changed from <code>reply</code> to{" "}
        <code>text</code>.
      </p>

      <CodeBlock language="typescript" filename="Before (v0.1.4)">
        {`const response = await sendMessage(sessionId, messages, {});
console.log(response.reply);`}
      </CodeBlock>

      <CodeBlock language="typescript" filename="After (latest)">
        {`const response = await sendMessage(messages, { systemPrompt: '...' });
console.log(response.text);`}
      </CodeBlock>

      <h3 id="prepare-model-replacement">Model Preparation</h3>
      <p>
        The old configurable <code>prepareModel(options)</code> API was removed.
        Use <code>isAvailable()</code> to check device support, then await
        <code>prepareBuiltInModel()</code>. On Android it prepares the
        OS-managed ML Kit model; on iOS it validates Apple Foundation Models.
      </p>

      <CodeBlock language="typescript" filename="Before (v0.1.4)">
        {`await prepareModel({ modelName: 'default' });
const session = await createSession({ systemPrompt: '...' });`}
      </CodeBlock>

      <CodeBlock language="typescript" filename="After (latest)">
        {`const available = await isAvailable();
if (available) {
  await prepareBuiltInModel();
  const { text } = await sendMessage(messages, { systemPrompt: '...' });
}`}
      </CodeBlock>

      <Callout type="success" title="Simpler API">
        <p>
          The current API has no session IDs. Check support, prepare the
          built-in model once, and pass the full conversation to each request.
        </p>
      </Callout>
    </DocsLayout>
  );
}
