import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/Badge";
import Link from "next/link";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Android Setup",
  "Configure expo-ai-kit with Android ML Kit, prepare the built-in model, and enable optional on-device embeddings.",
  "/guides/android-setup"
);

const headings = [
  { id: "requirements", text: "Requirements", level: 2 },
  { id: "installation", text: "Installation", level: 2 },
  { id: "configuration", text: "Configuration", level: 2 },
  { id: "android-embeddings", text: "Android Embeddings (opt-in)", level: 2 },
  { id: "how-it-works", text: "How It Works", level: 2 },
  { id: "supported-devices", text: "Supported Devices", level: 2 },
  { id: "troubleshooting", text: "Troubleshooting", level: 2 },
];

export default function AndroidSetupPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Android Setup</h1>
      <p className="text-xl text-muted leading-relaxed">
        Configure expo-ai-kit for Android using Google&apos;s ML Kit.
      </p>

      <Badge platform="android" />

      <h2 id="requirements">Requirements</h2>
      <ul>
        <li>Expo SDK 54+</li>
        <li>Android API 26+ (minSdkVersion)</li>
        <li>
          A{" "}
          <a
            href="https://developers.google.com/ml-kit/genai#prompt-device"
            className="text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            supported device
          </a>
        </li>
      </ul>

      <h2 id="installation">Installation</h2>
      <p>Install expo-ai-kit and the Android build-properties plugin:</p>

      <CodeBlock language="bash" filename="Terminal">
{`npx expo install expo-ai-kit expo-build-properties`}
      </CodeBlock>

      <Callout type="warning" title="Expo Go is not supported">
        <p>
          This package uses native code. Test it in a development build or a
          production build, not Expo Go.
        </p>
      </Callout>

      <h2 id="configuration">Configuration</h2>
      <p>
        Ensure your <code>app.json</code> includes the minimum SDK version for
        Android:
      </p>

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

      <p>After configuring, rebuild your app:</p>

      <CodeBlock language="bash" filename="Terminal">
{`npx expo prebuild --clean
npx expo run:android`}
      </CodeBlock>

      <h2 id="android-embeddings">Android Embeddings (opt-in)</h2>
      <p>
        <code>embed()</code> on Android (EmbeddingGemma 300M via MediaPipe
        TextEmbedder) is gated behind a config-plugin flag — off by default, so
        apps that don&apos;t use embeddings pay zero APK bytes:
      </p>
      <CodeBlock language="json" filename="app.json">
{`{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "android": { "minSdkVersion": 26 } }],
      ["expo-ai-kit", { "androidEmbeddings": true }]
    ]
  }
}`}
      </CodeBlock>
      <ul>
        <li>
          <strong>Off (default):</strong> the MediaPipe dependency isn&apos;t
          added at prebuild; Android <code>embed()</code> throws a typed{" "}
          <code>EMBEDDINGS_NOT_ENABLED</code> error.
        </li>
        <li>
          <strong>On:</strong> ~+25 MB APK (arm64). Requires a{" "}
          <strong>new native build</strong> (dev client / EAS — an OTA update is
          not enough).
        </li>
        <li>
          The ~184 MB model downloads at runtime via{" "}
          <code>prepareEmbeddingModel()</code> (SHA-256-verified, stored
          per-app) — <code>embed()</code> itself never downloads. See the{" "}
          <Link
            href="/guides/embeddings"
            className="text-accent hover:underline"
          >
            Embeddings guide
          </Link>{" "}
          for the full lifecycle and the Gemma license note.
        </li>
      </ul>

      <h2 id="how-it-works">How It Works</h2>
      <p>
        expo-ai-kit uses Google&apos;s{" "}
        <a
          href="https://developers.google.com/ml-kit/genai#prompt-device"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          ML Kit
        </a>{" "}
        for on-device AI on Android. The model may need to be downloaded on first
        use on supported devices.
      </p>

      <CodeBlock language="typescript">
{`import {
  isAvailable,
  prepareBuiltInModel,
  sendMessage,
} from 'expo-ai-kit';

// Check device support, then make the OS-managed model ready.
const supported = await isAvailable();

if (supported) {
  await prepareBuiltInModel();
  const response = await sendMessage([
    { role: 'user', content: 'Hello! What can you do?' }
  ]);
  console.log(response.text);
}`}
      </CodeBlock>

      <Callout type="info" title="First Use">
        <p>
          <code>isAvailable()</code> checks whether the device supports ML Kit;
          it does not mean the model asset is ready. On first use,
          <code>prepareBuiltInModel()</code> downloads the OS-managed model and
          resolves when inference can begin. Later calls return immediately.
        </p>
      </Callout>

      <h2 id="supported-devices">Supported Devices</h2>
      <p>
        Not all Android devices support ML Kit. Check Google&apos;s{" "}
        <a
          href="https://developers.google.com/ml-kit/genai#prompt-device"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          supported devices list
        </a>{" "}
        for compatibility.
      </p>

      <Callout type="warning" title="Unsupported Devices">
        <p>
          On unsupported Android devices, the built-in <code>isAvailable()</code>{" "}
          returns <code>false</code>. If inference is attempted anyway, the
          library throws a typed <code>DEVICE_NOT_SUPPORTED</code> error rather
          than returning an empty response.
        </p>
      </Callout>

      <Callout type="info" title="No ML Kit? Download a model instead">
        <p>
          Devices without the ML Kit built-in can still run on-device AI by
          downloading an open model (Gemma / Qwen / Phi) via LiteRT-LM, RAM
          permitting. See the{" "}
          <Link href="/guides/models" className="text-accent hover:underline">
            Models guide
          </Link>
          .
        </p>
      </Callout>

      <h2 id="troubleshooting">Troubleshooting</h2>

      <h4>DEVICE_NOT_SUPPORTED</h4>
      <p>
        The device does not support ML Kit. Check the{" "}
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

      <h4>MODEL_NOT_DOWNLOADED</h4>
      <p>
        The device supports ML Kit, but its model is not ready. Await
        <code>prepareBuiltInModel()</code> before retrying inference.
      </p>

      <h4>Build errors</h4>
      <p>
        Ensure your <code>minSdkVersion</code> is set to 26 or higher in your
        app.json configuration.
      </p>

      <p>
        For more troubleshooting help, see the{" "}
        <Link
          href="/troubleshooting"
          className="text-accent hover:underline"
        >
          Troubleshooting
        </Link>{" "}
        page.
      </p>
    </DocsLayout>
  );
}
