import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge, BadgeGroup } from "@/components/Badge";
import Link from "next/link";

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "ios-support", text: "iOS Support", level: 2 },
  { id: "ios-how-it-works", text: "How It Works", level: 3 },
  { id: "android-support", text: "Android Support", level: 2 },
  { id: "android-how-it-works", text: "How It Works", level: 3 },
  { id: "feature-comparison", text: "Feature Comparison", level: 2 },
  { id: "graceful-degradation", text: "Graceful Degradation", level: 2 },
];

export default function PlatformSupportPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Platform Support</h1>
      <p className="text-xl text-muted leading-relaxed">
        Understanding platform requirements and compatibility for expo-ai-kit.
      </p>

      <BadgeGroup platforms={["ios", "android"]} />

      <h2 id="overview">Overview</h2>
      <p>
        expo-ai-kit provides on-device AI capabilities by leveraging native
        platform frameworks. Both iOS and Android are fully supported.
      </p>
      <p>
        There are two model paths. The <strong>built-in OS models</strong> —
        Apple Foundation Models on iOS, ML Kit on Android — need no download but
        require a recent OS/device. <strong>Downloadable models</strong> (Gemma,
        Qwen, Phi via LiteRT-LM) run on <em>both</em> platforms and broaden
        support to devices without a built-in model, as long as they have enough
        RAM. See the{" "}
        <Link href="/guides/models" className="text-accent hover:underline">
          Models guide
        </Link>
        .
      </p>

      <h3>Supported</h3>
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>iOS 26+</td>
            <td>
              <a
                href="https://developer.apple.com/documentation/FoundationModels"
                className="text-accent hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Apple Foundation Models
              </a>
            </td>
          </tr>
          <tr>
            <td>Android (supported devices)</td>
            <td>
              <a
                href="https://developers.google.com/ml-kit/genai#prompt-device"
                className="text-accent hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                ML Kit
              </a>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Unsupported</h3>
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Fallback Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>iOS &lt; 26</td>
            <td>Returns fallback message</td>
          </tr>
          <tr>
            <td>Android (unsupported devices)</td>
            <td>Returns empty string</td>
          </tr>
        </tbody>
      </table>

      <Callout type="info" title="Downloadable models broaden support">
        <p>
          &ldquo;Unsupported&rdquo; above refers only to the built-in OS model.
          A device without it can still run a{" "}
          <Link href="/guides/models" className="text-accent hover:underline">
            downloadable model
          </Link>{" "}
          (Gemma / Qwen / Phi) if it meets the model&apos;s RAM requirement —
          check <code>getRecommendedModel()</code> at runtime.
        </p>
      </Callout>

      <Callout type="info" title="Requirements">
        <ul className="list-disc pl-4 space-y-1">
          <li>Expo SDK 54+</li>
          <li>
            <strong>iOS:</strong> iOS 26.0+ (full support), iOS 15.1+ (limited)
          </li>
          <li>
            <strong>Android:</strong> API 26+,{" "}
            <a
              href="https://developers.google.com/ml-kit/genai#prompt-device"
              className="text-accent hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Supported devices
            </a>
          </li>
        </ul>
      </Callout>

      <h2 id="ios-support">iOS Support</h2>
      <p>
        <span className="inline-flex items-center gap-2">
          <Badge platform="ios" /> iOS 26+ provides full on-device AI support.
        </span>
      </p>

      <h3 id="ios-how-it-works">How It Works</h3>
      <p>
        expo-ai-kit uses Apple&apos;s{" "}
        <a
          href="https://developer.apple.com/documentation/FoundationModels"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Foundation Models framework
        </a>{" "}
        introduced in iOS 26. The on-device language model runs entirely locally
        with no internet connection required.
      </p>

      <Callout type="warning" title="iOS &lt; 26">
        <p>
          On iOS versions below 26, the module returns a fallback message. This
          allows you to develop and test your app on older devices while still
          building the UI.
        </p>
      </Callout>

      <h2 id="android-support">Android Support</h2>
      <p>
        <span className="inline-flex items-center gap-2">
          <Badge platform="android" /> Android provides full on-device AI
          support via Google&apos;s ML Kit.
        </span>
      </p>

      <h3 id="android-how-it-works">How It Works</h3>
      <p>
        expo-ai-kit uses Google&apos;s{" "}
        <a
          href="https://developers.google.com/ml-kit/genai#prompt-device"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          ML Kit
        </a>
        . The model may need to be downloaded on first use on supported devices.
        Check the{" "}
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

      <Callout type="warning" title="Unsupported Android Devices">
        <p>
          On Android devices that don&apos;t support ML Kit, the
          module returns an empty string. Use <code>isAvailable()</code> to
          check status before making requests.
        </p>
      </Callout>

      <p>
        For Android-specific setup instructions, see the{" "}
        <Link
          href="/guides/android-setup"
          className="text-accent hover:underline"
        >
          Android Setup Guide
        </Link>
        .
      </p>

      <hr />

      <h2 id="feature-comparison">Feature Comparison</h2>
      <p>Feature availability by platform:</p>

      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>iOS 26+</th>
            <th>Android (Supported)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>isAvailable()</code>
            </td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>
              <code>sendMessage()</code>
            </td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>
              <code>streamMessage()</code>
            </td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>System prompts</td>
            <td>✅ Native</td>
            <td>✅ Prepended</td>
          </tr>
          <tr>
            <td>Multi-turn context</td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>Cancel streaming</td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>
              <code>generateObject()</code> (structured output)
            </td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>
              <code>generateText()</code> (tool calling)
            </td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>Downloadable models (Gemma / Qwen / Phi)</td>
            <td>✅</td>
            <td>✅</td>
          </tr>
          <tr>
            <td>
              <code>embed()</code> (embeddings &amp; RAG)
            </td>
            <td>✅ iOS 17+ (zero-download OS model)</td>
            <td>
              ✅ opt-in (<code>androidEmbeddings</code> config-plugin flag +
              ~184 MB model download)
            </td>
          </tr>
        </tbody>
      </table>

      <hr />

      <h2 id="graceful-degradation">Graceful Degradation</h2>
      <p>
        Design your app to handle cases where on-device AI isn&apos;t available.
        Always check availability at runtime:
      </p>

      <CodeBlock language="typescript" filename="hooks/useAI.ts">
        {`import { useState, useEffect } from 'react';
import { isAvailable, sendMessage, type LLMMessage } from 'expo-ai-kit';

export function useAI() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    isAvailable().then(setAvailable);
  }, []);

  const askAI = async (question: string) => {
    if (!available) {
      // Use cloud AI fallback or show appropriate message
      return null;
    }

    const response = await sendMessage([
      { role: 'user', content: question }
    ]);
    return response.text;
  };

  return { available, askAI };
}`}
      </CodeBlock>

      <Callout type="success" title="Best Practice">
        <p>
          Always provide a fallback experience. Not all users will have
          compatible devices. Consider cloud AI as a fallback, or design
          features that work without AI.
        </p>
      </Callout>
    </DocsLayout>
  );
}
