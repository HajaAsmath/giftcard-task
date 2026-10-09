import { Pool, PoolClient } from 'pg';
import { BadRequest } from '../errors';
import { LiabilityReport, liabilityReport } from '../report';

export const LIABILITY_REPORT_TOOL = {
  name: 'liability_report',
  description:
    'Monthly gift card liability per issuing store, with overdrawn, expired, intercompany and refused movement flags. ' +
    'Returns the same JSON as GET /reports/liability. Omit store_id for the whole group.',
  inputSchema: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'Calendar month as YYYY-MM, for example 2026-09' },
      store_id: { type: 'string', description: 'Optional store id, for example s1. Omit for the whole group.' },
    },
    required: ['month'],
    additionalProperties: false,
  },
} as const;

/** The tool's handler as a plain function, so it can be tested without an MCP client or an LLM key. */
export async function liabilityReportTool(db: Pool | PoolClient, args: unknown): Promise<LiabilityReport> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new BadRequest('invalid_arguments', 'arguments must be an object with a month');
  }
  const { month, store_id: storeId } = args as { month?: unknown; store_id?: unknown };
  if (storeId !== undefined && typeof storeId !== 'string') {
    throw new BadRequest('invalid_store_id', 'store_id must be a string');
  }
  return liabilityReport(db, month, storeId);
}
