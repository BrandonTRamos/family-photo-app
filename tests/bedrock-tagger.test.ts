import { describe, expect, it } from 'vitest';
import { parseTagJson } from '../core/adapters/aws.js';

describe('reading the AI model reply', () => {
  it('reads the asked-for shape', () => {
    expect(parseTagJson('{"tags":["beach","sunny day"]}')).toEqual(['beach', 'sunny day']);
  });

  it('reads JSON wrapped in a code fence or prose', () => {
    expect(parseTagJson('Here you go:\n```json\n{"tags": ["nail salon", "child"]}\n```')).toEqual(['nail salon', 'child']);
  });

  it('reads a bare list', () => {
    expect(parseTagJson('["chair", "mirror"]')).toEqual(['chair', 'mirror']);
  });

  it('keeps the tags from a reply cut off mid-list by a repetition loop', () => {
    const cut = '{"tags":["fountain","water","child","minnie mouse","earring","earring","earring","ea';
    expect(parseTagJson(cut)).toEqual(['fountain', 'water', 'child', 'minnie mouse', 'earring', 'earring', 'earring']);
  });

  it('refuses a reply with no tags, so the photo is retried instead of marked done', () => {
    expect(() => parseTagJson('I cannot help with that.')).toThrow(/no tags.*I cannot help/);
    expect(() => parseTagJson('{"tags":[]}')).toThrow(/no tags/);
  });
});
