import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";
import { CodeBlock } from "@/components/CodeBlock";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata("Get Started", "Install expo-ai-kit in React Native and run your first on-device request.", "/get-started");
const headings = [
  { id: "installation", text: "Install", level: 2 },
  { id: "build", text: "Build the app", level: 2 },
  { id: "basic-usage", text: "Run a request", level: 2 },
];

export default function GetStartedPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Get Started</h1>
      <p>Install the package, build your app, and run a text request on the device.</p>
      <p>
        You need Expo SDK 54+ and a native build. <strong>Expo Go is not supported.</strong>{" "}
        For this text example, use an Apple Intelligence device on iOS 26+ or a{" "}
        <a href="https://developers.google.com/ml-kit/genai#prompt-device">supported Android device</a>.
      </p>
      <p>
        Here for <Link href="/guides/speech">speech</Link>, <Link href="/guides/vision">images</Link>,{" "}
        <Link href="/guides/face-detection">face detection</Link>, or <Link href="/guides/embeddings">embeddings</Link>?
        Install below, then follow that guide for its configuration and example.
      </p>

      <h2 id="installation">1. Install</h2>
      <CodeBlock language="bash">{`npx expo install expo-ai-kit`}</CodeBlock>
      <p>
        <strong>All features are off by default.</strong> Nothing native is compiled into your app until you
        turn a feature on here. Each option adds one feature and nothing else; this example needs <code>llm</code>:
      </p>
      <CodeBlock language="json" filename="app.json">{`{
  "expo": {
    "plugins": [["expo-ai-kit", { "llm": true }]]
  }
}`}</CodeBlock>
      <p>
        In an existing React Native app, <a href="https://docs.expo.dev/bare/installing-expo-modules/">install Expo modules</a> first,
        then set the same option by hand: <code>expoAiKit.llm=true</code> in <code>android/gradle.properties</code> and{" "}
        <code>{`"expoAiKit.llm": "true"`}</code> in <code>ios/Podfile.properties.json</code> (or <code>$ExpoAiKitLLM = true</code> in the Podfile).
        The <code>llm</code> and <code>speech</code> options need Android <code>minSdkVersion</code> 26, so set that by hand too.
        In an Expo project, the config plugin sets it for you.
      </p>

      <h2 id="build">2. Build the app</h2>
      <p>Plugin options change native code, so run a native build for your platform, or create an EAS development build.</p>
      <CodeBlock language="bash">{`npx expo run:ios --device
# or
npx expo run:android --device`}</CodeBlock>
      <p>In a bare React Native app, run <code>npx pod-install</code> for iOS and rebuild using your normal native workflow.</p>

      <h2 id="basic-usage">3. Run a request</h2>
      <p>Replace <code>App.tsx</code> with this component. In a Router app, use it as a screen. Tap <strong>Ask</strong>; the answer appears below the button.</p>
      <CodeBlock language="tsx" filename="App.tsx">{`import { useState } from 'react';
import { Button, ScrollView, Text } from 'react-native';
import { isAvailable, prepareBuiltInModel, sendMessage } from 'expo-ai-kit';

export default function App() {
  const [answer, setAnswer] = useState('Tap Ask to begin.');
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    try {
      if (!(await isAvailable())) {
        setAnswer('The built-in text model is unavailable on this device.');
        return;
      }
      setAnswer('Preparing the model…');
      await prepareBuiltInModel();
      setAnswer('Thinking…');
      const { text } = await sendMessage([
        { role: 'user', content: 'Explain gravity in one sentence.' },
      ]);
      setAnswer(text);
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 80, gap: 16 }}>
      <Button title={busy ? 'Working…' : 'Ask'} onPress={ask} disabled={busy} />
      <Text selectable>{answer}</Text>
    </ScrollView>
  );
}`}</CodeBlock>
      <p>Android may download the built-in model during preparation. Subsequent requests reuse the prepared model.</p>
      <p>
        If the device has no built-in text model, use a <Link href="/guides/models">downloadable model</Link> or
        see <Link href="/troubleshooting">troubleshooting</Link>.
        Next, <Link href="/guides/llm">stream responses and add conversation history</Link>.
      </p>
    </DocsLayout>
  );
}
