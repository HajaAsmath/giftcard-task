import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReplayLine {
  sent_at: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  concurrent_group?: string;
}

export interface ReplayResult {
  line: number;
  method: string;
  path: string;
  status: number;
  code?: string;
  text: string;
}

const FIXTURE = join(__dirname, '..', 'fixtures', 'requests.jsonl');

export function readFixtureLines(file = FIXTURE): ReplayLine[] {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Sends the lines in file order. Consecutive lines that share a concurrent_group are sent at the same
 * moment, and the whole group finishes before the next line starts. Refusals are results, not errors.
 */
export async function replayFixtures(baseUrl: string, lines: ReplayLine[] = readFixtureLines()): Promise<ReplayResult[]> {
  const results: ReplayResult[] = [];
  let i = 0;
  while (i < lines.length) {
    const group = lines[i].concurrent_group;
    let end = i + 1;
    if (group) while (end < lines.length && lines[end].concurrent_group === group) end++;
    const sent = await Promise.all(lines.slice(i, end).map((l, k) => send(baseUrl, l, i + k + 1)));
    results.push(...sent);
    i = end;
  }
  return results;
}

async function send(baseUrl: string, l: ReplayLine, line: number): Promise<ReplayResult> {
  const res = await fetch(baseUrl + l.path, {
    method: l.method,
    headers: { 'Content-Type': 'application/json', ...l.headers },
    body: l.body === undefined ? undefined : JSON.stringify(l.body),
  });
  const text = await res.text();
  let code: string | undefined;
  try { code = JSON.parse(text)?.error?.code; } catch { /* not JSON */ }
  return { line, method: l.method, path: l.path, status: res.status, code, text };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (require.main === module) {
  const baseUrl = arg('--base-url', 'http://localhost:3100').replace(/\/$/, '');
  const month = arg('--month', '2026-09');
  (async () => {
    const results = await replayFixtures(baseUrl);
    for (const r of results) console.log(`${String(r.line).padStart(2)}  ${r.method} ${r.path.padEnd(18)} ${r.status}${r.code ? ` ${r.code}` : ''}`);
    const report = await fetch(`${baseUrl}/reports/liability?month=${month}`);
    console.log(`\nGET /reports/liability?month=${month} -> ${report.status}`);
    console.log(JSON.stringify(await report.json(), null, 2));
  })().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
