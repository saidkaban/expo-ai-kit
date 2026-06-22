import {
  buildSchemaInstruction,
  buildSchemaRepair,
  extractJson,
  sliceBalanced,
  validateAgainstSchema,
} from '../structured';
import type { JSONSchema } from '../types';

describe('extractJson', () => {
  it('parses a clean JSON object', () => {
    const r = extractJson('{"a":1,"b":"two"}');
    expect(r).toEqual({ ok: true, value: { a: 1, b: 'two' } });
  });

  it('parses a bare JSON array', () => {
    expect(extractJson('[1,2,3]')).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('unwraps a ```json fenced block', () => {
    const text = 'Here you go:\n```json\n{"ok":true}\n```\nHope that helps!';
    expect(extractJson(text)).toEqual({ ok: true, value: { ok: true } });
  });

  it('unwraps an unlabeled ``` fence', () => {
    expect(extractJson('```\n{"x":[1]}\n```')).toEqual({ ok: true, value: { x: [1] } });
  });

  it('slices an object out of surrounding prose', () => {
    const text = 'Sure! The result is {"name":"Ada","age":36} — let me know.';
    expect(extractJson(text)).toEqual({ ok: true, value: { name: 'Ada', age: 36 } });
  });

  it('ignores braces inside strings when slicing', () => {
    const text = 'note: {"text":"a } b { c","n":1} done';
    expect(extractJson(text)).toEqual({ ok: true, value: { text: 'a } b { c', n: 1 } });
  });

  it('handles nested objects and arrays', () => {
    const text = 'x {"a":{"b":[{"c":1}]},"d":[1,[2,3]]} y';
    expect(extractJson(text)).toEqual({
      ok: true,
      value: { a: { b: [{ c: 1 }] }, d: [1, [2, 3]] },
    });
  });

  it('parses primitive values', () => {
    expect(extractJson('42')).toEqual({ ok: true, value: 42 });
    expect(extractJson('true')).toEqual({ ok: true, value: true });
    expect(extractJson('null')).toEqual({ ok: true, value: null });
  });

  it('returns ok:false for non-JSON', () => {
    expect(extractJson('I cannot help with that.')).toEqual({ ok: false });
    expect(extractJson('')).toEqual({ ok: false });
  });
});

describe('sliceBalanced', () => {
  it('returns the first balanced object', () => {
    expect(sliceBalanced('pre {"a":1} post {"b":2}')).toBe('{"a":1}');
  });

  it('returns null when there is no bracket', () => {
    expect(sliceBalanced('no json here')).toBeNull();
  });

  it('returns null for an unterminated object', () => {
    expect(sliceBalanced('{"a":1')).toBeNull();
  });
});

describe('validateAgainstSchema', () => {
  const schema: JSONSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      minutes: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'minutes'],
  };

  it('accepts a valid object', () => {
    expect(
      validateAgainstSchema({ title: 'Pasta', minutes: 20, tags: ['quick'] }, schema)
    ).toEqual([]);
  });

  it('allows extra properties not in the schema', () => {
    expect(validateAgainstSchema({ title: 'x', minutes: 1, extra: true }, schema)).toEqual([]);
  });

  it('flags a missing required property', () => {
    const errors = validateAgainstSchema({ title: 'x' }, schema);
    expect(errors).toEqual(['value.minutes is required']);
  });

  it('flags a wrong scalar type', () => {
    const errors = validateAgainstSchema({ title: 'x', minutes: '20' }, schema);
    expect(errors).toEqual(['value.minutes must be of type integer']);
  });

  it('rejects a float for an integer field', () => {
    const errors = validateAgainstSchema({ title: 'x', minutes: 2.5 }, schema);
    expect(errors).toEqual(['value.minutes must be of type integer']);
  });

  it('validates array item types', () => {
    const errors = validateAgainstSchema({ title: 'x', minutes: 1, tags: ['ok', 7] }, schema);
    expect(errors).toEqual(['value.tags[1] must be of type string']);
  });

  it('flags a top-level type mismatch without descending', () => {
    expect(validateAgainstSchema('not an object', schema)).toEqual([
      'value must be of type object',
    ]);
  });

  it('enforces enum membership', () => {
    const enumSchema: JSONSchema = { enum: ['low', 'medium', 'high'] };
    expect(validateAgainstSchema('medium', enumSchema)).toEqual([]);
    expect(validateAgainstSchema('urgent', enumSchema)).toEqual([
      'value must be one of ["low","medium","high"]',
    ]);
  });

  it('accepts a union of types', () => {
    const unionSchema: JSONSchema = { type: ['string', 'null'] };
    expect(validateAgainstSchema('x', unionSchema)).toEqual([]);
    expect(validateAgainstSchema(null, unionSchema)).toEqual([]);
    expect(validateAgainstSchema(3, unionSchema)).toEqual(['value must be of type string | null']);
  });

  it('infers object type from properties when type is omitted', () => {
    const inferred: JSONSchema = { properties: { a: { type: 'number' } }, required: ['a'] };
    expect(validateAgainstSchema({ a: 1 }, inferred)).toEqual([]);
    expect(validateAgainstSchema({}, inferred)).toEqual(['value.a is required']);
  });
});

describe('prompt builders', () => {
  it('embeds the schema JSON in the instruction', () => {
    const schema: JSONSchema = { type: 'object', properties: { a: { type: 'string' } } };
    const instruction = buildSchemaInstruction(schema);
    expect(instruction).toContain(JSON.stringify(schema));
    expect(instruction).toContain('ONLY the JSON value');
  });

  it('lists the schema errors in a repair prompt', () => {
    const msg = buildSchemaRepair(['value.minutes is required']);
    expect(msg).toContain('value.minutes is required');
  });
});
