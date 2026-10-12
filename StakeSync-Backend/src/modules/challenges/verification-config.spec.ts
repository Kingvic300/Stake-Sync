import { fileCounts } from '../verification/clients/github.js';
import { sanitizeVerificationConfig } from './verification-config.js';

describe('verification matrix settings', () => {
  it('keeps GitHub language, path and commit rules', () => {
    const c = sanitizeVerificationConfig({ github: { minCommits: 2, languages: ['Rust'], paths: ['src/', 'Cargo.toml'] } });
    expect(c.github).toEqual({ minCommits: 2, languages: ['Rust'], paths: ['src/', 'Cargo.toml'] });
  });

  it('rejects unknown languages and paths that climb out of the repo', () => {
    expect(() => sanitizeVerificationConfig({ github: { languages: ['Klingon'] } })).toThrow();
    expect(() => sanitizeVerificationConfig({ github: { paths: ['../secrets'] } })).toThrow();
  });

  it('numbers custom rules and never lets a self-reported rule be required', () => {
    const c = sanitizeVerificationConfig({
      criteria: [
        { text: 'Read 20 pages', frequency: 'daily', check: 'photo', required: true },
        { text: 'Post a summary on X', frequency: 'weekly', check: 'self', required: true },
      ],
    });
    expect(c.criteria).toEqual([
      { id: 'r1', text: 'Read 20 pages', frequency: 'daily', check: 'photo', required: true },
      { id: 'r2', text: 'Post a summary on X', frequency: 'weekly', check: 'self', required: false },
    ]);
  });

  it('rejects empty or too many rules', () => {
    expect(() => sanitizeVerificationConfig({ criteria: [{ text: 'hi' }] })).toThrow();
    expect(() => sanitizeVerificationConfig({ criteria: Array.from({ length: 11 }, () => ({ text: 'Do the thing' })) })).toThrow();
  });

  it('counts only files that match the language and path rules', () => {
    const f = { extensions: ['.rs'], paths: ['src/'] };
    expect(fileCounts('src/main.rs', f)).toBe(true);
    expect(fileCounts('README.md', f)).toBe(false);
    expect(fileCounts('tests/main.rs', f)).toBe(false);
    expect(fileCounts('Cargo.toml', { paths: ['Cargo.toml'] })).toBe(true);
    expect(fileCounts('anything.txt', {})).toBe(true);
  });

  it('keeps a LeetCode problem list, one or more problems a day', () => {
    const c = sanitizeVerificationConfig({ leetcode: { assigned: 'list', schedule: [['two-sum'], ['add-two-numbers', 'valid-parentheses']] } });
    expect(c.leetcode).toMatchObject({ newOnly: true, assigned: 'list', schedule: [['two-sum'], ['add-two-numbers', 'valid-parentheses']] });
  });

  it('rejects a problem list with empty days or links that aren’t LeetCode problems', () => {
    expect(() => sanitizeVerificationConfig({ leetcode: { assigned: 'list', schedule: [['two-sum'], []] } })).toThrow();
    expect(() => sanitizeVerificationConfig({ leetcode: { assigned: 'list', schedule: [['https://evil.example/x']] } })).toThrow();
    expect(() => sanitizeVerificationConfig({ leetcode: { assigned: 'list' } })).toThrow();
  });

  it('drops the schedule when following LeetCode’s daily question', () => {
    const c = sanitizeVerificationConfig({ leetcode: { assigned: 'daily', schedule: [['two-sum']] } });
    expect(c.leetcode?.assigned).toBe('daily');
    expect(c.leetcode?.schedule).toBeUndefined();
  });
});
