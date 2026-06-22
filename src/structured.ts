import type { JSONSchema, JSONSchemaType } from './types';

// ---------------------------------------------------------------------------
// Pure helpers for generateObject().
//
// This module is deliberately free of any native-module import so its logic can
// be unit-tested in plain Node. generateObject() (in index.ts) orchestrates the
// inference call + repair loop on top of these.
// ---------------------------------------------------------------------------

/** Build the instruction appended to the system prompt to elicit schema-shaped JSON. */
export function buildSchemaInstruction(schema: JSONSchema): string {
  return [
    'You must respond with a single JSON value that strictly conforms to this JSON Schema:',
    '',
    JSON.stringify(schema),
    '',
    'Rules:',
    '- Output ONLY the JSON value. No prose, no explanation, no markdown code fences.',
    '- Include every property listed under "required".',
    '- Use the exact property names and value types defined by the schema.',
  ].join('\n');
}

/** Follow-up prompt when the model returned something that could not be parsed as JSON. */
export const REPAIR_INVALID_JSON =
  'Your previous response was not valid JSON. Respond again with ONLY a single valid ' +
  'JSON value that conforms to the schema — no prose, no markdown code fences.';

/** Follow-up prompt when the model returned valid JSON that violated the schema. */
export function buildSchemaRepair(errors: string[]): string {
  const detail = errors.slice(0, 8).join('; ');
  return (
    `Your previous JSON did not match the schema: ${detail}. ` +
    'Respond again with ONLY the corrected JSON value — no prose, no markdown code fences.'
  );
}

export type ParseResult = { ok: true; value: unknown } | { ok: false };

/**
 * Best-effort extraction of a JSON value from model output.
 *
 * On-device models often wrap JSON in a ```json fence or add a sentence of prose
 * around it. We try, in order: a fenced block, the trimmed whole string, then the
 * first balanced {...}/[...] block found anywhere in the text.
 */
export function extractJson(text: string): ParseResult {
  if (!text) return { ok: false };

  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) candidates.push(fence[1]);
  candidates.push(text);

  for (const raw of candidates) {
    const trimmed = raw.trim();
    const direct = tryParse(trimmed);
    if (direct.ok) return direct;

    const sliced = sliceBalanced(trimmed);
    if (sliced != null) {
      const p = tryParse(sliced);
      if (p.ok) return p;
    }
  }
  return { ok: false };
}

function tryParse(s: string): ParseResult {
  if (!s) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/**
 * Return the first balanced `{...}` or `[...]` substring, or null if none.
 * Tracks string state so braces inside JSON strings are not counted.
 */
export function sliceBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Validate `value` against the supported subset of `schema`.
 * Returns a list of human-readable error strings (empty ⇒ valid).
 *
 * Intentionally lenient: unknown keywords and extra object properties are
 * allowed. The goal is to catch structural mistakes worth re-prompting over
 * (wrong type, missing required field), not full JSON Schema conformance.
 */
export function validateAgainstSchema(value: unknown, schema: JSONSchema): string[] {
  const errors: string[] = [];
  validateInto(value, schema, 'value', errors);
  return errors;
}

function validateInto(
  value: unknown,
  schema: JSONSchema,
  path: string,
  errors: string[]
): void {
  if (!schema || typeof schema !== 'object') return;

  // enum is authoritative — when present, the value must be one of its members.
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => jsonEqual(e, value))) {
      errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
    }
    return;
  }

  const types = normalizeTypes(schema);
  if (types && !types.some((t) => matchesType(value, t))) {
    errors.push(`${path} must be of type ${types.join(' | ')}`);
    return; // don't descend into a value of the wrong shape
  }

  if (isPlainObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) errors.push(`${path}.${key} is required`);
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) validateInto(value[key], sub, `${path}.${key}`, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateInto(item, schema.items as JSONSchema, `${path}[${i}]`, errors));
  }
}

/** Resolve the declared type(s), inferring object/array from properties/items. */
function normalizeTypes(schema: JSONSchema): JSONSchemaType[] | null {
  const t = schema.type;
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t;
  if (schema.properties) return ['object'];
  if (schema.items) return ['array'];
  return null;
}

function matchesType(value: unknown, type: JSONSchemaType): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
