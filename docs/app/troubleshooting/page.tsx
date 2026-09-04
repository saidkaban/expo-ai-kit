import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/Badge";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Troubleshooting",
  "Diagnose expo-ai-kit setup, device support, opt-in feature flags, model downloads, vision and speech errors, native builds, and inference failures.",
  "/troubleshooting"
);

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
  { id: "older-ios", text: "Older iOS versions", level: 3 },
  { id: "android-specific", text: "Android Troubleshooting", level: 2 },
  { id: "device-not-supported", text: "DEVICE_NOT_SUPPORTED", level: 3 },
  { id: "model-not-downloaded", text: "MODEL_NOT_DOWNLOADED", level: 3 },
  { id: "not-enabled", text: "*_NOT_ENABLED (feature flags)", level: 2 },
  { id: "vision-errors", text: "Vision", level: 2 },
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

      <h3 id="older-ios">
        <Badge platform="ios" /> Older iOS versions
      </h3>
      <p>
        On iOS versions below 26 there is no built-in text model:{" "}
        <code>isAvailable()</code> returns <code>false</code> and generation
        throws a typed <code>DEVICE_NOT_SUPPORTED</code> error. Vision (iOS 17+
        for background removal), embeddings (iOS 17+), and downloadable models
        still work there, so you can design the UI around the missing built-in.
      </p>

      <p>To detect this situation:</p>

      <CodeBlock language="typescript">
        {`import { Platform } from 'react-native';
import { isAvailable } from 'expo-ai-kit';

async function checkSupport() {
  const available = await isAvailable();

  if (Platform.OS === 'ios' && !available) {
    // On iOS < 26, generation calls throw a typed DEVICE_NOT_SUPPORTED error
    console.log('Running on older iOS - on-device generation unavailable');
  }

  return available;
}`}
      </CodeBlock>

      <hr />

      <h2 id="android-specific">Android Troubleshooting</h2>

      <h3 id="device-not-supported">
        <Badge platform="android" /> <Badge platform="ios" /> DEVICE_NOT_SUPPORTED
      </h3>
      <p>
        The built-in Android model throws a typed
        <code>DEVICE_NOT_SUPPORTED</code> error when ML Kit cannot run on the
        device. iOS throws the same code below iOS 26 or when Apple Intelligence
        is disabled, and unsupported platforms (web) throw it for all generation
        calls. Check the{" "}
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
        {`import {
  isAvailable,
  prepareBuiltInModel,
  sendMessage,
  ModelError,
} from 'expo-ai-kit';

async function safeMessage(text: string) {
  const supported = await isAvailable();

  if (!supported) {
    console.log('Device does not support on-device AI');
    return null;
  }

  try {
    await prepareBuiltInModel();
    const response = await sendMessage([
      { role: 'user', content: text }
    ]);
    return response.text;
  } catch (error) {
    if (error instanceof ModelError) {
      console.error(error.code, error.modelId, error.message);
    }
    throw error;
  }
}`}
      </CodeBlock>

      <h3 id="model-not-downloaded">
        <Badge platform="android" /> <Badge platform="ios" /> MODEL_NOT_DOWNLOADED
      </h3>
      <p>
        On Android, <code>isAvailable()</code> can return <code>true</code> while
        the supported model still needs its first-use download. Await
        <code>prepareBuiltInModel()</code> before inference. On iOS, the same
        error is thrown for <code>apple-fm</code> while the OS is still preparing
        the Apple Intelligence model assets, retry after the OS finishes.
      </p>

      <Callout type="info">
        <p>
          Preparation owns the download and resolves only when the model is
          ready. Later calls return immediately.
        </p>
      </Callout>

      <hr />

      <h2 id="not-enabled">*_NOT_ENABLED (feature flags)</h2>
      <p>
        <code>SPEECH_NOT_ENABLED</code>, <code>VISION_NOT_ENABLED</code>, and{" "}
        <code>EMBEDDINGS_NOT_ENABLED</code> mean the app was built without the
        matching config-plugin flag. Add it to <code>app.json</code> and make a{" "}
        <strong>new native build</strong>, a JS-only OTA update cannot enable
        a feature:
      </p>
      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [["expo-ai-kit", { "speech": true, "vision": true, "androidEmbeddings": true }]]
  }
}`}
      </CodeBlock>
      <p>
        The availability calls report the same condition without throwing:{" "}
        <code>getSpeechRecognitionAvailability()</code> and{" "}
        <code>getVisionAvailability()</code> return{" "}
        <code>{`{ status: 'unavailable', reason: 'not-enabled' }`}</code>.
      </p>

      <hr />

      <h2 id="vision-errors">Vision</h2>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Meaning</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>MODEL_NOT_DOWNLOADED</code></td>
            <td>Android: the Google Play services model for segmentation or OCR is not installed.</td>
            <td>Await <code>prepareVision({`{ features: [...] }`})</code> once; vision calls never download on their own.</td>
          </tr>
          <tr>
            <td><code>NO_SUBJECT_FOUND</code></td>
            <td><code>removeBackground()</code> found no foreground subject.</td>
            <td>Treat as a normal outcome for landscapes, textures, or documents, show the original.</td>
          </tr>
          <tr>
            <td><code>IMAGE_DECODE_FAILED</code></td>
            <td>The <code>uri</code> could not be opened or decoded.</td>
            <td>Pass a local <code>file://</code> URI or path (Android also accepts <code>content://</code>); remote URLs must be downloaded first.</td>
          </tr>
          <tr>
            <td><code>DEVICE_NOT_SUPPORTED</code></td>
            <td>Background removal below iOS 17; background removal and image labeling on the iOS Simulator; Android without Google Play services (segmentation, OCR).</td>
            <td>Check <code>getVisionAvailability()</code> and hide the feature; test cutouts and labels on a physical iPhone (OCR works in the Simulator).</td>
          </tr>
          <tr>
            <td><code>LANGUAGE_NOT_SUPPORTED</code></td>
            <td>No on-device text-recognition model reads a requested language.</td>
            <td>Pick from <code>getSupportedTextRecognitionLanguages()</code>, or omit <code>languages</code>.</td>
          </tr>
          <tr>
            <td><code>DOWNLOAD_FAILED</code></td>
            <td><code>prepareVision()</code> could not install a Play services model (offline, or Play services outdated).</td>
            <td>Retry online; the install can take a minute or two on first use.</td>
          </tr>
          <tr>
            <td><code>VISION_FAILED</code></td>
            <td>The engine failed; the message carries the native reason.</td>
            <td>Try a smaller <code>maxPixels</code> or a different image; report reproducible cases.</td>
          </tr>
        </tbody>
      </table>

      <hr />

      <h2 id="debugging-tips">Debugging Tips</h2>

      <ul>
        <li>
          <strong>Test incrementally</strong>, Start with simple prompts before
          complex multi-turn conversations.
        </li>
        <li>
          <strong>Monitor memory</strong>, AI models use significant memory.
          Watch for memory warnings in development.
        </li>
        <li>
          <strong>Test on real devices</strong>, Simulators and emulators may
          not fully support on-device AI features.
        </li>
        <li>
          <strong>Check platform logs</strong>, Review Xcode console (iOS) or
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
