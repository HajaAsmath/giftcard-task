import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Harness, getReport, startHarness } from './harness';
import { replayFixtures } from '../src/replay';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await replayFixtures(h.baseUrl);
});
afterAll(async () => { await h.stop(); });

async function connect() {
  const client = new Client({ name: 'giftcard-test', version: '1.0.0' });
  // The documented startup command, with the read-only role as the MCP server's connection.
  await client.connect(new StdioClientTransport({
    command: 'node_modules/.bin/tsx',
    args: ['src/mcp/server.ts'],
    env: { ...process.env, MCP_DATABASE_URL: h.readOnlyUrl } as Record<string, string>,
  }));
  return client;
}

test('the stdio server exposes one tool and answers with the report over the protocol', async () => {
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['liability_report']);

    const result = await client.callTool({ name: 'liability_report', arguments: { month: '2026-09' } });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual((await getReport(h.baseUrl, '2026-09')).json);
  } finally {
    await client.close();
  }
});

test('the stdio server filters by store and refuses bad input', async () => {
  const client = await connect();
  try {
    const scoped = await client.callTool({ name: 'liability_report', arguments: { month: '2026-09', store_id: 's2' } });
    const report = JSON.parse((scoped.content as { text: string }[])[0].text);
    expect(report.stores.map((s: any) => s.store_id)).toEqual(['s2']);

    const bad = await client.callTool({ name: 'liability_report', arguments: { month: 'nope' } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0].text).toContain('invalid_month');

    const unknown = await client.callTool({ name: 'liability_report', arguments: { month: '2026-09', store_id: 's9' } });
    expect(unknown.isError).toBe(true);
    expect((unknown.content as { text: string }[])[0].text).toContain('unknown_store');
  } finally {
    await client.close();
  }
});
