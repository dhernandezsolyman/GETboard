import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const robots = readFileSync(
  join(__dirname, '..', 'public', 'robots.txt'),
  'utf8',
);

// Minimal robots.txt parser: returns the rules for a given user-agent group,
// honoring the most-specific matching group (exact name, else '*').
function rulesFor(userAgent: string): { allow: string[]; disallow: string[] } {
  const lines = robots
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);

  const groups: Record<string, { allow: string[]; disallow: string[] }> = {};
  let current: string[] = [];
  let expectingAgents = true;

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.toLowerCase().trim();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!expectingAgents) current = [];
      current.push(value);
      groups[value] ??= { allow: [], disallow: [] };
      expectingAgents = true;
    } else if (key === 'allow' || key === 'disallow') {
      expectingAgents = false;
      for (const agent of current) groups[agent][key].push(value);
    }
  }

  return groups[userAgent] ?? groups['*'] ?? { allow: [], disallow: [] };
}

describe('robots.txt', () => {
  it('allows Claude-User (user-initiated agent fetcher)', () => {
    const r = rulesFor('Claude-User');
    expect(r.allow).toContain('/');
    expect(r.disallow).not.toContain('/');
  });

  it('allows ChatGPT-User', () => {
    const r = rulesFor('ChatGPT-User');
    expect(r.allow).toContain('/');
    expect(r.disallow).not.toContain('/');
  });

  it('blocks general crawlers via the wildcard group', () => {
    const r = rulesFor('SomeRandomCrawler');
    expect(r.disallow).toContain('/');
  });
});
