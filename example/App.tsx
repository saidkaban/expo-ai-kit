import { useEffect, useState } from 'react';
import {
  Button,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  deleteModel,
  downloadModel,
  generateObject,
  getActiveModel,
  getDownloadableModels,
  sendMessage,
  setModel,
  streamMessage,
  unloadModel,
  type DownloadableModel,
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
    const { promise } = streamMessage(
      [{ role: 'user', content: prompt }],
      (e) => setStreamingText(e.accumulatedText)
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

  const sizeLabel = model ? formatBytes(model.sizeBytes) : '—';
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
            {model?.parameterCount ?? '—'} params · {sizeLabel} · ctx {model?.contextWindow ?? '—'}
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
