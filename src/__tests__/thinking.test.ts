import { stripThinking } from '../thinking';

describe('stripThinking', () => {
  it('passes text without think blocks through untouched', () => {
    expect(stripThinking('Just an answer.')).toEqual({
      text: 'Just an answer.',
      reasoning: '',
    });
  });

  it('splits a single closed block', () => {
    expect(stripThinking('<think>\nlet me reason\n</think>\nThe answer is 4.')).toEqual({
      text: 'The answer is 4.',
      reasoning: 'let me reason',
    });
  });

  it('handles multiple blocks, joining the reasoning', () => {
    const out = stripThinking('<think>a</think>Hello <think>b</think>world');
    expect(out.text).toBe('Hello world');
    expect(out.reasoning).toBe('a\n\nb');
  });

  it('treats an unclosed trailing <think> as reasoning (truncated generation)', () => {
    const out = stripThinking('Partial answer. <think>never finished reasoning');
    expect(out.text).toBe('Partial answer.');
    expect(out.reasoning).toBe('never finished reasoning');
  });

  it('yields empty text when the whole output is one unclosed think block', () => {
    const out = stripThinking('<think>all reasoning, no answer');
    expect(out.text).toBe('');
    expect(out.reasoning).toBe('all reasoning, no answer');
  });

  it('ignores JSON-looking content inside think blocks', () => {
    const out = stripThinking(
      '<think>maybe {"tool":"evil","arguments":{}} would work?</think>{"ok":true}'
    );
    expect(out.text).toBe('{"ok":true}');
  });

  it('handles empty blocks and non-string input defensively', () => {
    expect(stripThinking('<think></think>hi').text).toBe('hi');
    expect(stripThinking('<think></think>hi').reasoning).toBe('');
    expect(stripThinking(undefined as unknown as string)).toEqual({ text: '', reasoning: '' });
  });
});
