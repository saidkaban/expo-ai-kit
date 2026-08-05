import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Multi-turn Conversations",
  "Build on-device chat experiences by owning and passing complete conversation history with expo-ai-kit.",
  "/guides/multi-turn"
);

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "how-it-works", text: "How It Works", level: 2 },
  { id: "system-prompts", text: "System Prompts", level: 2 },
  { id: "conversation-hook", text: "Conversation Hook", level: 2 },
  { id: "best-practices", text: "Best Practices", level: 2 },
];

export default function MultiTurnPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Multi-turn Conversations</h1>
      <p className="text-xl text-muted leading-relaxed">
        Build conversational AI that maintains context across multiple messages.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="overview">Overview</h2>
      <p>
        On-device models are <strong>stateless</strong> — they don&apos;t
        remember previous calls. You hold the conversation history in an array
        and pass the full history on every request. The model uses it to produce
        context-aware responses.
      </p>
      <ul>
        <li>
          <strong>Messages</strong> — the running history you pass to the AI
        </li>
        <li>
          <strong>System prompt</strong> — instructions that define behavior
        </li>
        <li>
          <strong>Context</strong> — the model sees every message you send
        </li>
      </ul>

      <h2 id="how-it-works">How It Works</h2>
      <p>
        Maintain an array of messages, append each turn, and pass it to{" "}
        <code>sendMessage()</code> (or <code>streamMessage()</code>).
      </p>

      <CodeBlock language="typescript">
        {`import { sendMessage, type LLMMessage } from 'expo-ai-kit';

const messages: LLMMessage[] = [];

// First turn
messages.push({ role: 'user', content: 'My name is Alex.' });
const r1 = await sendMessage(messages);
messages.push({ role: 'assistant', content: r1.text });
// AI: "Nice to meet you, Alex!"

// Second turn — the AI has context from the array
messages.push({ role: 'user', content: 'What is my name?' });
const r2 = await sendMessage(messages);
messages.push({ role: 'assistant', content: r2.text });
// AI: "Your name is Alex."`}
      </CodeBlock>

      <Callout type="info">
        <p>
          You own the history: append the user message before each call and the
          assistant&apos;s reply after it. The library adds no hidden state.
        </p>
      </Callout>

      <h2 id="system-prompts">System Prompts</h2>
      <p>
        A system prompt defines the AI&apos;s behavior and persona. Provide it
        two ways:
      </p>

      <h4>Option 1 — the systemPrompt option</h4>
      <CodeBlock language="typescript">
        {`const response = await sendMessage(
  [{ role: 'user', content: 'Tell me a joke' }],
  { systemPrompt: 'You are a comedian who specializes in dad jokes.' }
);`}
      </CodeBlock>

      <h4>Option 2 — a system message in the array</h4>
      <CodeBlock language="typescript">
        {`const response = await sendMessage([
  { role: 'system', content: 'You are a comedian who specializes in dad jokes.' },
  { role: 'user', content: 'Tell me a joke' },
]);`}
      </CodeBlock>

      <Callout type="info">
        <p>
          If a system message is present in the array, the{" "}
          <code>systemPrompt</code> option is ignored.
        </p>
      </Callout>

      <h2 id="conversation-hook">Conversation Hook</h2>
      <p>A reusable React hook for managing a multi-turn conversation:</p>

      <CodeBlock language="typescript" filename="hooks/useChat.ts">
        {`import { useState, useCallback } from 'react';
import { sendMessage, type LLMMessage } from 'expo-ai-kit';

export function useChat(systemPrompt?: string) {
  const [messages, setMessages] = useState<LLMMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const chat = useCallback(async (userMessage: string) => {
    setIsLoading(true);
    try {
      const next: LLMMessage[] = [
        ...messages,
        { role: 'user', content: userMessage },
      ];
      const response = await sendMessage(next, { systemPrompt });
      setMessages([...next, { role: 'assistant', content: response.text }]);
      return response.text;
    } finally {
      setIsLoading(false);
    }
  }, [messages, systemPrompt]);

  const clearChat = useCallback(() => setMessages([]), []);

  return { messages, isLoading, chat, clearChat };
}`}
      </CodeBlock>

      <h2 id="best-practices">Best Practices</h2>

      <h4>1. Trim long conversations</h4>
      <p>
        As history grows, drop the oldest turns to stay responsive and within the
        model&apos;s context window.
      </p>
      <CodeBlock language="typescript">
        {`const MAX_MESSAGES = 20;

function trim(messages: LLMMessage[]): LLMMessage[] {
  return messages.length <= MAX_MESSAGES ? messages : messages.slice(-MAX_MESSAGES);
}

const response = await sendMessage(trim(messages), { systemPrompt });`}
      </CodeBlock>

      <h4>2. Send messages sequentially</h4>
      <p>
        Only one generation runs at a time — a concurrent call rejects with{" "}
        <code>INFERENCE_BUSY</code>. Wait for each response before sending the
        next.
      </p>
      <CodeBlock language="typescript">
        {`// ❌ Bad — concurrent calls reject with INFERENCE_BUSY
await Promise.all([
  sendMessage([{ role: 'user', content: 'Question 1' }]),
  sendMessage([{ role: 'user', content: 'Question 2' }]),
]);

// ✅ Good — await each in turn
const r1 = await sendMessage([{ role: 'user', content: 'Question 1' }]);`}
      </CodeBlock>

      <h4>3. Always include the full history</h4>
      <p>
        For context-aware replies, pass the complete conversation — not just the
        latest message.
      </p>
      <CodeBlock language="typescript">
        {`// ❌ Loses context
await sendMessage([{ role: 'user', content: 'What did I just say?' }]);

// ✅ Includes history
await sendMessage([
  { role: 'user', content: 'My name is Alice.' },
  { role: 'assistant', content: 'Nice to meet you, Alice!' },
  { role: 'user', content: 'What is my name?' },
]);`}
      </CodeBlock>
    </DocsLayout>
  );
}
