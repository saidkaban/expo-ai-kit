import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Speech-to-Text",
  "Transcribe live microphone speech and audio files on-device with Apple SpeechAnalyzer and ML Kit, no cloud, no API keys.",
  "/guides/speech"
);

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "enable", text: "Enable Speech", level: 2 },
  { id: "availability", text: "Availability & Preparation", level: 2 },
  { id: "live", text: "Live Transcription", level: 2 },
  { id: "batch", text: "Transcribe a File", level: 2 },
  { id: "languages", text: "Languages", level: 2 },
  { id: "ai-sdk", text: "AI SDK", level: 2 },
  { id: "platform-notes", text: "Platform Notes", level: 2 },
  { id: "errors", text: "Errors", level: 2 },
];

export default function SpeechPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Speech-to-Text</h1>
      <p className="text-xl text-muted leading-relaxed">
        Turn speech into text without sending audio anywhere, live from the
        microphone or from a recorded file.
      </p>

      <BadgeGroup platforms={["ios", "android", "new"]} />

      <h2 id="overview">Overview</h2>
      <p>
        expo-ai-kit uses each platform&apos;s own speech engine: Apple&apos;s{" "}
        <strong>SpeechAnalyzer</strong> on iOS 26+ and{" "}
        <strong>ML Kit GenAI Speech Recognition</strong> on Android 12+ (which
        upgrades itself to Gemini Nano on devices that have it). Both run
        entirely on the device, so transcription works offline and audio never
        leaves the phone.
      </p>
      <ul>
        <li>
          <code>streamTranscription()</code>, live microphone transcription
          with updates that revise as the engine hears more
        </li>
        <li>
          <code>transcribe()</code>, a complete transcript from an audio file
          (WAV, M4A, MP3, …)
        </li>
        <li>
          Explicit availability, model preparation, locales, and typed errors,
          the same lifecycle style as the rest of the library
        </li>
      </ul>

      <h2 id="enable">Enable speech</h2>
      <p>
        Speech is off by default because it adds microphone permissions to your
        app. Turn it on in your app config and make a new native build (dev
        client or EAS, not an OTA update):
      </p>
      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [["expo-ai-kit", { "speech": true }]]
  }
}`}
      </CodeBlock>
      <p>
        The flag compiles the Android speech backend, adds{" "}
        <code>RECORD_AUDIO</code> on Android, and adds{" "}
        <code>NSMicrophoneUsageDescription</code> on iOS. Customize the iOS
        purpose string with{" "}
        <code>{`{ "speech": { "microphonePermission": "…" } }`}</code>. Without
        the flag, speech APIs throw a typed <code>SPEECH_NOT_ENABLED</code>{" "}
        error and your app pays zero size or permission cost.
      </p>

      <h2 id="availability">Availability &amp; preparation</h2>
      <p>
        Check support first, and download the OS-managed speech model when the
        device asks for it. English often comes preinstalled; other languages
        usually need a one-time download.
      </p>
      <CodeBlock language="typescript">
        {`import {
  getSpeechRecognitionAvailability,
  prepareSpeechRecognition,
} from 'expo-ai-kit';

const availability = await getSpeechRecognitionAvailability({ locale: 'en-US' });
// { status: 'available' }, ready now
// { status: 'downloadable' | 'downloading' }, supported, model not ready yet
// { status: 'unavailable', reason: 'platform' | 'os-version' | 'device' | 'locale' | 'not-enabled' }

if (availability.status === 'downloadable') {
  await prepareSpeechRecognition({
    locale: 'en-US',
    onProgress: (progress) => console.log(progress), // 0..1
  });
}`}
      </CodeBlock>

      <h2 id="live">Live transcription</h2>
      <p>
        Ask for microphone permission, start listening, and render the
        transcript as it forms. Updates carry the <em>full</em> transcript so
        far; <code>isFinal</code> marks the moments the engine commits a
        segment.
      </p>
      <CodeBlock language="typescript">
        {`import {
  requestSpeechPermissionsAsync,
  streamTranscription,
} from 'expo-ai-kit';

const permission = await requestSpeechPermissionsAsync();
if (!permission.granted) return;

const { promise, stop } = streamTranscription(
  (update) => setText(update.text),   // full transcript so far
  { locale: 'en-US' }                 // optional, defaults to the device locale
);

// When the user releases the button:
stop();
const { text } = await promise;`}
      </CodeBlock>
      <p>
        One speech session runs at a time; a second call rejects with{" "}
        <code>SPEECH_BUSY</code>. Speech never blocks text generation, a voice
        pipeline like <em>listen → send to the model → answer</em> works
        without tripping <code>INFERENCE_BUSY</code>.
      </p>

      <h2 id="batch">Transcribe a file</h2>
      <CodeBlock language="typescript">
        {`import { transcribe } from 'expo-ai-kit';

const result = await transcribe({
  audio: { uri: recording.uri },  // or { base64, mediaType }
  locale: 'en-US',                // optional
  signal: controller.signal,      // optional AbortSignal
});

result.text;             // the transcript
result.segments;         // iOS: [{ text, startSeconds, endSeconds }]; Android: []
result.durationSeconds;  // decoded audio length
result.language;         // the locale the engine used`}
      </CodeBlock>
      <Callout type="info" title="Android transcribes at real-time rate">
        <p>
          The Android engine ingests audio at playback speed, so a 60-second
          file takes about a minute, right for voice notes and dictation,
          wrong for podcast-length audio. iOS is faster than real time and
          returns timestamped segments. Android also requires the microphone
          permission even for file input (an engine requirement).
        </p>
      </Callout>

      <h2 id="languages">Languages</h2>
      <p>
        Every speech API takes an optional BCP-47 <code>locale</code> and
        defaults to the device language. Android supports 15 languages in Basic
        mode (21 with Gemini Nano); iOS supports about 20 languages across 42
        regional variants. Ask the running device for the authoritative list:
      </p>
      <CodeBlock language="typescript">
        {`import { getSupportedSpeechLocales } from 'expo-ai-kit';

const locales = await getSupportedSpeechLocales();
// e.g. ['de-DE', 'en-US', 'ja-JP', 'tr-TR', …]`}
      </CodeBlock>

      <h2 id="ai-sdk">AI SDK</h2>
      <p>
        The provider exposes the same engine as an AI SDK transcription model,
        the first cross-platform on-device one:
      </p>
      <CodeBlock language="typescript">
        {`import { transcribe } from 'ai';
import { expoAiKit } from 'expo-ai-kit/ai';

const result = await transcribe({
  model: expoAiKit.transcriptionModel(),
  audio: audioUint8Array,
  providerOptions: { 'expo-ai-kit': { locale: 'en-US' } },
});`}
      </CodeBlock>

      <h2 id="platform-notes">Platform notes</h2>
      <ul>
        <li>
          <strong>iOS (26+):</strong> SpeechAnalyzer, batch is faster than
          real time with native timestamped segments; file transcription needs
          no permission at all. Model assets are OS-managed and shared across
          apps, so they add nothing to your app size.
        </li>
        <li>
          <strong>Android (12+):</strong> ML Kit GenAI Speech Recognition,
          text-only results at real-time rate; Gemini Nano quality on devices
          that support it, automatically.
        </li>
        <li>
          On devices below these OS versions,{" "}
          <code>getSpeechRecognitionAvailability()</code> reports{" "}
          <code>{`{ status: 'unavailable', reason: 'os-version' }`}</code> and
          the calls throw typed errors, nothing fails silently.
        </li>
      </ul>

      <h2 id="errors">Errors</h2>
      <p>
        Speech failures throw <code>ModelError</code> with a typed{" "}
        <code>.code</code>: <code>SPEECH_NOT_ENABLED</code>,{" "}
        <code>SPEECH_BUSY</code>, <code>MIC_PERMISSION_DENIED</code>,{" "}
        <code>AUDIO_DECODE_FAILED</code>, <code>TRANSCRIPTION_FAILED</code>,
        plus the shared <code>DEVICE_NOT_SUPPORTED</code>,{" "}
        <code>MODEL_NOT_DOWNLOADED</code>, and{" "}
        <code>INFERENCE_CANCELLED</code>. See{" "}
        <a href="/troubleshooting" className="text-accent hover:underline">
          Troubleshooting
        </a>{" "}
        for the full table.
      </p>
    </DocsLayout>
  );
}
