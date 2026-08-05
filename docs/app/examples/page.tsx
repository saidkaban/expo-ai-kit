import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";

const headings = [
  { id: "complete-chat-example", text: "Complete Chat Example", level: 2 },
  { id: "structured-output", text: "Structured Output", level: 2 },
  { id: "tool-calling", text: "Tool Calling", level: 2 },
  { id: "streaming-with-cancel", text: "Streaming with Cancel Button", level: 2 },
  { id: "downloadable-model", text: "Download & Switch Models", level: 2 },
  { id: "error-handling", text: "Error Handling", level: 2 },
];

export default function ExamplesPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Examples</h1>
      <p className="text-xl text-muted leading-relaxed">
        Complete code examples showing how to integrate expo-ai-kit into real
        applications.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="complete-chat-example">Complete Chat Example</h2>
      <p>A full cross-platform chat component, tracking history yourself:</p>

      <CodeBlock language="typescript" filename="ChatScreen.tsx" showLineNumbers>
        {`import React, { useState, useEffect } from 'react';
import { View, TextInput, Button, Text, FlatList } from 'react-native';
import { isAvailable, sendMessage, type LLMMessage } from 'expo-ai-kit';

export default function ChatScreen() {
  const [messages, setMessages] = useState<LLMMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    isAvailable().then(setAvailable);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || loading || !available) return;

    const next: LLMMessage[] = [...messages, { role: 'user', content: input.trim() }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const response = await sendMessage(next, {
        systemPrompt: 'You are a helpful assistant.',
      });
      setMessages([...next, { role: 'assistant', content: response.text }]);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!available) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>On-device AI is not available on this device</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={messages}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <View style={{
            padding: 12,
            marginVertical: 4,
            backgroundColor: item.role === 'user' ? '#007AFF' : '#E5E5EA',
            borderRadius: 16,
            alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
          }}>
            <Text style={{ color: item.role === 'user' ? '#fff' : '#000' }}>
              {item.content}
            </Text>
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          style={{ flex: 1, borderWidth: 1, borderRadius: 8, padding: 12 }}
        />
        <Button title={loading ? '...' : 'Send'} onPress={handleSend} />
      </View>
    </View>
  );
}`}
      </CodeBlock>

      <hr />

      <h2 id="structured-output">Structured Output</h2>
      <p>
        Extract a typed object from free text with a JSON Schema. See the{" "}
        <a href="/guides/structured-output" className="text-accent hover:underline">
          Structured Output guide
        </a>
        .
      </p>

      <CodeBlock language="typescript" filename="extract.ts">
        {`import { generateObject } from 'expo-ai-kit';

type Ticket = {
  sentiment: 'positive' | 'neutral' | 'negative';
  topics: string[];
  urgent: boolean;
};

const { object } = await generateObject<Ticket>(
  [{ role: 'user', content: 'The app keeps crashing on launch and I am furious.' }],
  {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
      topics: { type: 'array', items: { type: 'string' } },
      urgent: { type: 'boolean' },
    },
    required: ['sentiment', 'urgent'],
  },
);

console.log(object.sentiment); // "negative"
console.log(object.urgent);    // true`}
      </CodeBlock>

      <hr />

      <h2 id="tool-calling">Tool Calling</h2>
      <p>
        Let the model call a function and answer from the result. See the{" "}
        <a href="/guides/tool-calling" className="text-accent hover:underline">
          Tool Calling guide
        </a>
        .
      </p>

      <CodeBlock language="typescript" filename="assistant.ts">
        {`import { generateText } from 'expo-ai-kit';

const { text, toolCalls } = await generateText(
  [{ role: 'user', content: 'Is it jacket weather in Paris right now?' }],
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
          const res = await fetch(\`https://api.example.com/weather?city=\${city}\`);
          return res.json(); // { tempC, conditions }
        },
      },
    },
    maxSteps: 5,
  },
);

console.log(toolCalls); // [{ toolName: 'getWeather', args: { city: 'Paris' } }]
console.log(text);      // "Yes — it's 11°C and overcast, bring a jacket."`}
      </CodeBlock>

      <hr />

      <h2 id="streaming-with-cancel">Streaming with Cancel Button</h2>
      <p>A streaming component with a stop button:</p>

      <CodeBlock language="typescript" filename="ChatWithStreaming.tsx" showLineNumbers>
        {`import { useState, useRef } from 'react';
import { View, Text, Button } from 'react-native';
import { streamMessage } from 'expo-ai-kit';

function ChatWithStreaming() {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const handleSend = async () => {
    setIsStreaming(true);
    setText('');

    const { promise, stop } = streamMessage(
      [{ role: 'user', content: 'Write a long story' }],
      (event) => setText(event.accumulatedText)
    );

    stopRef.current = stop;
    await promise;
    stopRef.current = null;
    setIsStreaming(false);
  };

  const handleStop = () => {
    stopRef.current?.();
    setIsStreaming(false);
  };

  return (
    <View>
      <Text>{text}</Text>
      {isStreaming ? (
        <Button title="Stop" onPress={handleStop} />
      ) : (
        <Button title="Send" onPress={handleSend} />
      )}
    </View>
  );
}`}
      </CodeBlock>

      <hr />

      <h2 id="downloadable-model">Download &amp; Switch Models</h2>
      <p>
        Pick the best model the device can run, download it with progress, and
        activate it. See the{" "}
        <a href="/guides/models" className="text-accent hover:underline">
          Models guide
        </a>
        .
      </p>

      <CodeBlock language="typescript" filename="setupModel.ts">
        {`import {
  getRecommendedModel,
  downloadModel,
  setModel,
  type DownloadableModel,
} from 'expo-ai-kit';

export async function setupBestModel(onProgress: (p: number) => void) {
  const best: DownloadableModel | null = await getRecommendedModel();
  if (!best) return null; // device can't run any downloadable model

  if (best.status !== 'downloaded' && best.status !== 'ready') {
    await downloadModel(best.id, { onProgress });
  }

  await setModel(best.id, { generation: { temperature: 0.7 } });
  return best.id; // sendMessage / generateObject / generateText now use it
}`}
      </CodeBlock>

      <hr />

      <h2 id="error-handling">Error Handling</h2>
      <p>Branch on the typed error code for robust production behavior:</p>

      <CodeBlock language="typescript" filename="utils/ai.ts">
        {`import { isAvailable, sendMessage, ModelError, type LLMMessage } from 'expo-ai-kit';

export async function safeAIRequest(messages: LLMMessage[], systemPrompt?: string) {
  if (!(await isAvailable())) {
    return { success: false as const, error: 'On-device AI is not available' };
  }

  try {
    const { text } = await sendMessage(messages, { systemPrompt });
    return { success: true as const, result: text };
  } catch (e) {
    if (e instanceof ModelError) {
      // e.code: 'INFERENCE_BUSY' | 'INFERENCE_OOM' | 'MODEL_NOT_DOWNLOADED' | ...
      return { success: false as const, error: \`\${e.code}: \${e.message}\` };
    }
    return { success: false as const, error: 'Unknown error' };
  }
}`}
      </CodeBlock>

      <Callout type="info">
        <p>
          These examples demonstrate patterns, not complete apps. Adapt them to
          your UI framework and state management.
        </p>
      </Callout>
    </DocsLayout>
  );
}
