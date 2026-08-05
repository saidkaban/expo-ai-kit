import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/Badge";

const headings = [
  { id: "common-issues", text: "Common Issues", level: 2 },
  {
    id: "isavailable-returns-false",
    text: "isAvailable() returns false",
    level: 3,
  },
  { id: "ios-specific", text: "iOS Troubleshooting", level: 2 },
  {
    id: "ai-not-available",
    text: "AI not available",
    level: 3,
  },
  { id: "fallback-responses", text: "Fallback responses", level: 3 },
  { id: "android-specific", text: "Android Troubleshooting", level: 2 },
  { id: "empty-responses", text: "Empty responses", level: 3 },
  { id: "model-downloading", text: "Model downloading", level: 3 },
  { id: "debugging-tips", text: "Debugging Tips", level: 2 },
  { id: "getting-help", text: "Getting Help", level: 2 },
];

export default function TroubleshootingPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Troubleshooting</h1>
      <p className="text-xl text-muted leading-relaxed">
        Solutions for common issues when working with expo-ai-kit.
      </p>

      <h2 id="common-issues">Common Issues</h2>

      <h3 id="isavailable-returns-false">isAvailable() returns false</h3>
      <p>
        If <code>isAvailable()</code> consistently returns <code>false</code>,
        check the platform-specific sections below for your device.
      </p>

      <CodeBlock language="typescript" filename="debug.ts">
        {`import { isAvailable } from 'expo-ai-kit';
import { Platform } from 'react-native';

async function debugAvailability() {
  console.log('Platform:', Platform.OS);
  console.log('OS Version:', Platform.Version);

  const available = await isAvailable();
  console.log('AI Available:', available);

  if (!available) {
    if (Platform.OS === 'ios') {
      console.log('Check: Running iOS 26.0+?');
      console.log('Check: Apple Intelligence enabled in Settings?');
    } else if (Platform.OS === 'android') {
      console.log('Check: Device supports ML Kit?');
      console.log('See: https://developers.google.com/ml-kit/genai#prompt-device');
    }
  }
}`}
      </CodeBlock>

      <hr />

      <h2 id="ios-specific">iOS Troubleshooting</h2>

      <h3 id="ai-not-available">
        <Badge platform="ios" /> AI not available
      </h3>
      <p>Ensure you&apos;re running iOS 26.0 or later on a supported device.</p>

      <Callout type="warning">
        <p>
          After enabling Apple Intelligence, the system may need to download
          models. This can take several minutes. <code>isAvailable()</code> will
          return <code>false</code> until the download completes.
        </p>
      </Callout>

      <h3 id="fallback-responses">
        <Badge platform="ios" /> Fallback responses
      </h3>
      <p>
        On iOS versions below 26, the module returns a fallback message. This
        allows you to develop and test your app on older devices while still
        building the UI.
      </p>

      <p>To detect this situation:</p>

      <CodeBlock language="typescript">
        {`import { Platform } from 'react-native';
import { isAvailable } from 'expo-ai-kit';

async function checkSupport() {
  const available = await isAvailable();

  if (Platform.OS === 'ios' && !available) {
    // On iOS < 26, responses will be fallback messages
    console.log('Running on older iOS - fallback responses enabled');
  }

  return available;
}`}
      </CodeBlock>

      <hr />

      <h2 id="android-specific">Android Troubleshooting</h2>

      <h3 id="empty-responses">
        <Badge platform="android" /> Empty responses
      </h3>
      <p>
        If <code>sendMessage()</code> returns an empty string, the device may not
        support ML Kit. Check the{" "}
        <a
          href="https://developers.google.com/ml-kit/genai#prompt-device"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          supported devices list
        </a>
        .
      </p>

      <CodeBlock language="typescript">
        {`import { isAvailable, sendMessage } from 'expo-ai-kit';

async function safeMessage(text: string) {
  const available = await isAvailable();

  if (!available) {
    console.log('Device does not support on-device AI');
    return null;
  }

  const response = await sendMessage([
    { role: 'user', content: text }
  ]);

  if (!response.text) {
    console.log('Received empty response - device may not be fully supported');
    return null;
  }

  return response.text;
}`}
      </CodeBlock>

      <h3 id="model-downloading">
        <Badge platform="android" /> Model downloading
      </h3>
      <p>
        On Android, the model may need to be downloaded on first use. Use{" "}
        <code>isAvailable()</code> to check status before making requests.
      </p>

      <Callout type="info">
        <p>
          The first request may take longer as the model downloads in the
          background. Subsequent requests will be faster.
        </p>
      </Callout>

      <hr />

      <h2 id="debugging-tips">Debugging Tips</h2>

      <ul>
        <li>
          <strong>Test incrementally</strong> — Start with simple prompts before
          complex multi-turn conversations.
        </li>
        <li>
          <strong>Monitor memory</strong> — AI models use significant memory.
          Watch for memory warnings in development.
        </li>
        <li>
          <strong>Test on real devices</strong> — Simulators and emulators may
          not fully support on-device AI features.
        </li>
        <li>
          <strong>Check platform logs</strong> — Review Xcode console (iOS) or
          Logcat (Android) for native errors.
        </li>
      </ul>

      <CodeBlock language="typescript" filename="logger.ts">
        {`// Create a debug wrapper
const DEBUG = __DEV__;

export function aiLog(...args: any[]) {
  if (DEBUG) {
    console.log('[expo-ai-kit]', ...args);
  }
}

// Usage
aiLog('Checking availability...');
const available = await isAvailable();
aiLog('Available:', available);`}
      </CodeBlock>

      <hr />

      <h2 id="getting-help">Getting Help</h2>
      <p>If you&apos;re still having issues:</p>

      <ol>
        <li>
          Check the{" "}
          <a
            href="https://github.com/saidkaban/expo-ai-kit/issues"
            className="text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Issues
          </a>{" "}
          for similar problems and solutions.
        </li>
        <li>
          When opening a new issue, include:
          <ul>
            <li>Device model and OS version</li>
            <li>expo-ai-kit version</li>
            <li>Expo SDK version</li>
            <li>Minimal code to reproduce the issue</li>
            <li>Full error message and stack trace</li>
          </ul>
        </li>
      </ol>

      <Callout type="success" title="Found a bug?">
        <p>
          We welcome bug reports and contributions! Please open an issue on{" "}
          <a
            href="https://github.com/saidkaban/expo-ai-kit"
            className="text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>{" "}
          with as much detail as possible.
        </p>
      </Callout>
    </DocsLayout>
  );
}
