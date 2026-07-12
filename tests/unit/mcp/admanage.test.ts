import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMANAGE_API_BASE_URL,
  ADMANAGE_TOOLS,
  buildAdManageUrl,
  callAdManageTool,
  handleJsonRpcRequest,
  loadAdManageApiKey,
  redactAdManageSecrets,
  type JsonRecord,
} from '../../../src/mcp/admanage';

const TEST_KEY = `ak_${'test_1234567890'}`;

describe('AdManage own-credential MCP', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
    vi.restoreAllMocks();
  });

  it('hardcodes the real AdManage API base URL', () => {
    expect(ADMANAGE_API_BASE_URL).toBe('https://api.admanage.ai/v1');
    expect(buildAdManageUrl('adaccounts')).toBe('https://api.admanage.ai/v1/adaccounts');
    expect(buildAdManageUrl('/manage/list-ads', { accountId: 'act_123', limit: 50 }))
      .toBe('https://api.admanage.ai/v1/manage/list-ads?accountId=act_123&limit=50');
  });

  it('uses ADMANAGE_API_KEY from env before reading secrets files', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'admanage-env-'));
    const secretsFile = join(tmpRoot, 'secrets.env');
    writeFileSync(secretsFile, 'ADMANAGE_API_KEY=ak_file_should_not_win\n', { mode: 0o600 });

    expect(loadAdManageApiKey({
      env: { ADMANAGE_API_KEY: TEST_KEY },
      secretsFiles: [secretsFile],
    })).toEqual({ ok: true, key: TEST_KEY, source: 'env' });
  });

  it('falls back to org secrets.env without leaking the key into config', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'admanage-secrets-'));
    const orgDir = join(tmpRoot, 'orgs', 'clean-green-marketing');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'secrets.env'), `ADMANAGE_API_KEY=${TEST_KEY}\n`, { mode: 0o600 });

    expect(loadAdManageApiKey({
      env: { CTX_PROJECT_ROOT: tmpRoot, CTX_ORG: 'clean-green-marketing' },
      cwd: tmpRoot,
    })).toEqual({ ok: true, key: TEST_KEY, source: 'secrets-file' });
  });

  it('returns an auth_config_missing error on call when the key is absent', async () => {
    const fetchImpl = vi.fn();
    const result = await callAdManageTool('admanage_list_ad_accounts', {}, {
      env: {},
      secretsFiles: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: 'auth_config_missing',
        message: 'ADMANAGE_API_KEY is not configured',
        status: 500,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('constructs fixed endpoint GET requests with auth and passthrough query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: [] }));

    const result = await callAdManageTool('admanage_list_ads', {
      accountId: 'act_123',
      status: ['ACTIVE', 'DISAPPROVED'],
    }, {
      env: { ADMANAGE_API_KEY: TEST_KEY },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ success: true, data: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.admanage.ai/v1/manage/list-ads?accountId=act_123&status=ACTIVE&status=DISAPPROVED');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TEST_KEY}`,
      Accept: 'application/json',
    });
  });

  it('surfaces 429 rate limits with AdManage headers and never retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, {
      success: false,
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests',
        requestId: 'req_123',
      },
    }, {
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1234567890',
      'retry-after': '30',
    }));

    const result = await callAdManageTool('admanage_daily_spend', {
      startDate: '2026-07-01',
      endDate: '2026-07-12',
    }, {
      env: { ADMANAGE_API_KEY: TEST_KEY },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: false,
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests',
        requestId: 'req_123',
        status: 429,
        rateLimit: {
          limit: '60',
          remaining: '0',
          reset: '1234567890',
          retryAfter: '30',
        },
      },
    });
  });

  it('redacts ak_ tokens and Authorization headers from errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error(`upstream logged Authorization: Bearer ${TEST_KEY} and token ${TEST_KEY}`),
    );

    const result = await callAdManageTool('admanage_get_report_fields', {}, {
      env: { ADMANAGE_API_KEY: TEST_KEY },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
    expect(result).toEqual({
      success: false,
      error: {
        code: 'network_error',
        message: 'upstream logged [REDACTED] and token [REDACTED]',
      },
    });
    expect(redactAdManageSecrets(`Bearer ${TEST_KEY}`)).toBe('[REDACTED]');
  });

  it('lists only the eight read-only MCP tools', async () => {
    const response = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(response?.result?.tools).toEqual(ADMANAGE_TOOLS);
    expect(ADMANAGE_TOOLS.map((tool) => tool.name)).toEqual([
      'admanage_list_ad_accounts',
      'admanage_list_ads',
      'admanage_list_drafts',
      'admanage_get_report_fields',
      'admanage_query_reports',
      'admanage_daily_spend',
      'admanage_list_changes',
      'admanage_get_batch_status',
    ]);
    expect(ADMANAGE_TOOLS.map((tool) => tool.name).join(' ')).not.toMatch(/launch|publish|update_status|create_draft/);
  });

  it('handles MCP initialize and tools/call through the JSON-RPC surface', async () => {
    const init = await handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });
    expect(init?.result?.capabilities).toEqual({ tools: {} });

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: [{ id: 'act_123' }] }));
    const response = await handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'admanage_list_ad_accounts',
        arguments: {},
      },
    }, {
      env: { ADMANAGE_API_KEY: TEST_KEY },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(response?.error).toBeUndefined();
    expect(response?.result?.isError).toBe(false);
    const content = response?.result?.content as JsonRecord[] | undefined;
    expect(content?.[0]?.type).toBe('text');
    expect(String(content?.[0]?.text)).toContain('act_123');
  });

  it('maps batch status ids into the path segment', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { id: 'batch/1' } }));

    await callAdManageTool('admanage_get_batch_status', { id: 'batch/1' }, {
      env: { ADMANAGE_API_KEY: TEST_KEY },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.admanage.ai/v1/batch-status/batch%2F1');
  });
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}
