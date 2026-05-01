import { describe, it, expect } from 'vitest';
import { tryParseJSON } from './jsonExtract.js';

describe('tryParseJSON', () => {
  it('parses bare JSON', () => {
    expect(tryParseJSON<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in ```json fence', () => {
    expect(tryParseJSON<{ a: number }>('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in plain ``` fence', () => {
    expect(tryParseJSON<{ a: number }>('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in fence with no newlines', () => {
    expect(tryParseJSON<{ a: number }>('```json{"a": 1}```')).toEqual({ a: 1 });
  });

  it('extracts a JSON object embedded in prose', () => {
    const input = 'Here is your answer: {"questions": ["x", "y"]} hope this helps';
    expect(tryParseJSON<{ questions: string[] }>(input)).toEqual({
      questions: ['x', 'y'],
    });
  });

  it('parses arrays at the top level via the bare-JSON path', () => {
    expect(tryParseJSON<number[]>('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('handles surrounding whitespace', () => {
    expect(tryParseJSON<{ a: number }>('  \n  {"a": 1}  \n  ')).toEqual({ a: 1 });
  });

  it('returns null on completely invalid input', () => {
    expect(tryParseJSON('not json at all')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(tryParseJSON('')).toBeNull();
  });

  it('returns null on malformed JSON inside fence', () => {
    expect(tryParseJSON('```json\n{not valid}\n```')).toBeNull();
  });

  it('preserves nested objects when extracting from prose', () => {
    const input = 'Result: {"outer": {"inner": [1, 2]}, "x": "y"} done';
    expect(tryParseJSON<{ outer: { inner: number[] }; x: string }>(input)).toEqual({
      outer: { inner: [1, 2] },
      x: 'y',
    });
  });
});
