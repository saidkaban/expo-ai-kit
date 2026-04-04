# expo-ai-kit

On-device AI for Expo apps. Run language models locally—no API keys, no cloud, just native intelligence.

**Now with Gemma 4 support** — Download and run Google's [Gemma 4](https://blog.google/technology/developers/gemma-4/) E2B (2.3B) and E4B (4.5B) models directly on Android devices via [LiteRT-LM](https://ai.google.dev/edge/litert-lm). Full on-device inference with GPU acceleration, streaming, and zero cloud dependency.

[![npm version](https://img.shields.io/npm/v/expo-ai-kit.svg)](https://www.npmjs.com/package/expo-ai-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Platform Support

### Supported

| Platform | Details |
|----------|---------|
| iOS 26+ | [Apple Foundation Models](https://developer.apple.com/documentation/FoundationModels) |
| Android (supported devices) | [ML Kit Prompt API](https://developers.google.com/ml-kit/genai#prompt-device) |

### Downloadable Models (Gemma 4)

| Platform | Status |
|----------|--------|
| Android | Gemma 4 E2B (2.3B) and E4B (4.5B) via [LiteRT-LM](https://ai.google.dev/edge/litert-lm) |
| iOS | Coming soon — waiting for LiteRT-LM Swift APIs from Google |

> **Note:** iOS downloadable model support (Gemma 4 E2B/E4B) is planned for a future release. We are waiting for Google to ship native Swift APIs for LiteRT-LM. Built-in Apple Foundation Models work on iOS 26+ today.

### Unsupported

| Platform | Fallback Behavior |
|----------|-------------------|
| iOS < 26 | Returns fallback message |
| Android (unsupported devices) | Returns empty string |

## Features

- **Privacy-first** — All inference happens on-device; no data leaves the user's device
- **Zero latency** — No network round-trips required
- **Free forever** — No API costs, rate limits, or subscriptions
- **Gemma 4 on-device** — Download and run Gemma 4 E2B/E4B models directly on Android with GPU acceleration
- **Native performance** — Built on Apple Foundation Models (iOS), ML Kit (Android), and LiteRT-LM (Gemma 4)
- **Multi-turn conversations** — Full conversation context support
- **Streaming support** — Progressive token streaming for responsive UIs
- **Simple API** — Core functions plus prompt helpers for common tasks
- **Prompt helpers** — Built-in `summarize()`, `translate()`, `rewrite()`, and more
- **Smart suggestions** — `suggest()`, `smartReply()`, and `autocomplete()` for predictive text
- **React Hooks** — `useChat`, `useCompletion`, and `useOnDeviceAI` for plug-and-play integration
- **Chat memory** — Built-in `ChatMemoryManager` for managing conversation history

## Requirements

- Expo SDK 54+
- **iOS:** iOS 26.0+ (full support), iOS 15.1+ (limited)
- **Android:** API 26+, [Supported devices](https://developers.google.com/ml-kit/genai#prompt-device)

## Installation

```bash
npx expo install expo-ai-kit
```

For bare React Native projects, run `npx pod-install` after installing.

### Android Configuration

For Android, ensure your `app.json` includes the minimum SDK version:

```json
{
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
}
```

## Quick Start

```tsx
import { isAvailable, sendMessage } from 'expo-ai-kit';

// Check if on-device AI is available
const available = await isAvailable();

if (available) {
  const response = await sendMessage([
    { role: 'user', content: 'Hello! What can you do?' }
  ]);
  console.log(response.text);
}
```

## Usage

### Simple Prompt

The simplest way to use on-device AI:

```tsx
import { isAvailable, sendMessage } from 'expo-ai-kit';

async function askAI(question: string) {
  const available = await isAvailable();

  if (!available) {
    console.log('On-device AI not available');
    return null;
  }

  const response = await sendMessage([
    { role: 'user', content: question }
  ]);
  return response.text;
}

const answer = await askAI('What is the capital of France?');
```

### With Custom System Prompt

Customize the AI's behavior with a system prompt:

```tsx
import { sendMessage } from 'expo-ai-kit';

const response = await sendMessage(
  [{ role: 'user', content: 'Tell me a joke' }],
  { systemPrompt: 'You are a comedian who specializes in dad jokes.' }
);

console.log(response.text);
```

### Multi-turn Conversations

For conversations with context, use `ChatMemoryManager` to manage history:

```tsx
import { ChatMemoryManager, streamMessage } from 'expo-ai-kit';

// Create a memory manager (handles history automatically)
const memory = new ChatMemoryManager({
  maxTurns: 10,
  systemPrompt: 'You are a helpful assistant.',
});

// Add user message and get response
memory.addUserMessage('My name is Alice.');
const { promise } = streamMessage(
  memory.getAllMessages(),
  (event) => console.log(event.accumulatedText)
);
const response = await promise;

// Store assistant response in memory
memory.addAssistantMessage(response.text);

// Continue the conversation (memory includes full history)
memory.addUserMessage('What is my name?');
const { promise: p2 } = streamMessage(
  memory.getAllMessages(),
  (event) => console.log(event.accumulatedText)
);
// Response: "Your name is Alice."
```

Or manually manage the conversation array:

```tsx
import { sendMessage, type LLMMessage } from 'expo-ai-kit';

const conversation: LLMMessage[] = [
  { role: 'user', content: 'My name is Alice.' },
  { role: 'assistant', content: 'Nice to meet you, Alice!' },
  { role: 'user', content: 'What is my name?' },
];

const response = await sendMessage(conversation, {
  systemPrompt: 'You are a helpful assistant.',
});

console.log(response.text); // "Your name is Alice."
```

### Streaming Responses

For a ChatGPT-like experience where text appears progressively:

```tsx
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
await promise;
```

### Prompt Helpers

Use built-in helpers for common AI tasks without crafting prompts:

```tsx
import { summarize, translate, rewrite, extractKeyPoints, answerQuestion } from 'expo-ai-kit';

// Summarize text
const summary = await summarize(longArticle, { length: 'short', style: 'bullets' });

// Translate text
const translated = await translate('Hello, world!', { to: 'Spanish' });

// Rewrite in a different style
const formal = await rewrite('hey whats up', { style: 'formal' });

// Extract key points
const points = await extractKeyPoints(article, { maxPoints: 5 });

// Answer questions about content
const answer = await answerQuestion('What is the main topic?', documentText);
```

### Smart Suggestions

Generate text completions, smart replies, and autocomplete suggestions — all on-device:

```tsx
import { suggest, smartReply, autocomplete } from 'expo-ai-kit';

// Text suggestions — continue partial text
const suggestions = await suggest('I think we should', {
  count: 3,
  tone: 'professional',
  context: 'team meeting notes'
});
suggestions.suggestions.forEach(s => console.log(s.text));
// "schedule a follow-up meeting to discuss next steps"
// "prioritize the Q2 deliverables before moving forward"
// "assign clear owners for each action item"

// Smart replies — Gmail/iMessage-style reply suggestions
const replies = await smartReply([
  { role: 'user', content: 'Hey, are you free for lunch tomorrow?' }
], { tone: 'friendly' });
replies.suggestions.forEach(s => console.log(s.text));
// "Sure, what time works for you?"
// "Sorry, I already have plans tomorrow."
// "Let me check my schedule and get back to you!"

// Autocomplete — short, instant completions for search bars and inputs
const completions = await autocomplete('How do I', {
  context: 'cooking app',
  maxWords: 8
});
completions.suggestions.forEach(s => console.log(s.text));
// "make pasta from scratch"
// "preheat the oven correctly"
// "chop onions without crying"
```

All smart suggestion functions also have streaming variants (`streamSuggest`, `streamSmartReply`, `streamAutocomplete`). Use `parseSuggestResponse()` to parse streaming results:

```tsx
const { promise } = streamSuggest(
  'The best way to',
  (event) => setRawText(event.accumulatedText),
  { count: 3 }
);
const result = await promise;
const parsed = parseSuggestResponse(result.text);
// parsed.suggestions = [{ text: "..." }, { text: "..." }, { text: "..." }]
```

All helpers also have streaming variants (`streamSummarize`, `streamTranslate`, etc.):

```tsx
const { promise, stop } = streamSummarize(
  longArticle,
  (event) => setSummary(event.accumulatedText),
  { style: 'bullets' }
);
```

### React Hooks

expo-ai-kit provides React hooks that handle state management, streaming, and conversation memory automatically.

#### `useChat` — Full Chat Interface

The easiest way to build a chat UI. Manages messages, input, streaming, and memory for you:

```tsx
import { useChat } from 'expo-ai-kit';

function ChatScreen() {
  const { messages, input, setInput, sendMessage, isStreaming, stop, clear, error } = useChat({
    systemPrompt: 'You are a helpful assistant.',
    maxTurns: 10,
  });

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={messages}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <Text>{item.role}: {item.content}</Text>
        )}
      />
      <TextInput value={input} onChangeText={setInput} />
      {isStreaming ? (
        <Button title="Stop" onPress={stop} />
      ) : (
        <Button title="Send" onPress={() => sendMessage()} />
      )}
      <Button title="Clear" onPress={clear} />
    </View>
  );
}
```

You can also send a message programmatically:

```tsx
// Send custom text instead of current input
sendMessage('What is the weather today?');
```

#### `useCompletion` — Single-shot Completions

For one-off tasks like summarization, translation, or content generation (no conversation history):

```tsx
import { useCompletion } from 'expo-ai-kit';

function Summarizer() {
  const { completion, isLoading, complete, stop, error } = useCompletion({
    systemPrompt: 'Summarize the given text concisely.',
  });

  return (
    <View>
      <Button
        title="Summarize"
        onPress={() => complete('Long article text here...')}
      />
      {isLoading && <Button title="Stop" onPress={stop} />}
      <Text>{completion}</Text>
    </View>
  );
}
```

#### `useOnDeviceAI` — Availability Check

A simple hook to check if on-device AI is available, with caching across components:

```tsx
import { useOnDeviceAI } from 'expo-ai-kit';

function App() {
  const { isAvailable, isChecking } = useOnDeviceAI();

  if (isChecking) return <Text>Checking AI availability...</Text>;
  if (!isAvailable) return <Text>On-device AI not available</Text>;

  return <ChatScreen />;
}
```

---

### Streaming with Cancel Button

```tsx
import { useState, useRef } from 'react';
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
}
```

### Complete Chat Example

Here's a full cross-platform chat component:

```tsx
import React, { useState, useEffect } from 'react';
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

    const userMessage: LLMMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await sendMessage(newMessages, {
        systemPrompt: 'You are a helpful assistant.',
      });
      setMessages(prev => [...prev, { role: 'assistant', content: response.text }]);
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
}
```

## API Reference

### `isAvailable()`

Checks if on-device AI is available on the current device.

```typescript
function isAvailable(): Promise<boolean>
```

**Returns:** `Promise<boolean>` — `true` if on-device AI is supported and ready

---

### `sendMessage(messages, options?)`

Sends a conversation and gets a response from the on-device model.

```typescript
function sendMessage(messages: LLMMessage[], options?: LLMSendOptions): Promise<LLMResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `messages` | `LLMMessage[]` | Array of conversation messages |
| `options.systemPrompt` | `string` | Fallback system prompt (ignored if messages contain a system message) |

**Returns:** `Promise<LLMResponse>` — Object with `text` property containing the response

**Example:**
```tsx
const response = await sendMessage([
  { role: 'system', content: 'You are a pirate.' },
  { role: 'user', content: 'Hello!' },
]);
console.log(response.text); // "Ahoy, matey!"
```

---

### `streamMessage(messages, onToken, options?)`

Streams a conversation response with progressive token updates. Ideal for responsive chat UIs.

```typescript
function streamMessage(
  messages: LLMMessage[],
  onToken: LLMStreamCallback,
  options?: LLMStreamOptions
): { promise: Promise<LLMResponse>; stop: () => void }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `messages` | `LLMMessage[]` | Array of conversation messages |
| `onToken` | `LLMStreamCallback` | Callback called for each token received |
| `options.systemPrompt` | `string` | Fallback system prompt (ignored if messages contain a system message) |

**Returns:** Object with:
- `promise: Promise<LLMResponse>` — Resolves when streaming completes
- `stop: () => void` — Function to cancel the stream

**Example:**
```tsx
const { promise, stop } = streamMessage(
  [{ role: 'user', content: 'Hello!' }],
  (event) => {
    console.log(event.token);           // New token: "Hi"
    console.log(event.accumulatedText); // Full text: "Hi there!"
    console.log(event.isDone);          // false until complete
  }
);

// Cancel if needed
setTimeout(() => stop(), 5000);

// Wait for completion
const response = await promise;
```

---

### `summarize(text, options?)`

Summarizes text using on-device AI.

```typescript
function summarize(text: string, options?: LLMSummarizeOptions): Promise<LLMResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to summarize |
| `options.length` | `'short' \| 'medium' \| 'long'` | Summary length (default: `'medium'`) |
| `options.style` | `'paragraph' \| 'bullets' \| 'tldr'` | Output format (default: `'paragraph'`) |

**Streaming:** `streamSummarize(text, onToken, options?)`

---

### `translate(text, options)`

Translates text to another language.

```typescript
function translate(text: string, options: LLMTranslateOptions): Promise<LLMResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to translate |
| `options.to` | `string` | Target language (required) |
| `options.from` | `string` | Source language (auto-detected if omitted) |
| `options.tone` | `'formal' \| 'informal' \| 'neutral'` | Translation tone (default: `'neutral'`) |

**Streaming:** `streamTranslate(text, onToken, options)`

---

### `rewrite(text, options)`

Rewrites text in a different style.

```typescript
function rewrite(text: string, options: LLMRewriteOptions): Promise<LLMResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to rewrite |
| `options.style` | `string` | Target style (required) |

**Available styles:** `'formal'`, `'casual'`, `'professional'`, `'friendly'`, `'concise'`, `'detailed'`, `'simple'`, `'academic'`

**Streaming:** `streamRewrite(text, onToken, options)`

---

### `extractKeyPoints(text, options?)`

Extracts key points from text as bullet points.

```typescript
function extractKeyPoints(text: string, options?: LLMExtractKeyPointsOptions): Promise<LLMResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to analyze |
| `options.maxPoints` | `number` | Maximum points to extract (default: `5`) |

**Streaming:** `streamExtractKeyPoints(text, onToken, options?)`

---

### `answerQuestion(question, context, options?)`

Answers a question based on provided context.

```typescript
function answerQuestion(question: string, context: string, options?: LLMAnswerQuestionOptions): Promise<LLMResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `question` | `string` | Question to answer |
| `context` | `string` | Context/document to base answer on |
| `options.detail` | `'brief' \| 'medium' \| 'detailed'` | Answer detail level (default: `'medium'`) |

**Streaming:** `streamAnswerQuestion(question, context, onToken, options?)`

---

### `suggest(partialText, options?)`

Generates text continuation suggestions based on partial input.

```typescript
function suggest(partialText: string, options?: LLMSuggestOptions): Promise<LLMSuggestResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `partialText` | `string` | The text the user has typed so far |
| `options.count` | `number` | Number of suggestions (default: `3`) |
| `options.context` | `string` | Optional context to inform suggestions |
| `options.tone` | `'formal' \| 'casual' \| 'professional' \| 'friendly' \| 'neutral'` | Tone of suggestions (default: `'neutral'`) |

**Returns:** `Promise<LLMSuggestResponse>` — Object with `suggestions` array and `raw` text

**Streaming:** `streamSuggest(partialText, onToken, options?)`

---

### `smartReply(messages, options?)`

Generates contextually appropriate reply suggestions for a conversation, similar to Gmail or iMessage smart replies.

```typescript
function smartReply(messages: LLMMessage[], options?: LLMSmartReplyOptions): Promise<LLMSuggestResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `messages` | `LLMMessage[]` | Conversation history to generate replies for |
| `options.count` | `number` | Number of reply suggestions (default: `3`) |
| `options.tone` | `'formal' \| 'casual' \| 'professional' \| 'friendly' \| 'neutral'` | Reply tone (default: `'neutral'`) |
| `options.persona` | `string` | Optional persona for the replier (e.g., `'customer support agent'`) |

**Returns:** `Promise<LLMSuggestResponse>` — Object with `suggestions` array and `raw` text

**Streaming:** `streamSmartReply(messages, onToken, options?)`

---

### `autocomplete(partialText, options?)`

Generates short, natural completions for the user's current text. Ideal for search bars, form fields, and real-time typing suggestions.

```typescript
function autocomplete(partialText: string, options?: LLMAutocompleteOptions): Promise<LLMSuggestResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `partialText` | `string` | The text the user has typed so far |
| `options.count` | `number` | Number of completions (default: `3`) |
| `options.maxWords` | `number` | Maximum words per completion (default: `10`) |
| `options.context` | `string` | Optional context to inform completions |

**Returns:** `Promise<LLMSuggestResponse>` — Object with `suggestions` array and `raw` text

**Streaming:** `streamAutocomplete(partialText, onToken, options?)`

---

### `parseSuggestResponse(raw)`

Parses raw text from streaming suggestion responses into structured suggestions.

```typescript
function parseSuggestResponse(raw: string): LLMSuggestResponse
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `raw` | `string` | Raw text response from the model |

**Returns:** `LLMSuggestResponse` — Object with `suggestions` array and `raw` text

---

### `useChat(options?)`

React hook for building chat interfaces. Manages messages, input, streaming, and conversation memory automatically.

```typescript
function useChat(options?: UseChatOptions): UseChatReturn
```

| Option | Type | Description |
|--------|------|-------------|
| `systemPrompt` | `string` | System prompt for the AI assistant |
| `maxTurns` | `number` | Maximum conversation turns to keep in memory (default: `10`) |
| `initialMessages` | `LLMMessage[]` | Initial messages to populate the chat |
| `onFinish` | `(response: LLMResponse) => void` | Callback when a response is complete |
| `onError` | `(error: Error) => void` | Callback when an error occurs |

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `LLMMessage[]` | All messages in the conversation |
| `input` | `string` | Current input text value |
| `setInput` | `(input: string) => void` | Set the input text value |
| `sendMessage` | `(text?: string) => Promise<void>` | Send the current input (or provided text) |
| `isStreaming` | `boolean` | Whether the AI is currently streaming |
| `stop` | `() => void` | Stop the current streaming response |
| `clear` | `() => void` | Clear all messages and reset |
| `error` | `Error \| null` | The most recent error, if any |

---

### `useCompletion(options?)`

React hook for single-shot AI completions (summarization, translation, etc.).

```typescript
function useCompletion(options?: UseCompletionOptions): UseCompletionReturn
```

| Option | Type | Description |
|--------|------|-------------|
| `systemPrompt` | `string` | System prompt for the AI |
| `onFinish` | `(response: LLMResponse) => void` | Callback when completion is done |
| `onError` | `(error: Error) => void` | Callback when an error occurs |

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `completion` | `string` | The current completion text |
| `isLoading` | `boolean` | Whether a completion is in progress |
| `complete` | `(prompt: string) => Promise<string>` | Request a completion |
| `stop` | `() => void` | Stop the current completion |
| `error` | `Error \| null` | The most recent error, if any |

---

### `useOnDeviceAI()`

React hook to check if on-device AI is available. Caches the result across components.

```typescript
function useOnDeviceAI(): UseOnDeviceAIReturn
```

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `isAvailable` | `boolean` | Whether on-device AI is available |
| `isChecking` | `boolean` | Whether the check is still in progress |

---

### `ChatMemoryManager`

Manages conversation history for stateless on-device AI models. Automatically handles turn limits and provides the full message array for each request.

```typescript
class ChatMemoryManager {
  constructor(options?: ChatMemoryOptions);

  addUserMessage(content: string): void;
  addAssistantMessage(content: string): void;
  addMessage(message: LLMMessage): void;

  getAllMessages(): LLMMessage[];
  getMessages(): LLMMessage[];
  getPrompt(): string;
  getSnapshot(): ChatMemorySnapshot;
  getTurnCount(): number;

  setSystemPrompt(prompt: string | undefined): void;
  getSystemPrompt(): string | undefined;
  setMaxTurns(maxTurns: number): void;

  clear(): void;
  reset(): void;
}
```

| Option | Type | Description |
|--------|------|-------------|
| `maxTurns` | `number` | Maximum conversation turns to keep (default: `10`) |
| `systemPrompt` | `string` | System prompt to include in every request |

**Why use ChatMemoryManager?**

On-device models are stateless — they have no built-in memory. Each request must include the full conversation history. `ChatMemoryManager` handles this automatically:

- Stores messages client-side
- Automatically trims old messages when limit is reached
- Preserves the system prompt (never trimmed)
- Provides `getAllMessages()` for API calls

**Example with React:**

```tsx
import { useRef } from 'react';
import { ChatMemoryManager, streamMessage } from 'expo-ai-kit';

function Chat() {
  const memoryRef = useRef(new ChatMemoryManager({
    maxTurns: 10,
    systemPrompt: 'You are a helpful assistant.',
  }));

  const sendMessage = async (text: string) => {
    memoryRef.current.addUserMessage(text);

    const { promise } = streamMessage(
      memoryRef.current.getAllMessages(),
      (event) => setResponse(event.accumulatedText)
    );

    const response = await promise;
    memoryRef.current.addAssistantMessage(response.text);
  };

  const clearChat = () => memoryRef.current.clear();
}
```

---

### `buildPrompt(messages)`

Converts a message array to a single prompt string. Useful for debugging or custom implementations.

```typescript
function buildPrompt(messages: LLMMessage[]): string
```

**Example:**
```tsx
import { buildPrompt } from 'expo-ai-kit';

const prompt = buildPrompt([
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hi!' },
  { role: 'assistant', content: 'Hello!' },
]);
// "SYSTEM: You are helpful.\nUSER: Hi!\nASSISTANT: Hello!"
```

---

### Types

```typescript
type LLMRole = 'system' | 'user' | 'assistant';

type LLMMessage = {
  role: LLMRole;
  content: string;
};

type LLMSendOptions = {
  /** Fallback system prompt if no system message in messages array */
  systemPrompt?: string;
};

type LLMStreamOptions = {
  /** Fallback system prompt if no system message in messages array */
  systemPrompt?: string;
};

type LLMResponse = {
  /** The generated response text */
  text: string;
};

type LLMStreamEvent = {
  /** Unique identifier for this streaming session */
  sessionId: string;
  /** The token/chunk of text received */
  token: string;
  /** Accumulated text so far */
  accumulatedText: string;
  /** Whether this is the final chunk */
  isDone: boolean;
};

type LLMStreamCallback = (event: LLMStreamEvent) => void;

// Prompt Helper Types
type LLMSummarizeOptions = {
  length?: 'short' | 'medium' | 'long';
  style?: 'paragraph' | 'bullets' | 'tldr';
};

type LLMTranslateOptions = {
  to: string;
  from?: string;
  tone?: 'formal' | 'informal' | 'neutral';
};

type LLMRewriteOptions = {
  style: 'formal' | 'casual' | 'professional' | 'friendly' | 'concise' | 'detailed' | 'simple' | 'academic';
};

type LLMExtractKeyPointsOptions = {
  maxPoints?: number;
};

type LLMAnswerQuestionOptions = {
  detail?: 'brief' | 'medium' | 'detailed';
};

// Smart Suggestions Types
type LLMSuggestOptions = {
  count?: number;
  context?: string;
  tone?: 'formal' | 'casual' | 'professional' | 'friendly' | 'neutral';
};

type LLMSmartReplyOptions = {
  count?: number;
  tone?: 'formal' | 'casual' | 'professional' | 'friendly' | 'neutral';
  persona?: string;
};

type LLMAutocompleteOptions = {
  count?: number;
  maxWords?: number;
  context?: string;
};

type LLMSuggestion = {
  text: string;
};

type LLMSuggestResponse = {
  suggestions: LLMSuggestion[];
  raw: string;
};

// Hook Types
type UseChatOptions = {
  systemPrompt?: string;
  maxTurns?: number;
  initialMessages?: LLMMessage[];
  onFinish?: (response: LLMResponse) => void;
  onError?: (error: Error) => void;
};

type UseChatReturn = {
  messages: LLMMessage[];
  input: string;
  setInput: (input: string) => void;
  sendMessage: (text?: string) => Promise<void>;
  isStreaming: boolean;
  stop: () => void;
  clear: () => void;
  error: Error | null;
};

type UseCompletionOptions = {
  systemPrompt?: string;
  onFinish?: (response: LLMResponse) => void;
  onError?: (error: Error) => void;
};

type UseCompletionReturn = {
  completion: string;
  isLoading: boolean;
  complete: (prompt: string) => Promise<string>;
  stop: () => void;
  error: Error | null;
};

type UseOnDeviceAIReturn = {
  isAvailable: boolean;
  isChecking: boolean;
};

// Chat Memory Types
type ChatMemoryOptions = {
  /** Maximum conversation turns to keep (default: 10) */
  maxTurns?: number;
  /** System prompt to include in every request */
  systemPrompt?: string;
};

type ChatMemorySnapshot = {
  messages: LLMMessage[];
  systemPrompt: string | undefined;
  turnCount: number;
  maxTurns: number;
};
```

## Feature Comparison

| Feature | iOS 26+ | Android (Supported) |
|---------|---------|---------------------|
| `isAvailable()` | ✅ | ✅ |
| `sendMessage()` | ✅ | ✅ |
| `streamMessage()` | ✅ | ✅ |
| Prompt helpers | ✅ | ✅ |
| Smart suggestions | ✅ | ✅ |
| `ChatMemoryManager` | ✅ | ✅ |
| React Hooks (`useChat`, etc.) | ✅ | ✅ |
| System prompts | ✅ Native | ✅ Prepended |
| Multi-turn context | ✅ | ✅ |
| Cancel streaming | ✅ | ✅ |

## How It Works

### iOS
Uses Apple's Foundation Models framework introduced in iOS 26. The on-device language model runs entirely locally with no internet connection required.

### Android
Uses Google's ML Kit Prompt API. The model may need to be downloaded on first use on supported devices. Check [supported devices](https://developers.google.com/ml-kit/genai#prompt-device) for compatibility.

## Troubleshooting

### iOS
- **AI not available**: Ensure you're running iOS 26.0 or later on a supported device
- **Fallback responses**: On iOS < 26, the module returns a fallback message

### Android
- **Empty responses**: The device may not support ML Kit Prompt API. Check the [supported devices list](https://developers.google.com/ml-kit/genai#prompt-device)
- **Model downloading**: On first use, the model may need to download. Use `isAvailable()` to check status

## Migration from v0.1.4

If you're upgrading from an earlier version, here are the breaking changes:

| Old API | New API |
|---------|---------|
| `sendPrompt(prompt)` | `sendMessage([{ role: 'user', content: prompt }])` |
| `createSession(options)` | **Removed** — no longer needed |
| `sendMessage(sessionId, messages, options)` | `sendMessage(messages, options)` — no session ID |
| `prepareModel(options)` | **Removed** |
| `{ reply: string }` | `{ text: string }` |

**Before:**
```tsx
const sessionId = await createSession({ systemPrompt: '...' });
const { reply } = await sendMessage(sessionId, messages, {});
```

**After:**
```tsx
const { text } = await sendMessage(messages, { systemPrompt: '...' });
```

## Roadmap

| Feature | Status | Priority |
|---------|--------|----------|
| ✅ Streaming responses | Done | - |
| ✅ Prompt helpers (summarize, translate, etc.) | Done | - |
| ✅ Chat memory management | Done | - |
| ✅ Smart suggestions (suggest, smartReply, autocomplete) | Done | - |
| ✅ React Hooks (useChat, useCompletion, useOnDeviceAI) | Done | - |
| Web/generic fallback | Idea | Medium |
| Configurable hyperparameters (temperature, etc.) | Idea | Low |

Have a feature request? [Open an issue](https://github.com/saidkaban/expo-ai-kit/issues)!

## License

MIT

## Contributing

Contributions are welcome! Please refer to guidelines described in the [contributing guide](https://github.com/expo/expo#contributing).

## Links

- [Documentation](https://expo-ai-kit.com)
- [npm package](https://www.npmjs.com/package/expo-ai-kit)
- [GitHub repository](https://github.com/saidkaban/expo-ai-kit)
- [Apple Foundation Models](https://developer.apple.com/documentation/foundationmodels)
- [Google ML Kit Prompt API](https://developers.google.com/ml-kit/genai)
