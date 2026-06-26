import {
  buildToolInstruction,
  parseToolCall,
  buildUnknownToolRepair,
  buildToolArgsRepair,
  formatToolResult,
} from '../tools';
import type { ToolSet } from '../types';

const weatherTools: ToolSet = {
  getWeather: {
    description: 'Get the current weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
  addNumbers: {
    description: 'Add two numbers.',
    parameters: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
};

describe('buildToolInstruction', () => {
  it('lists every tool name and description', () => {
    const text = buildToolInstruction(weatherTools);
    expect(text).toContain('getWeather: Get the current weather for a city.');
    expect(text).toContain('addNumbers: Add two numbers.');
  });

  it('embeds each tool parameters schema as JSON', () => {
    const text = buildToolInstruction(weatherTools);
    expect(text).toContain(JSON.stringify(weatherTools.getWeather.parameters));
  });

  it('documents the call envelope and the allowed tool names', () => {
    const text = buildToolInstruction(weatherTools);
    expect(text).toContain('{"tool": "<tool name>", "arguments": { ... }}');
    expect(text).toContain('getWeather, addNumbers');
  });
});

describe('parseToolCall', () => {
  const names = Object.keys(weatherTools);

  it('parses a clean tool-call object', () => {
    const r = parseToolCall('{"tool":"getWeather","arguments":{"city":"Paris"}}', names);
    expect(r).toEqual({ kind: 'tool', toolName: 'getWeather', args: { city: 'Paris' } });
  });

  it('unwraps a tool call from a ```json fence', () => {
    const text = '```json\n{"tool":"getWeather","arguments":{"city":"Oslo"}}\n```';
    expect(parseToolCall(text, names)).toEqual({
      kind: 'tool',
      toolName: 'getWeather',
      args: { city: 'Oslo' },
    });
  });

  it('slices a tool call out of surrounding prose', () => {
    const text = 'Sure! {"tool":"addNumbers","arguments":{"a":2,"b":3}} on it.';
    expect(parseToolCall(text, names)).toEqual({
      kind: 'tool',
      toolName: 'addNumbers',
      args: { a: 2, b: 3 },
    });
  });

  it('tolerates an "args" alias for "arguments"', () => {
    const r = parseToolCall('{"tool":"getWeather","args":{"city":"Rome"}}', names);
    expect(r).toEqual({ kind: 'tool', toolName: 'getWeather', args: { city: 'Rome' } });
  });

  it('defaults to empty args when none are provided', () => {
    const r = parseToolCall('{"tool":"getWeather"}', names);
    expect(r).toEqual({ kind: 'tool', toolName: 'getWeather', args: {} });
  });

  it('flags a call to a tool that is not in the set', () => {
    const r = parseToolCall('{"tool":"launchRocket","arguments":{}}', names);
    expect(r).toEqual({ kind: 'unknown-tool', toolName: 'launchRocket' });
  });

  it('treats plain prose as a final text answer', () => {
    expect(parseToolCall('It is sunny in Paris today.', names)).toEqual({ kind: 'text' });
  });

  it('treats non-tool JSON as text (no "tool" field)', () => {
    expect(parseToolCall('{"city":"Paris","temp":12}', names)).toEqual({ kind: 'text' });
  });

  it('treats a non-string "tool" field as text', () => {
    expect(parseToolCall('{"tool":42,"arguments":{}}', names)).toEqual({ kind: 'text' });
  });

  it('returns text for empty output', () => {
    expect(parseToolCall('', names)).toEqual({ kind: 'text' });
  });
});

describe('buildUnknownToolRepair', () => {
  it('names the bad tool and the available ones', () => {
    const msg = buildUnknownToolRepair('launchRocket', ['getWeather', 'addNumbers']);
    expect(msg).toContain('launchRocket');
    expect(msg).toContain('getWeather, addNumbers');
  });
});

describe('buildToolArgsRepair', () => {
  it('includes the tool name and the validation errors', () => {
    const msg = buildToolArgsRepair('getWeather', ['value.city is required']);
    expect(msg).toContain('getWeather');
    expect(msg).toContain('value.city is required');
  });

  it('caps the number of errors it echoes', () => {
    const many = Array.from({ length: 20 }, (_, i) => `err${i}`);
    const msg = buildToolArgsRepair('addNumbers', many);
    expect(msg).toContain('err0');
    expect(msg).not.toContain('err8'); // only the first 8 are included
  });
});

describe('formatToolResult', () => {
  it('passes a string result through unchanged', () => {
    expect(formatToolResult('getWeather', '12C and raining')).toBe(
      'Result of calling the tool "getWeather":\n12C and raining'
    );
  });

  it('JSON-encodes a non-string result', () => {
    expect(formatToolResult('addNumbers', { sum: 5 })).toBe(
      'Result of calling the tool "addNumbers":\n{"sum":5}'
    );
  });

  it('does not throw on a circular result', () => {
    const circular: any = {};
    circular.self = circular;
    expect(() => formatToolResult('x', circular)).not.toThrow();
  });
});
