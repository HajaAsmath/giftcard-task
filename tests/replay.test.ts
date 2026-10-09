import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { replayFixtures, ReplayLine } from '../src/replay';

interface Seen { path: string; started: number; finished: number; key: string }

const open: Server[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((srv) => new Promise((resolve) => srv.close(resolve)))); });

/** A stub API that answers after `delayMs` and records when each request started and finished. */
async function stub(statusFor: (path: string) => number, delayMs = 80) {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const entry: Seen = { path: req.url ?? '', started: performance.now(), finished: 0, key: String(req.headers['idempotency-key']) };
    seen.push(entry);
    req.resume();
    req.on('end', () => setTimeout(() => {
      entry.finished = performance.now();
      const status = statusFor(entry.path);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status >= 400 ? { error: { code: 'stub' } } : { ok: true }));
    }, delayMs));
  });
  open.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { seen, baseUrl };
}

const line = (path: string, key: string, group?: string): ReplayLine => ({
  sent_at: '2026-09-01T00:00:00Z', method: 'POST', path, headers: { 'Idempotency-Key': key }, body: { n: key },
  ...(group ? { concurrent_group: group } : {}),
});

test('requests are sent in file order, one after another, when they share no group', async () => {
  const api = await stub(() => 201);
  await replayFixtures(api.baseUrl, [line('/a', 'k1'), line('/b', 'k2'), line('/c', 'k3')]);
  expect(api.seen.map((s) => s.key)).toEqual(['k1', 'k2', 'k3']);
  expect(api.seen[1].started).toBeGreaterThanOrEqual(api.seen[0].finished);
  expect(api.seen[2].started).toBeGreaterThanOrEqual(api.seen[1].finished);
});

test('requests in one concurrent_group overlap, and the group finishes before the next request starts', async () => {
  const api = await stub(() => 201);
  await replayFixtures(api.baseUrl, [line('/a', 'k1'), line('/g1', 'k2', 'g1'), line('/g2', 'k3', 'g1'), line('/z', 'k4')]);
  const [, g1, g2, z] = api.seen.slice().sort((a, b) => a.started - b.started);
  expect(Math.max(g1.started, g2.started)).toBeLessThan(Math.min(g1.finished, g2.finished));
  expect(z.started).toBeGreaterThanOrEqual(Math.max(g1.finished, g2.finished));
});

test('refusals do not stop the replay, and every result is returned in file order', async () => {
  const api = await stub((path) => ({ '/a': 201, '/b': 422, '/c': 409, '/d': 201 })[path] ?? 500);
  const results = await replayFixtures(api.baseUrl, [line('/a', 'k1'), line('/b', 'k2'), line('/c', 'k3'), line('/d', 'k4')]);
  expect(results.map((r) => [r.line, r.status, r.code])).toEqual([[1, 201, undefined], [2, 422, 'stub'], [3, 409, 'stub'], [4, 201, undefined]]);
});

test('the fixture file replays against the stub with its two concurrent groups sent together', async () => {
  const api = await stub(() => 201, 40);
  const results = await replayFixtures(api.baseUrl);
  expect(results).toHaveLength(23);
  const byKey = (k: string) => api.seen.find((s) => s.key === k)!;
  const [a, b] = [byKey('k-c3-r1'), byKey('k-c3-r2')];
  expect(Math.max(a.started, b.started)).toBeLessThan(Math.min(a.finished, b.finished));
});
