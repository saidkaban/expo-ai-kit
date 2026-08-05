import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';

import {
  convertCallOptions,
  extractOutput,
  unwrapToolOutput,
  newPartId,
  EMPTY_USAGE,
} from '../ai/convert';
import { ModelError } from '../types';

// Minimal call options builder — the fields convertCallOptions reads.
function call(overrides: Partial<LanguageModelV3CallOptions>): LanguageModelV3CallOptions {
  return { prompt: [], ...overrides } as LanguageModelV3CallOptions;
}

const weatherTool = {
  type: 'function' as const,
  name: 'getWeather',
  description: 'Get the weather for a city.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  } as any,
};

describe('convertCallOptions', () => {
  it('maps system/user/assistant messages onto LLMMessage[]', () => {
    const { messages } = convertCallOptions(
      call({
        prompt: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
          { role: 'user', content: [{ type: 'text', text: 'Bye' }] },
        ],
      })
    );
    expect(messages).toEqual([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Bye' },
    ]);
  });

  it('merges multiple system messages into one leading system message', () => {
    const { messages } = convertCallOptions(
      call({
        prompt: [
          { role: 'system', content: 'A.' },
          { role: 'user', content: [{ type: 'text', text: 'x' }] },
          { role: 'system', content: 'B.' },
        ],
      })
    );
    expect(messages[0]).toEqual({ role: 'system', content: 'A.\n\nB.' });
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('joins multiple text parts within one user message', () => {
    const { messages } = convertCallOptions(
      call({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'part one ' },
              { type: 'text', text: 'part two' },
            ],
          },
        ],
      })
    );
    expect(messages).toEqual([{ role: 'user', content: 'part one part two' }]);
  });

  it('throws DEVICE_NOT_SUPPORTED on file parts', () => {
    expect(() =>
      convertCallOptions(
        call({
          prompt: [
            {
              role: 'user',
              content: [{ type: 'file', data: 'aGk=', mediaType: 'image/png' }],
            },
          ],
        })
      )
    ).toThrow(ModelError);
    try {
      convertCallOptions(
        call({
          prompt: [
            { role: 'user', content: [{ type: 'file', data: 'aGk=', mediaType: 'image/png' }] },
          ],
        })
      );
    } catch (e) {
      expect((e as ModelError).code).toBe('DEVICE_NOT_SUPPORTED');
    }
  });

  it('injects the tool instruction into the system message and reports tool names', () => {
    const { messages, toolNames } = convertCallOptions(
      call({
        prompt: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: [{ type: 'text', text: 'Weather in Paris?' }] },
        ],
        tools: [weatherTool],
      })
    );
    expect(toolNames).toEqual(['getWeather']);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Be helpful.');
    expect(messages[0].content).toContain('getWeather');
    expect(messages[0].content).toContain('{"tool": "<tool name>", "arguments": { ... }}');
  });

  it('adds a system message when tools are present but the prompt has none', () => {
    const { messages } = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [weatherTool],
      })
    );
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('getWeather');
  });

  it("toolChoice 'none' offers no tools and no instruction", () => {
    const { messages, toolNames } = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [weatherTool],
        toolChoice: { type: 'none' },
      })
    );
    expect(toolNames).toEqual([]);
    expect(messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it("toolChoice 'required' / 'tool' nudge the prompt and warn 'compatibility'", () => {
    const required = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [weatherTool],
        toolChoice: { type: 'required' },
      })
    );
    expect(required.messages[0].content).toContain('MUST call one of the tools');
    expect(required.warnings).toContainEqual(
      expect.objectContaining({ type: 'compatibility', feature: "toolChoice: 'required'" })
    );

    const specific = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [weatherTool],
        toolChoice: { type: 'tool', toolName: 'getWeather' },
      })
    );
    expect(specific.messages[0].content).toContain('MUST call the tool "getWeather"');
  });

  it('warns on provider-defined tools and skips them', () => {
    const { toolNames, warnings } = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [
          weatherTool,
          { type: 'provider', id: 'some.web_search', name: 'web_search', args: {} },
        ],
      })
    );
    expect(toolNames).toEqual(['getWeather']);
    expect(warnings).toContainEqual(
      expect.objectContaining({ type: 'unsupported', feature: 'provider tool "some.web_search"' })
    );
  });

  it('re-renders assistant tool calls as the taught envelope and tool results via formatToolResult', () => {
    const { messages } = convertCallOptions(
      call({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Weather in Paris?' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'getWeather',
                input: { city: 'Paris' },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'c1',
                toolName: 'getWeather',
                output: { type: 'json', value: { temp: 21 } },
              },
            ],
          },
        ],
        tools: [weatherTool],
      })
    );
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('{"tool":"getWeather","arguments":{"city":"Paris"}}');
    // Tool results are fed back as user turns, exactly like generateText's loop.
    const feedback = messages[messages.length - 1];
    expect(feedback.role).toBe('user');
    expect(feedback.content).toBe('Result of calling the tool "getWeather":\n{"temp":21}');
  });

  it('skips reasoning parts and drops empty assistant messages', () => {
    const { messages } = convertCallOptions(
      call({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking…' }] },
        ],
      })
    );
    expect(messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('responseFormat json sets jsonMode and injects the schema instruction', () => {
    const { messages, jsonMode } = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'a recipe' }] }],
        responseFormat: {
          type: 'json',
          schema: { type: 'object', properties: { title: { type: 'string' } } } as any,
        },
      })
    );
    expect(jsonMode).toBe(true);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('"title"');
  });

  it('responseFormat json without schema still instructs JSON-only output', () => {
    const { messages, jsonMode } = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        responseFormat: { type: 'json' },
      })
    );
    expect(jsonMode).toBe(true);
    expect(messages[0].content).toContain('ONLY a valid JSON value');
  });

  it('tools win over responseFormat json, with a warning', () => {
    const { jsonMode, warnings } = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [weatherTool],
        responseFormat: { type: 'json' },
      })
    );
    expect(jsonMode).toBe(false);
    expect(warnings).toContainEqual(expect.objectContaining({ type: 'other' }));
  });

  it('reports per-call sampling settings as unsupported-setting warnings', () => {
    const { warnings } = convertCallOptions(
      call({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        temperature: 0.7,
        topK: 40,
        maxOutputTokens: 100,
        stopSequences: ['\n'],
      })
    );
    const features = warnings
      .filter((w) => w.type === 'unsupported')
      .map((w) => (w as { feature: string }).feature);
    expect(features).toEqual(
      expect.arrayContaining(['temperature', 'topK', 'maxOutputTokens', 'stopSequences'])
    );
    // No warnings for settings that weren't passed.
    expect(features).not.toContain('topP');
  });
});

describe('extractOutput', () => {
  it('detects a tool-call envelope when tools were offered', () => {
    const out = extractOutput(
      '{"tool": "getWeather", "arguments": {"city": "Paris"}}',
      ['getWeather'],
      false
    );
    expect(out).toEqual({
      kind: 'tool-call',
      toolName: 'getWeather',
      input: '{"city":"Paris"}',
      reasoning: '',
    });
  });

  it('splits <think> reasoning off and parses the tool envelope from the answer', () => {
    const out = extractOutput(
      '<think>The user wants weather. I should call {"tool": "wrong"} … no, getWeather.</think>\n' +
        '{"tool": "getWeather", "arguments": {"city": "Paris"}}',
      ['getWeather'],
      false
    );
    expect(out.kind).toBe('tool-call');
    expect(out.reasoning).toContain('The user wants weather');
    if (out.kind === 'tool-call') {
      expect(out.toolName).toBe('getWeather');
    }
  });

  it('splits <think> reasoning off plain text answers', () => {
    const out = extractOutput('<think>hmm</think>The answer is 4.', [], false);
    expect(out).toEqual({ kind: 'text', text: 'The answer is 4.', reasoning: 'hmm' });
  });

  it('tolerates fences and prose around the envelope (extractJson semantics)', () => {
    const out = extractOutput(
      'Sure!\n```json\n{"tool": "getWeather", "arguments": {"city": "Oslo"}}\n```',
      ['getWeather'],
      false
    );
    expect(out.kind).toBe('tool-call');
  });

  it('falls back to text for unknown tool names (single-shot, no repair loop)', () => {
    const raw = '{"tool": "nope", "arguments": {}}';
    expect(extractOutput(raw, ['getWeather'], false)).toEqual({
      kind: 'text',
      text: raw,
      reasoning: '',
    });
  });

  it('returns plain answers as text when tools were offered', () => {
    expect(extractOutput('It is sunny.', ['getWeather'], false)).toEqual({
      kind: 'text',
      text: 'It is sunny.',
      reasoning: '',
    });
  });

  it('extracts and re-serializes JSON in json mode', () => {
    const out = extractOutput('Here you go:\n```json\n{"title": "Pasta"}\n```', [], true);
    expect(out).toEqual({ kind: 'text', text: '{"title":"Pasta"}', reasoning: '' });
  });

  it('passes raw text through when json mode extraction fails', () => {
    expect(extractOutput('not json at all', [], true)).toEqual({
      kind: 'text',
      text: 'not json at all',
      reasoning: '',
    });
  });
});

describe('unwrapToolOutput', () => {
  it('unwraps each output variant', () => {
    expect(unwrapToolOutput({ type: 'text', value: 'hi' })).toBe('hi');
    expect(unwrapToolOutput({ type: 'json', value: { a: 1 } })).toEqual({ a: 1 });
    expect(unwrapToolOutput({ type: 'error-text', value: 'boom' })).toEqual({ error: 'boom' });
    expect(unwrapToolOutput({ type: 'error-json', value: { msg: 'boom' } })).toEqual({
      error: { msg: 'boom' },
    });
    expect(unwrapToolOutput({ type: 'execution-denied', reason: 'nope' })).toEqual({
      error: 'Tool execution denied: nope',
    });
    expect(
      unwrapToolOutput({
        type: 'content',
        value: [
          { type: 'text', text: 'a' },
          { type: 'image-url', url: 'https://x/y.png' },
        ],
      })
    ).toBe('a\n[image-url omitted]');
  });
});

describe('misc', () => {
  it('newPartId is unique per call', () => {
    expect(newPartId('t')).not.toBe(newPartId('t'));
  });

  it('EMPTY_USAGE reports all token counts as unknown', () => {
    expect(EMPTY_USAGE.inputTokens.total).toBeUndefined();
    expect(EMPTY_USAGE.outputTokens.total).toBeUndefined();
  });
});
