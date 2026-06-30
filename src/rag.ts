// ---------------------------------------------------------------------------
// Pure helpers for on-device RAG (retrieval-augmented generation).
//
// Like structured.ts and tools.ts, this module is deliberately free of any
// native-module import so its logic can be unit-tested in plain Node. These are
// the "sharp primitives" for RAG — chunking, similarity, and a lightweight
// in-memory vector store — that pair with embed() (index.ts) to retrieve context
// before a sendMessage/generateText call.
//
// They work on every platform and with ANY source of embedding vectors (the
// built-in embed(), a cloud embedder, your own native module), because they only
// ever deal in plain number[] vectors. Persistence is yours to own: snapshot a
// store with toJSON() and rehydrate it via createVectorStore(snapshot).
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two equal-length vectors, in the range [-1, 1]
 * (1 = identical direction, 0 = orthogonal). This is the standard relevance
 * score for embedding retrieval — magnitude-invariant, so vectors need not be
 * pre-normalized.
 *
 * @throws if the vectors are different lengths (a dimension mismatch — usually a
 *   sign the vectors came from different embedding models).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: vectors must be the same length (got ${a.length} and ${b.length})`
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0; // a zero vector has no direction
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Options for {@link chunkText}. */
export type ChunkOptions = {
  /**
   * Target size of each chunk, in characters. New content per chunk is capped at
   * this; `overlap` is added on top. Default 1000.
   */
  chunkSize?: number;
  /**
   * Characters of trailing context repeated at the start of the next chunk, so a
   * fact split across a boundary still appears whole in at least one chunk.
   * Must be in `[0, chunkSize)`. Defaults to `min(200, chunkSize / 5)`.
   */
  overlap?: number;
};

/**
 * Split a long document into overlapping, embeddable chunks.
 *
 * Splitting happens on sentence/paragraph boundaries where possible (so chunks
 * read coherently), greedily packing segments up to `chunkSize` with `overlap`
 * characters of context carried into the next chunk. A single segment longer
 * than `chunkSize` (e.g. a giant unbroken line) is hard-split on character
 * windows. Returns `[]` for empty/whitespace input, and a single chunk for input
 * already within `chunkSize`.
 *
 * `chunkSize` bounds *new* content per chunk; with `overlap > 0` a chunk's total
 * length can exceed it by up to `overlap`. Tune to your embedder's context limit.
 *
 * @example
 * ```ts
 * const chunks = chunkText(longDoc, { chunkSize: 800, overlap: 100 });
 * const { embeddings } = await embed(chunks);
 * chunks.forEach((text, i) => store.add(`doc:${i}`, embeddings[i], { text }));
 * ```
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? 1000;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkText: chunkSize must be a positive integer');
  }
  // Default overlap scales with chunkSize so a small chunkSize stays valid
  // (a fixed 200 would exceed, say, chunkSize: 100).
  const overlap = options.overlap ?? Math.min(200, Math.floor(chunkSize / 5));
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new Error('chunkText: overlap must be an integer in [0, chunkSize)');
  }

  const clean = text.trim();
  if (clean === '') return [];
  if (clean.length <= chunkSize) return [clean];

  // Sentence-ish segments: a run up to a terminator (.!?), or a blank-line break.
  // Delimiters are kept so reassembled chunks read naturally.
  const segments = clean.match(/[^.!?\n]+[.!?]*\n*|\n+/g) ?? [clean];

  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed !== '') chunks.push(trimmed);
  };

  for (const segment of segments) {
    // A segment that alone exceeds chunkSize: flush what we have, then hard-split
    // it into overlapping character windows. Don't seed `current` afterwards —
    // the windows already carry their own overlap.
    if (segment.length > chunkSize) {
      flush();
      current = '';
      const step = chunkSize - overlap;
      for (let i = 0; i < segment.length; i += step) {
        const window = segment.slice(i, i + chunkSize).trim();
        if (window !== '') chunks.push(window);
      }
      continue;
    }

    if (current.length + segment.length > chunkSize && current.trim() !== '') {
      flush();
      // Seed the next chunk with the tail of this one for context continuity.
      current = overlap > 0 ? current.slice(Math.max(0, current.length - overlap)) : '';
    }
    current += segment;
  }
  flush();
  return chunks;
}

/** A vector plus its id and optional caller-defined metadata (e.g. the source text). */
export type VectorRecord<M = unknown> = {
  /** Caller-chosen unique id. Re-adding the same id overwrites the record. */
  id: string;
  /** The embedding vector. */
  vector: number[];
  /** Anything you want to carry alongside — typically the chunk text, a source URL, etc. */
  metadata?: M;
};

/** A {@link VectorRecord} returned from a search, with its similarity to the query. */
export type VectorSearchResult<M = unknown> = VectorRecord<M> & {
  /** Cosine similarity to the query vector, in [-1, 1]. Higher is more relevant. */
  score: number;
};

/** Options for {@link VectorStore.search}. */
export type VectorSearchOptions = {
  /** Maximum number of results to return, highest score first. Default 10. */
  topK?: number;
  /** Drop results scoring below this cosine similarity. */
  minScore?: number;
};

/**
 * A lightweight in-memory vector store: add records, then `search` by a query
 * vector to get the top-k most similar. See {@link createVectorStore}.
 */
export type VectorStore<M = unknown> = {
  /** Add (or overwrite, by id) a single record. The vector is copied defensively. */
  add(id: string, vector: number[], metadata?: M): void;
  /** Add many records at once. */
  addMany(records: VectorRecord<M>[]): void;
  /** Get a record by id, or `undefined`. */
  get(id: string): VectorRecord<M> | undefined;
  /** Remove a record by id. Returns `true` if one was removed. */
  remove(id: string): boolean;
  /** Remove every record. */
  clear(): void;
  /** Number of records currently stored. */
  readonly size: number;
  /**
   * Return the records most similar to `query`, by cosine similarity, highest
   * first. Bounded by `topK` (default 10) and filtered by `minScore` if given.
   */
  search(query: number[], options?: VectorSearchOptions): VectorSearchResult<M>[];
  /**
   * A plain-array snapshot of every record. Persist it (e.g. to AsyncStorage or a
   * file) and rehydrate later with `createVectorStore(snapshot)` — the store
   * deliberately owns no I/O, so persistence stays yours.
   */
  toJSON(): VectorRecord<M>[];
};

/**
 * Create an in-memory {@link VectorStore}, optionally seeded from a snapshot
 * previously produced by {@link VectorStore.toJSON}.
 *
 * It's intentionally minimal — a linear scan over the records on each `search`.
 * That's more than fast enough for the thousands-of-chunks scale typical of
 * on-device RAG; reach for a real vector DB only past that.
 *
 * @example
 * ```ts
 * const store = createVectorStore<{ text: string }>();
 * store.addMany(chunks.map((text, i) => ({ id: `c${i}`, vector: embeddings[i], metadata: { text } })));
 *
 * const [{ embeddings: [q] }] = [await embed([question])];
 * const hits = store.search(q, { topK: 4 });
 * const context = hits.map((h) => h.metadata!.text).join('\n\n');
 * // …feed `context` into sendMessage / generateText
 * ```
 */
export function createVectorStore<M = unknown>(initial?: VectorRecord<M>[]): VectorStore<M> {
  const records = new Map<string, VectorRecord<M>>();

  const put = (id: string, vector: number[], metadata?: M) => {
    if (typeof id !== 'string' || id === '') {
      throw new Error('VectorStore: id must be a non-empty string');
    }
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('VectorStore: vector must be a non-empty number[]');
    }
    // Copy the vector so later external mutation can't corrupt the store.
    records.set(id, { id, vector: vector.slice(), metadata });
  };

  if (initial) {
    for (const r of initial) put(r.id, r.vector, r.metadata);
  }

  return {
    add(id, vector, metadata) {
      put(id, vector, metadata);
    },
    addMany(recs) {
      for (const r of recs) put(r.id, r.vector, r.metadata);
    },
    get(id) {
      const r = records.get(id);
      return r ? { id: r.id, vector: r.vector.slice(), metadata: r.metadata } : undefined;
    },
    remove(id) {
      return records.delete(id);
    },
    clear() {
      records.clear();
    },
    get size() {
      return records.size;
    },
    search(query, opts) {
      const topK = opts?.topK ?? 10;
      const minScore = opts?.minScore;
      const scored: VectorSearchResult<M>[] = [];
      for (const r of records.values()) {
        const score = cosineSimilarity(query, r.vector);
        if (minScore != null && score < minScore) continue;
        scored.push({ id: r.id, vector: r.vector.slice(), metadata: r.metadata, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return topK >= 0 ? scored.slice(0, topK) : scored;
    },
    toJSON() {
      return [...records.values()].map((r) => ({
        id: r.id,
        vector: r.vector.slice(),
        metadata: r.metadata,
      }));
    },
  };
}
