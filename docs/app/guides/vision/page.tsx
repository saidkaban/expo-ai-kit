import { DocsLayout } from "@/components/DocsLayout";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import { BadgeGroup } from "@/components/Badge";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata(
  "Vision: Background Removal, Labels & OCR",
  "Cut subjects out of photos, label images, and read text on-device with Apple Vision and ML Kit, no cloud, no API keys.",
  "/guides/vision"
);

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "enable", text: "Enable Vision (Android)", level: 2 },
  { id: "availability", text: "Availability & Preparation", level: 2 },
  { id: "background-removal", text: "Background Removal", level: 2 },
  { id: "labels", text: "Image Labels", level: 2 },
  { id: "ocr", text: "Text Recognition (OCR)", level: 2 },
  { id: "images", text: "Image Input", level: 2 },
  { id: "platform-notes", text: "Platform Notes", level: 2 },
  { id: "errors", text: "Errors", level: 2 },
];

export default function VisionPage() {
  return (
    <DocsLayout headings={headings}>
      <h1>Vision</h1>
      <p className="text-xl text-muted leading-relaxed">
        Three things a phone can do with a photo, entirely on-device: cut the
        subject out, describe what is in it, and read the text in it.
      </p>

      <BadgeGroup platforms={["ios", "android", "new"]} />

      <h2 id="overview">Overview</h2>
      <p>
        expo-ai-kit uses each platform&apos;s own vision engine: Apple&apos;s{" "}
        <strong>Vision framework</strong> on iOS and <strong>ML Kit</strong> on
        Android. Nothing is uploaded, images are read from the device and the
        results come back as plain data.
      </p>
      <ul>
        <li>
          <code>removeBackground()</code>: a cutout of the subject with a
          transparent background, saved as a PNG file
        </li>
        <li>
          <code>labelImage()</code>: ranked labels describing the image
          (&ldquo;Dog&rdquo;, &ldquo;Beach&rdquo;, &ldquo;Food&rdquo;, …)
        </li>
        <li>
          <code>recognizeText()</code>: the text in the image, with normalized
          bounds for every block and line
        </li>
        <li>
          The same lifecycle style as the rest of the library: explicit
          availability, one preparation call, typed errors
        </li>
      </ul>

      <h2 id="enable">Enable vision (Android)</h2>
      <p>
        iOS needs no configuration, the Vision framework ships with the OS.
        Android is off by default because it adds the ML Kit clients and a
        bundled label model to the APK. Turn it on in your app config and make a
        new native build (dev client or EAS, not an OTA update):
      </p>
      <CodeBlock language="json" filename="app.json">
        {`{
  "expo": {
    "plugins": [["expo-ai-kit", { "vision": true }]]
  }
}`}
      </CodeBlock>
      <p>
        No permissions are added: your app reads image files it already has
        access to (for example from <code>expo-image-picker</code> or the
        camera). Without the flag, Android vision APIs throw a typed{" "}
        <code>VISION_NOT_ENABLED</code> error and the app pays zero size cost.
      </p>

      <h2 id="availability">Availability &amp; preparation</h2>
      <p>
        Each feature reports its own status. On Android, subject segmentation
        and text recognition are Google Play services models that download once;{" "}
        <code>prepareVision()</code> is the <em>only</em> call that downloads
        them. Image labeling ships inside the app and works offline immediately.
        On iOS every model is part of the OS, so preparation resolves at once.
      </p>
      <CodeBlock language="typescript">
        {`import { getVisionAvailability, prepareVision } from 'expo-ai-kit';

const availability = await getVisionAvailability();
// availability.backgroundRemoval / imageLabeling / textRecognition, each one of:
//   { status: 'available' }
//   { status: 'downloadable' | 'downloading' }, Android model not installed yet
//   { status: 'unavailable', reason: 'platform' | 'os-version' | 'device' | 'not-enabled' }

if (availability.backgroundRemoval.status === 'downloadable') {
  await prepareVision({
    features: ['background-removal'],
    onProgress: (progress) => console.log(progress), // 0..1
  });
}

// For OCR in non-Latin scripts, name the languages so Android fetches those models:
await prepareVision({ features: ['text-recognition'], languages: ['ja', 'zh-Hans'] });`}
      </CodeBlock>
      <Callout type="info" title="Vision never downloads implicitly">
        <p>
          <code>removeBackground()</code> and <code>recognizeText()</code> throw
          a typed <code>MODEL_NOT_DOWNLOADED</code> error on Android until{" "}
          <code>prepareVision()</code> has installed their model. That is the
          same contract as <code>prepareBuiltInModel()</code> and{" "}
          <code>prepareSpeechRecognition()</code>.
        </p>
      </Callout>

      <h2 id="background-removal">Background removal</h2>
      <p>
        Lift the subject out of a photo. The cutout is written to the app&apos;s
        cache directory and returned as a <code>file://</code> URI, pixel data
        never crosses the bridge, along with where the subject sits in the
        source image.
      </p>
      <CodeBlock language="typescript">
        {`import { removeBackground } from 'expo-ai-kit';

const cutout = await removeBackground(
  { uri: photo.uri },
  {
    trim: true,           // crop to the subject (default); false keeps the full frame
    format: 'png',        // 'png' keeps transparency (default); 'jpeg' flattens onto white
    quality: 0.9,         // JPEG only
    maxPixels: 6_000_000, // downscale larger images first (default)
    subject: { x, y },    // optional: keep only the subject under this normalized point
    mask: true,           // optional: also write the mask as a grayscale PNG
  }
);

<Image source={{ uri: cutout.uri }} style={{ width: cutout.width, height: cutout.height }} />

cutout.maskUri;            // grayscale mask PNG, white = subject (when mask: true)
cutout.bounds;             // subject bounds in the source, normalized 0–1
cutout.pixelBounds;        // the same in source pixels
cutout.foregroundCoverage; // fraction of the image that is subject
cutout.centroid;           // subject centre, normalized
cutout.instanceCount;      // how many subjects the engine found in the image`}
      </CodeBlock>
      <p>
        By default every subject the engine finds is kept. Pass{" "}
        <code>subject</code> with a point normalized to the source image (origin
        top-left, 0 to 1), for example where the user tapped, to keep only the
        subject under it; both engines segment subjects individually. Pass{" "}
        <code>mask: true</code> to also get the mask the engine used as an 8-bit
        grayscale PNG the same size as the output, for your own compositing,
        feathering, or editing. The files live in the cache, so move or copy
        them if you need to keep them. An image with no clear subject, or no
        subject under the given point, throws <code>NO_SUBJECT_FOUND</code>.
      </p>

      <h2 id="labels">Image labels</h2>
      <p>
        Describe what is in an image. Labels come back sorted by confidence,
        highest first; the default keeps the top 10 above 50% confidence.
      </p>
      <CodeBlock language="typescript">
        {`import { labelImage } from 'expo-ai-kit';

const labels = await labelImage({ uri: photo.uri }, { maxResults: 5, minConfidence: 0.6 });
// [{ label: 'Dog', confidence: 0.97 }, { label: 'Pet', confidence: 0.88 }, …]

// maxResults: 0 returns every label above minConfidence.`}
      </CodeBlock>
      <p>
        iOS uses Vision&apos;s image classifier (about 1,300 labels); Android
        uses ML Kit Image Labeling (about 400 labels). The vocabularies and
        formats differ, iOS returns Vision&apos;s lowercase identifiers such as{" "}
        <code>adult</code> or <code>consumer_electronics</code>, Android returns
        ML Kit&apos;s capitalized words such as <code>Dog</code> or{" "}
        <code>Pet</code>, so treat labels as descriptive strings for display
        and search, not as a shared taxonomy to switch on.
      </p>

      <h2 id="ocr">Text recognition (OCR)</h2>
      <p>
        Read the text in a photo, screenshot, or document. You get the full text
        plus each block and line with normalized bounds (origin top-left, 0–1),
        so you can draw overlays or pick regions.
      </p>
      <CodeBlock language="typescript">
        {`import { recognizeText } from 'expo-ai-kit';

const result = await recognizeText(
  { uri: photo.uri },
  {
    languages: ['en', 'de'],  // optional, iOS auto-detects; Android reads Latin by default
    minTextHeight: 0.02,      // ignore text shorter than 2% of the image height
    // iOS only: recognitionLevel: 'accurate' | 'fast', usesLanguageCorrection, customWords
  }
);

result.text;    // all text, blocks joined with newlines
result.blocks;  // [{ text, bounds, lines: [{ text, bounds, confidence?, language? }] }]`}
      </CodeBlock>
      <p>
        Android&apos;s <code>languages</code> selects ML Kit script models,
        Latin, Chinese, Japanese, Korean, and Devanagari, each a one-time Play
        services download made by <code>prepareVision()</code>. iOS asks the
        Vision framework. Ask the running device what it can read:
      </p>
      <CodeBlock language="typescript">
        {`import { getSupportedTextRecognitionLanguages } from 'expo-ai-kit';

const languages = await getSupportedTextRecognitionLanguages();
// iOS: ['de-DE', 'en-US', 'fr-FR', 'ja-JP', 'zh-Hans', …]   Android: ['en', 'de', 'zh', 'ja', 'ko', 'hi', …]`}
      </CodeBlock>

      <h2 id="images">Image input</h2>
      <p>
        Every vision call takes <code>{`{ uri }`}</code>: a <code>file://</code>{" "}
        URI or absolute path (Android also accepts <code>content://</code>).
        Photos from <code>expo-image-picker</code>, <code>expo-camera</code>, and
        the file system work directly. EXIF orientation is applied before
        processing, so results match what the user sees. Large images are
        downscaled to a per-feature pixel budget before the model runs; the
        returned coordinates are normalized so they stay correct for the
        original.
      </p>

      <h2 id="platform-notes">Platform notes</h2>
      <ul>
        <li>
          <strong>iOS:</strong> Vision framework. Background removal needs iOS
          17+. The iOS Simulator cannot run Vision&apos;s neural requests, so
          background removal and image labeling report{" "}
          <code>{`{ status: 'unavailable', reason: 'device' }`}</code> there
          and need a physical device; text recognition works in the Simulator
          too.
        </li>
        <li>
          <strong>Android:</strong> ML Kit. Background removal and OCR need
          Google Play services (the models are Play services modules); image
          labeling is bundled and works without it. Devices without Play
          services report <code>reason: &apos;device&apos;</code> for those two.
        </li>
        <li>
          Vision calls are independent of the LLM and speech guards, they run
          alongside a generation or a transcription without tripping{" "}
          <code>INFERENCE_BUSY</code> or <code>SPEECH_BUSY</code>.
        </li>
        <li>
          Vision has no AI SDK model type; use these core functions directly.
        </li>
      </ul>

      <h2 id="errors">Errors</h2>
      <p>
        Vision failures throw <code>ModelError</code> with a typed{" "}
        <code>.code</code>: <code>VISION_NOT_ENABLED</code>,{" "}
        <code>IMAGE_DECODE_FAILED</code>, <code>NO_SUBJECT_FOUND</code>,{" "}
        <code>VISION_FAILED</code>, plus the shared{" "}
        <code>DEVICE_NOT_SUPPORTED</code>, <code>MODEL_NOT_DOWNLOADED</code>,{" "}
        <code>LANGUAGE_NOT_SUPPORTED</code>, and <code>DOWNLOAD_FAILED</code>.
        See{" "}
        <a href="/troubleshooting" className="text-accent hover:underline">
          Troubleshooting
        </a>{" "}
        for the full table.
      </p>
    </DocsLayout>
  );
}
