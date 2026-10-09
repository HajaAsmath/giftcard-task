#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import { HttpError } from '../errors';
import { LIABILITY_REPORT_TOOL, liabilityReportTool } from './tool';

const connectionString =
  process.env.MCP_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://giftcard_readonly:readonly@localhost:5432/giftcard';
const pool = new Pool({ connectionString });

const server = new Server(
  { name: 'giftcard-liability', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [LIABILITY_REPORT_TOOL] }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== LIABILITY_REPORT_TOOL.name) {
    return { isError: true, content: [{ type: 'text' as const, text: `unknown_tool: ${req.params.name}` }] };
  }
  try {
    const report = await liabilityReportTool(pool, req.params.arguments ?? {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] };
  } catch (err) {
    // stdout carries the protocol, so this goes to stderr.
    const e = err as HttpError;
    console.error(`liability_report refused: ${e.code ?? 'internal_error'}`);
    return { isError: true, content: [{ type: 'text' as const, text: `${e.code ?? 'internal_error'}: ${e.message}` }] };
  }
});

server.connect(new StdioServerTransport()).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'failed to start');
  process.exit(1);
});
