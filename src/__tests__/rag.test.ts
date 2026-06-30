import {
  cosineSimilarity,
  chunkText,
  createVectorStore,
  type VectorRecord,
} from '../rag';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('is magnitude-invariant (parallel vectors score 1)', () => {
    expect(cosineSimilarity([1, 0], [10, 0])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });

  it('returns 0 when either vector is all zeros (no direction)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('throws on a length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/same length/);
  });
});

describe('chunkText', () => {
  it('returns [] for empty / whitespace input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('returns a single trimmed chunk when within chunkSize', () => {
    expect(chunkText('  hello world  ', { chunkSize: 100 })).toEqual(['hello world']);
  });

  it('splits long text into multiple chunks, each within chunkSize (+overlap)', () => {
    const sentence = 'This is a sentence. ';
    const doc = sentence.repeat(50); // 1000 chars
    const chunks = chunkText(doc, { chunkSize: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200 + 40);
    }
  });

  it('reassembles to cover the whole document', () => {
    const doc = 'Alpha. Bravo. Charlie. Delta. Echo. Foxtrot. Golf. Hotel.';
    const chunks = chunkText(doc, { chunkSize: 20, overlap: 5 });
    const joined = chunks.join(' ');
    for (const word of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel']) {
      expect(joined).toContain(word);
    }
  });

  it('overlaps consecutive chunks for context continuity', () => {
    const doc = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
    const chunks = chunkText(doc, { chunkSize: 24, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    // The tail of one chunk should reappear at the head of the next.
    const tail = chunks[0].slice(-5);
    expect(chunks[1].startsWith(tail) || chunks[1].includes(tail)).toBe(true);
  });

  it('hard-splits a single segment longer than chunkSize', () => {
    const giant = 'x'.repeat(500); // no sentence boundaries
    const chunks = chunkText(giant, { chunkSize: 100, overlap: 0 });
    expect(chunks.length).toBe(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks.join('')).toBe(giant);
  });

  it('rejects an invalid chunkSize', () => {
    expect(() => chunkText('abc', { chunkSize: 0 })).toThrow(/chunkSize/);
    expect(() => chunkText('abc', { chunkSize: 1.5 })).toThrow(/chunkSize/);
  });

  it('rejects overlap outside [0, chunkSize)', () => {
    expect(() => chunkText('abc', { chunkSize: 100, overlap: 100 })).toThrow(/overlap/);
    expect(() => chunkText('abc', { chunkSize: 100, overlap: -1 })).toThrow(/overlap/);
  });
});

describe('createVectorStore', () => {
  it('adds, gets, and reports size', () => {
    const store = createVectorStore<{ text: string }>();
    expect(store.size).toBe(0);
    store.add('a', [1, 0, 0], { text: 'apple' });
    store.add('b', [0, 1, 0], { text: 'banana' });
    expect(store.size).toBe(2);
    expect(store.get('a')).toEqual({ id: 'a', vector: [1, 0, 0], metadata: { text: 'apple' } });
    expect(store.get('missing')).toBeUndefined();
  });

  it('overwrites a record when the same id is added again', () => {
    const store = createVectorStore();
    store.add('a', [1, 0]);
    store.add('a', [0, 1]);
    expect(store.size).toBe(1);
    expect(store.get('a')!.vector).toEqual([0, 1]);
  });

  it('addMany seeds multiple records', () => {
    const store = createVectorStore();
    store.addMany([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0, 1] },
    ]);
    expect(store.size).toBe(2);
  });

  it('removes and clears', () => {
    const store = createVectorStore();
    store.add('a', [1, 0]);
    expect(store.remove('a')).toBe(true);
    expect(store.remove('a')).toBe(false);
    store.add('b', [0, 1]);
    store.clear();
    expect(store.size).toBe(0);
  });

  it('ranks search results by cosine similarity, highest first', () => {
    const store = createVectorStore<{ text: string }>();
    store.add('apple', [1, 0, 0], { text: 'apple' });
    store.add('almost', [0.9, 0.1, 0], { text: 'almost' });
    store.add('orthogonal', [0, 1, 0], { text: 'orthogonal' });

    const results = store.search([1, 0, 0]);
    expect(results.map((r) => r.id)).toEqual(['apple', 'almost', 'orthogonal']);
    expect(results[0].score).toBeCloseTo(1);
    expect(results[0].metadata).toEqual({ text: 'apple' });
  });

  it('respects topK', () => {
    const store = createVectorStore();
    store.add('a', [1, 0]);
    store.add('b', [0.5, 0.5]);
    store.add('c', [0, 1]);
    expect(store.search([1, 0], { topK: 2 })).toHaveLength(2);
  });

  it('filters by minScore', () => {
    const store = createVectorStore();
    store.add('a', [1, 0]);
    store.add('c', [0, 1]); // orthogonal -> score 0
    const results = store.search([1, 0], { minScore: 0.5 });
    expect(results.map((r) => r.id)).toEqual(['a']);
  });

  it('round-trips through toJSON / createVectorStore for persistence', () => {
    const store = createVectorStore<{ text: string }>();
    store.add('a', [1, 0], { text: 'apple' });
    store.add('b', [0, 1], { text: 'banana' });

    const snapshot: VectorRecord<{ text: string }>[] = store.toJSON();
    const restored = createVectorStore<{ text: string }>(snapshot);

    expect(restored.size).toBe(2);
    expect(restored.search([1, 0], { topK: 1 })[0].id).toBe('a');
  });

  it('copies vectors defensively (external mutation cannot corrupt the store)', () => {
    const store = createVectorStore();
    const v = [1, 0, 0];
    store.add('a', v);
    v[0] = 999;
    expect(store.get('a')!.vector).toEqual([1, 0, 0]);
  });

  it('rejects an empty id or empty vector', () => {
    const store = createVectorStore();
    expect(() => store.add('', [1, 0])).toThrow(/id/);
    expect(() => store.add('a', [])).toThrow(/vector/);
  });
});
