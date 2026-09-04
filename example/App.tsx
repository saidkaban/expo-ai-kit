import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Button,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {
  cosineSimilarity,
  deleteModel,
  downloadModel,
  embed,
  generateObject,
  getEmbeddingModelStatus,
  prepareEmbeddingModel,
  getActiveModel,
  getDownloadableModels,
  getSpeechRecognitionAvailability,
  getVisionAvailability,
  labelImage,
  prepareSpeechRecognition,
  prepareVision,
  recognizeText,
  removeBackground,
  requestSpeechPermissionsAsync,
  sendMessage,
  setModel,
  streamMessage,
  streamTranscription,
  unloadModel,
  type DownloadableModel,
  type TranscriptionHandle,
  type VisionAvailability,
} from 'expo-ai-kit';

const TARGET_MODEL_ID = 'gemma-e2b';

function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (mb < 1000) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1000).toFixed(2)} GB`;
}

function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.barOuter}>
      <View style={[styles.barInner, { width: `${pct * 100}%` }]} />
    </View>
  );
}

function StatusBadge({ label }: { label: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    'ready':         { bg: '#2ea043', fg: 'white' },
    'loading':       { bg: '#d29922', fg: 'white' },
    'downloading':   { bg: '#1f6feb', fg: 'white' },
    'downloaded':    { bg: '#0e7490', fg: 'white' },
    'asking':        { bg: '#8957e5', fg: 'white' },
    'streaming':     { bg: '#8957e5', fg: 'white' },
    'not-downloaded':{ bg: '#30363d', fg: '#c9d1d9' },
  };
  const c = palette[label] ?? palette['not-downloaded'];
  return (
    <Text style={[styles.badge, { backgroundColor: c.bg, color: c.fg }]}>{label}</Text>
  );
}

function SpeechSection() {
  const [availability, setAvailability] = useState<string>('checking…');
  const [transcript, setTranscript] = useState<string>('');
  const [listening, setListening] = useState<TranscriptionHandle | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const refreshAvailability = async () => {
    try {
      const a = await getSpeechRecognitionAvailability();
      setAvailability(a.status === 'unavailable' ? `unavailable (${a.reason})` : a.status);
    } catch (e: any) {
      setAvailability(`error: ${e?.message ?? String(e)}`);
    }
  };
  useEffect(() => {
    refreshAvailability();
  }, []);

  const doPrepare = async () => {
    setSpeechError(null);
    try {
      await prepareSpeechRecognition();
    } catch (e: any) {
      setSpeechError(e?.message ?? String(e));
    }
    await refreshAvailability();
  };

  const doListen = async () => {
    setSpeechError(null);
    try {
      const permission = await requestSpeechPermissionsAsync();
      if (!permission.granted) {
        setSpeechError('Microphone permission was not granted.');
        return;
      }
      setTranscript('');
      const handle = streamTranscription((update) => {
        console.log('[demo] transcription', JSON.stringify(update));
        setTranscript(update.text);
      });
      setListening(handle);
      handle.promise
        .catch((e: any) => setSpeechError(e?.message ?? String(e)))
        .finally(() => setListening(null));
    } catch (e: any) {
      setSpeechError(e?.message ?? String(e));
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>speech-to-text</Text>
      <Text style={styles.meta}>availability: {availability}</Text>
      <View style={styles.buttons}>
        <Button title="Prepare" onPress={doPrepare} disabled={!!listening} />
        <Button
          title={listening ? 'Stop' : 'Listen'}
          onPress={listening ? () => listening.stop() : doListen}
        />
      </View>
      {transcript !== '' && (
        <View style={styles.outputBox}>
          <Text style={styles.outputLabel}>transcript</Text>
          <Text style={styles.outputText}>{transcript}</Text>
        </View>
      )}
      {speechError && (
        <View style={[styles.outputBox, { borderColor: '#f85149' }]}>
          <Text style={[styles.outputLabel, { color: '#f85149' }]}>speech error</Text>
          <Text style={styles.outputText}>{speechError}</Text>
        </View>
      )}
    </View>
  );
}

function describeAvailability(entry: VisionAvailability[keyof VisionAvailability]): string {
  return entry.status === 'unavailable' ? `unavailable (${entry.reason})` : entry.status;
}

function VisionSection() {
  const [availability, setAvailability] = useState<string>('checking…');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [previewBox, setPreviewBox] = useState<{ width: number; height: number } | null>(null);
  const [cutoutUri, setCutoutUri] = useState<string | null>(null);
  const [maskUri, setMaskUri] = useState<string | null>(null);
  const [cutoutInfo, setCutoutInfo] = useState<string>('');
  const [labels, setLabels] = useState<string>('');
  const [ocr, setOcr] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);

  const refreshAvailability = async () => {
    try {
      const a = await getVisionAvailability();
      setAvailability(
        `cutout ${describeAvailability(a.backgroundRemoval)} · labels ${describeAvailability(
          a.imageLabeling
        )} · ocr ${describeAvailability(a.textRecognition)}`
      );
    } catch (e: any) {
      setAvailability(`error: ${e?.message ?? String(e)}`);
    }
  };
  useEffect(() => {
    refreshAvailability();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setVisionError(null);
    try {
      await fn();
    } catch (e: any) {
      setVisionError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const doPrepare = () =>
    run('preparing', async () => {
      await prepareVision({ onProgress: (p) => setBusy(`preparing ${(p * 100).toFixed(0)}%`) });
      await refreshAvailability();
    });

  const doPick = () =>
    run('picking', async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      setImageUri(asset.uri);
      setImageSize(asset.width && asset.height ? { width: asset.width, height: asset.height } : null);
      setCutoutUri(null);
      setMaskUri(null);
      setCutoutInfo('');
      setLabels('');
      setOcr('');
    });

  // Cut out every subject, or only the one under a normalized point.
  const cutOut = (subject?: { x: number; y: number }) =>
    run('cutting out', async () => {
      if (!imageUri) return;
      const cutout = await removeBackground({ uri: imageUri }, { subject, mask: true });
      console.log('[demo] removeBackground', JSON.stringify({ subject, ...cutout }));
      setCutoutUri(cutout.uri);
      setMaskUri(cutout.maskUri ?? null);
      setCutoutInfo(
        `${cutout.instanceCount} subject(s) · ${(cutout.foregroundCoverage * 100).toFixed(0)}% coverage` +
          (subject ? ` · picked at ${subject.x.toFixed(2)}, ${subject.y.toFixed(2)}` : '')
      );
    });
  const doCutout = () => cutOut();

  // Tap the source preview to keep only the subject under the finger. The
  // preview uses resizeMode="contain", so map the touch through the
  // letterboxed image rect into normalized image coordinates.
  const onPreviewLayout = (event: LayoutChangeEvent) =>
    setPreviewBox({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  const onPreviewPress = (event: GestureResponderEvent) => {
    if (!imageSize || !previewBox || busy) return;
    const scale = Math.min(previewBox.width / imageSize.width, previewBox.height / imageSize.height);
    const shownWidth = imageSize.width * scale;
    const shownHeight = imageSize.height * scale;
    const offsetX = (previewBox.width - shownWidth) / 2;
    const offsetY = (previewBox.height - shownHeight) / 2;
    const x = (event.nativeEvent.locationX - offsetX) / shownWidth;
    const y = (event.nativeEvent.locationY - offsetY) / shownHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    cutOut({ x, y });
  };

  const doLabels = () =>
    run('labeling', async () => {
      if (!imageUri) return;
      const result = await labelImage({ uri: imageUri }, { maxResults: 5 });
      console.log('[demo] labelImage', JSON.stringify(result));
      setLabels(result.map((l) => `${l.label} ${(l.confidence * 100).toFixed(0)}%`).join('\n') || '(none)');
    });

  const doOcr = () =>
    run('reading', async () => {
      if (!imageUri) return;
      const result = await recognizeText({ uri: imageUri });
      console.log('[demo] recognizeText', JSON.stringify(result.text));
      setOcr(result.text || '(no text found)');
    });

  // The cutout lives in the app cache; the share sheet lets you save it to
  // Photos, AirDrop it, or send it to another app to inspect the transparency.
  const doShare = () =>
    run('sharing', async () => {
      if (!cutoutUri) return;
      await Share.share(
        Platform.OS === 'ios' ? { url: cutoutUri } : { message: cutoutUri }
      );
    });

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>vision</Text>
      <Text style={styles.meta}>{availability}</Text>
      {busy && <Text style={styles.meta}>{busy}…</Text>}
      <View style={styles.buttons}>
        <Button title="Prepare" onPress={doPrepare} disabled={!!busy} />
        <Button title="Pick photo" onPress={doPick} disabled={!!busy} />
        <Button title="Cutout" onPress={doCutout} disabled={!!busy || !imageUri} />
        <Button title="Labels" onPress={doLabels} disabled={!!busy || !imageUri} />
        <Button title="OCR" onPress={doOcr} disabled={!!busy || !imageUri} />
        <Button title="Share cutout" onPress={doShare} disabled={!!busy || !cutoutUri} />
      </View>
      {imageUri && <Text style={styles.meta}>tap the photo to cut out only the subject under your finger</Text>}
      {(imageUri || cutoutUri) && (
        <View style={styles.imageRow}>
          {imageUri && (
            <Pressable style={styles.preview} onLayout={onPreviewLayout} onPress={onPreviewPress}>
              <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
            </Pressable>
          )}
          {cutoutUri && (
            <Image source={{ uri: cutoutUri }} style={[styles.preview, styles.cutout]} resizeMode="contain" />
          )}
          {maskUri && <Image source={{ uri: maskUri }} style={styles.preview} resizeMode="contain" />}
        </View>
      )}
      {cutoutInfo !== '' && <Text style={styles.meta}>{cutoutInfo}</Text>}
      {labels !== '' && (
        <View style={styles.outputBox}>
          <Text style={styles.outputLabel}>labels</Text>
          <Text style={styles.outputText}>{labels}</Text>
        </View>
      )}
      {ocr !== '' && (
        <View style={styles.outputBox}>
          <Text style={styles.outputLabel}>text</Text>
          <Text style={styles.outputText}>{ocr}</Text>
        </View>
      )}
      {visionError && (
        <View style={[styles.outputBox, { borderColor: '#f85149' }]}>
          <Text style={[styles.outputLabel, { color: '#f85149' }]}>vision error</Text>
          <Text style={styles.outputText}>{visionError}</Text>
        </View>
      )}
    </View>
  );
}

// A handful of notes to search by meaning. Small on purpose: the point is to
// show embed() + cosineSimilarity() end to end, not to build a real index.
const SAMPLE_NOTES = [
  'Dentist appointment moved to Thursday at 3pm',
  'Buy oat milk, eggs, and coffee beans',
  'Ideas for the Q4 product roadmap: onboarding, offline mode',
  'Flight to Berlin lands at 09:40, pick up the rental car',
  'Call the landlord about the heating',
  'Recipe: lemon pasta with garlic and parmesan',
];

function EmbeddingsSection() {
  const [status, setStatus] = useState<string>('checking…');
  const [query, setQuery] = useState<string>('what do I need from the store');
  const [results, setResults] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);

  const refreshStatus = async () => {
    try {
      const state = await getEmbeddingModelStatus();
      setStatus(state.status);
    } catch (e: any) {
      setStatus(`error: ${e?.message ?? String(e)}`);
    }
  };
  useEffect(() => {
    refreshStatus();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setEmbeddingError(null);
    try {
      await fn();
    } catch (e: any) {
      setEmbeddingError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const doPrepare = () =>
    run('preparing', async () => {
      await prepareEmbeddingModel({ onProgress: (p) => setBusy(`downloading ${(p * 100).toFixed(0)}%`) });
      await refreshStatus();
    });

  const doSearch = () =>
    run('searching', async () => {
      if (!query.trim()) return;
      const { embeddings: docs } = await embed(SAMPLE_NOTES, { task: 'retrieval-document' });
      const { embeddings: [q] } = await embed([query], { task: 'retrieval-query' });
      const ranked = SAMPLE_NOTES.map((note, i) => ({ note, score: cosineSimilarity(q, docs[i]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      console.log('[demo] search', JSON.stringify({ query, ranked }));
      setResults(ranked.map((r) => `${(r.score * 100).toFixed(0)}%  ${r.note}`).join('\n'));
    });

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>embeddings</Text>
      <Text style={styles.meta}>model: {status}</Text>
      {busy && <Text style={styles.meta}>{busy}…</Text>}
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search your notes by meaning…"
        placeholderTextColor="#6e7681"
        editable={!busy}
      />
      <View style={styles.buttons}>
        <Button title="Prepare" onPress={doPrepare} disabled={!!busy} />
        <Button title="Search" onPress={doSearch} disabled={!!busy || !query.trim()} />
      </View>
      {results !== '' && (
        <View style={styles.outputBox}>
          <Text style={styles.outputLabel}>closest notes</Text>
          <Text style={styles.outputText}>{results}</Text>
        </View>
      )}
      {embeddingError && (
        <View style={[styles.outputBox, { borderColor: '#f85149' }]}>
          <Text style={[styles.outputLabel, { color: '#f85149' }]}>embedding error</Text>
          <Text style={styles.outputText}>{embeddingError}</Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [model, setModelState] = useState<DownloadableModel | null>(null);
  const [activeModelId, setActiveModelId] = useState<string>('apple-fm');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [prompt, setPrompt] = useState<string>('Explain quantum entanglement in one sentence.');
  const [streamingText, setStreamingText] = useState<string>('');
  const [reply, setReply] = useState<string>('');
  const [objectText, setObjectText] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const models = await getDownloadableModels();
    setModelState(models.find((m) => m.id === TARGET_MODEL_ID) ?? null);
    setActiveModelId(getActiveModel());
  };

  useEffect(() => { refresh().catch((e) => setError(String(e))); }, []);

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try { await fn(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); await refresh(); }
  };

  const doDownload = () => withBusy('downloading', async () => {
    setDownloadProgress(0);
    await downloadModel(TARGET_MODEL_ID, { onProgress: setDownloadProgress });
    setDownloadProgress(null);
  });
  const doActivate = () => withBusy('loading',     () => setModel(TARGET_MODEL_ID));
  const doUnload   = () => withBusy('unloading',   () => unloadModel());
  const doDelete   = () => withBusy('deleting',    () => deleteModel(TARGET_MODEL_ID));

  const doSend = () => withBusy('asking', async () => {
    if (!prompt.trim()) return;
    setReply('…');
    const r = await sendMessage([{ role: 'user', content: prompt }]);
    setReply(r.text);
  });
  const doStream = () => withBusy('streaming', async () => {
    if (!prompt.trim()) return;
    setStreamingText('');
    const startedAt = Date.now();
    const { promise } = streamMessage(
      [{ role: 'user', content: prompt }],
      (e) => {
        console.log('[demo] token', JSON.stringify({ t: Date.now() - startedAt, token: e.token }));
        setStreamingText(e.accumulatedText);
      }
    );
    await promise;
  });
  const doObject = () => withBusy('extracting', async () => {
    if (!prompt.trim()) return;
    setObjectText('…');
    const { object } = await generateObject(
      [{ role: 'user', content: prompt }],
      {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
        },
        required: ['summary', 'keywords', 'sentiment'],
      }
    );
    setObjectText(JSON.stringify(object, null, 2));
  });

  const sizeLabel = model ? formatBytes(model.sizeBytes) : ', ';
  const downloadedLabel =
    downloadProgress != null && model ? formatBytes(downloadProgress * model.sizeBytes) : null;
  const statusLabel = busy ?? (model?.status ?? 'not-downloaded');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>expo-ai-kit · iOS Gemma 4 test</Text>

        {/* Model card */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{model?.name ?? TARGET_MODEL_ID}</Text>
            <StatusBadge label={statusLabel} />
          </View>
          <Text style={styles.meta}>
            {model?.parameterCount ?? ', '} params · {sizeLabel} · ctx {model?.contextWindow ?? ', '}
          </Text>
          <Text style={styles.meta}>
            device {model?.meetsRequirements ? '✓ meets' : '✗ does NOT meet'} RAM requirement
          </Text>
          <Text style={styles.meta}>active model: {activeModelId}</Text>

          {downloadProgress != null && (
            <View style={styles.progressBlock}>
              <ProgressBar progress={downloadProgress} />
              <Text style={styles.progressText}>
                {(downloadProgress * 100).toFixed(1)}%  ·  {downloadedLabel} / {sizeLabel}
              </Text>
            </View>
          )}
        </View>

        {/* Lifecycle controls */}
        <View style={styles.buttons}>
          <Button title="Download" onPress={doDownload} disabled={!!busy} />
          <Button title="Activate" onPress={doActivate} disabled={!!busy} />
          <Button title="Unload"   onPress={doUnload}   disabled={!!busy} />
          <Button title="Delete file" onPress={doDelete} disabled={!!busy} />
        </View>

        {/* Free-form prompt */}
        <View style={styles.card}>
          <Text style={styles.outputLabel}>prompt → {activeModelId}</Text>
          <TextInput
            style={styles.input}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Type any prompt…"
            placeholderTextColor="#6e7681"
            multiline
            editable={!busy}
          />
          <View style={styles.buttons}>
            <Button title="Send" onPress={doSend} disabled={!!busy || !prompt.trim()} />
            <Button title="Stream" onPress={doStream} disabled={!!busy || !prompt.trim()} />
            <Button title="Object" onPress={doObject} disabled={!!busy || !prompt.trim()} />
          </View>
        </View>

        {/* Sync reply */}
        {reply !== '' && (
          <View style={styles.outputBox}>
            <Text style={styles.outputLabel}>reply</Text>
            <Text style={styles.outputText}>{reply}</Text>
          </View>
        )}

        {/* Stream output */}
        {streamingText !== '' && (
          <View style={styles.outputBox}>
            <Text style={styles.outputLabel}>stream</Text>
            <Text style={styles.outputText}>{streamingText}</Text>
          </View>
        )}

        {/* Structured output (generateObject) */}
        {objectText !== '' && (
          <View style={styles.outputBox}>
            <Text style={styles.outputLabel}>object</Text>
            <Text style={[styles.outputText, { fontFamily: 'Menlo', fontSize: 12 }]}>
              {objectText}
            </Text>
          </View>
        )}

        {/* Speech-to-text (opt-in config-plugin flag) */}
        <SpeechSection />

        {/* Vision: cutout / labels / OCR (opt-in config-plugin flag on Android) */}
        <VisionSection />

        {/* Embeddings: semantic search over a few notes (opt-in flag on Android) */}
        <EmbeddingsSection />

        {error && (
          <View style={[styles.outputBox, { borderColor: '#f85149' }]}>
            <Text style={[styles.outputLabel, { color: '#f85149' }]}>error</Text>
            <Text style={styles.outputText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 60, paddingHorizontal: 16, backgroundColor: '#0d1117' },
  title: { color: 'white', fontSize: 18, fontWeight: '600', marginBottom: 12 },

  card: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: 'white', fontSize: 15, fontWeight: '500' },
  meta: { color: '#8b949e', fontSize: 12, marginTop: 4 },

  badge: {
    fontSize: 11,
    fontFamily: 'Menlo',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },

  input: {
    color: '#c9d1d9',
    backgroundColor: '#0d1117',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    minHeight: 72,
    marginTop: 8,
    marginBottom: 10,
    textAlignVertical: 'top',
  },

  progressBlock: { marginTop: 12 },
  barOuter: { height: 10, backgroundColor: '#30363d', borderRadius: 5, overflow: 'hidden' },
  barInner: { height: 10, backgroundColor: '#2ea043' },
  progressText: { color: '#c9d1d9', fontSize: 12, marginTop: 6, fontFamily: 'Menlo' },

  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },

  imageRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  preview: { flex: 1, height: 160, borderRadius: 6, backgroundColor: '#0d1117', overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  cutout: { backgroundColor: '#8b949e' },

  outputBox: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 6,
    marginBottom: 6,
  },
  outputLabel: { color: '#8b949e', fontSize: 11, marginBottom: 6, fontFamily: 'Menlo' },
  outputText: { color: '#c9d1d9', fontSize: 14, lineHeight: 20 },
});
