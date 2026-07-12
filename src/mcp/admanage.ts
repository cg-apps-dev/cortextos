import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseEnvFile } from '../utils/env.js';

export const ADMANAGE_API_BASE_URL = 'https://api.admanage.ai/v1';
export const ADMANAGE_API_KEY_ENV = 'ADMANAGE_API_KEY';

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

export interface RateLimitInfo {
  limit?: string;
  remaining?: string;
  reset?: string;
  retryAfter?: string;
}

export interface AdManageErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    status?: number;
    rateLimit?: RateLimitInfo;
  };
}

export type AdManageResult = unknown;

interface LoadKeyOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  secretsFiles?: string[];
}

interface LoadedKey {
  ok: true;
  key: string;
  source: 'env' | 'secrets-file';
}

interface LoadKeyError {
  ok: false;
  error: AdManageErrorBody;
}

type LoadKeyResult = LoadedKey | LoadKeyError;

export interface AdManageClientOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  secretsFiles?: string[];
  fetchImpl?: typeof fetch;
}

export interface AdManageRequest {
  path: string;
  query?: JsonRecord;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonRecord;
}

const SECRET_REDACTION_PATTERNS = [
  /Authorization:\s*Bearer\s+[^\s,'"}]+/gi,
  /Bearer\s+ak_[A-Za-z0-9._-]+/g,
  /ak_[A-Za-z0-9._-]+/g,
];

const COMMON_QUERY_SCHEMA: JsonRecord = {
  type: 'object',
  additionalProperties: {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
    ],
  },
};

export const ADMANAGE_TOOLS: ToolDefinition[] = [
  {
    name: 'admanage_list_ad_accounts',
    description: 'List connected AdManage ad accounts from GET /v1/adaccounts.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'admanage_list_ads',
    description: 'List ads via GET /v1/manage/list-ads. Pass accountId=act_... or adSetId=... plus optional filters.',
    inputSchema: {
      ...COMMON_QUERY_SCHEMA,
      properties: {
        accountId: { type: 'string' },
        adSetId: { type: 'string' },
        campaignId: { type: 'string' },
        page: { type: 'number' },
        pageSize: { type: 'number' },
        limit: { type: 'number' },
        sortBy: { type: 'string' },
        sortOrder: { type: 'string' },
      },
    },
  },
  {
    name: 'admanage_list_drafts',
    description: 'List AdManage drafts from GET /v1/drafts.',
    inputSchema: {
      ...COMMON_QUERY_SCHEMA,
      properties: {
        page: { type: 'number' },
        pageSize: { type: 'number' },
        limit: { type: 'number' },
        sortBy: { type: 'string' },
        sortOrder: { type: 'string' },
      },
    },
  },
  {
    name: 'admanage_get_report_fields',
    description: 'Fetch available report dimensions and metrics from GET /v1/reports/fields.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'admanage_query_reports',
    description: 'Query AdManage reporting from GET /v1/reports/query with passthrough query params.',
    inputSchema: COMMON_QUERY_SCHEMA,
  },
  {
    name: 'admanage_daily_spend',
    description: 'Fetch daily spend from GET /v1/spend/daily. Requires startDate and endDate as YYYY-MM-DD.',
    inputSchema: {
      ...COMMON_QUERY_SCHEMA,
      required: ['startDate', 'endDate'],
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        accountId: { type: 'string' },
        businessId: { type: 'string' },
      },
    },
  },
  {
    name: 'admanage_list_changes',
    description: 'List AdManage change history from GET /v1/manage/changes. Pass businessId=act_...',
    inputSchema: {
      ...COMMON_QUERY_SCHEMA,
      required: ['businessId'],
      properties: {
        businessId: { type: 'string' },
        page: { type: 'number' },
        pageSize: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'admanage_get_batch_status',
    description: 'Fetch batch status from GET /v1/batch-status/{id}.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
];

export function redactAdManageSecrets(input: string): string {
  return SECRET_REDACTION_PATTERNS.reduce((value, pattern) => value.replace(pattern, '[REDACTED]'), input);
}

export function loadAdManageApiKey(options: LoadKeyOptions = {}): LoadKeyResult {
  const env = options.env ?? process.env;
  const envValue = env[ADMANAGE_API_KEY_ENV]?.trim();
  if (envValue) {
    return validateLoadedKey(envValue, 'env');
  }

  for (const filePath of resolveSecretFileCandidates(options)) {
    if (!existsSync(filePath)) continue;
    const parsed = parseEnvFile(filePath);
    const fileValue = parsed[ADMANAGE_API_KEY_ENV]?.trim();
    if (fileValue) {
      return validateLoadedKey(fileValue, 'secrets-file');
    }
  }

  return {
    ok: false,
    error: makeError('auth_config_missing', `${ADMANAGE_API_KEY_ENV} is not configured`, 500),
  };
}

export function createAdManageClient(options: AdManageClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async request(request: AdManageRequest): Promise<AdManageResult> {
      const loaded = loadAdManageApiKey(options);
      if (!loaded.ok) return loaded.error;

      const url = buildAdManageUrl(request.path, request.query);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${loaded.key}`,
            Accept: 'application/json',
          },
        });
        return await normalizeAdManageResponse(response);
      } catch (error) {
        return makeError('network_error', redactAdManageSecrets(errorMessage(error)), undefined);
      }
    },
  };
}

export async function callAdManageTool(
  name: string,
  args: JsonRecord = {},
  options: AdManageClientOptions = {},
): Promise<AdManageResult> {
  const client = createAdManageClient(options);

  switch (name) {
    case 'admanage_list_ad_accounts':
      return client.request({ path: 'adaccounts' });
    case 'admanage_list_ads':
      return client.request({ path: 'manage/list-ads', query: args });
    case 'admanage_list_drafts':
      return client.request({ path: 'drafts', query: args });
    case 'admanage_get_report_fields':
      return client.request({ path: 'reports/fields' });
    case 'admanage_query_reports':
      return client.request({ path: 'reports/query', query: args });
    case 'admanage_daily_spend':
      return client.request({ path: 'spend/daily', query: args });
    case 'admanage_list_changes':
      return client.request({ path: 'manage/changes', query: args });
    case 'admanage_get_batch_status': {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) return makeError('invalid_arguments', 'admanage_get_batch_status requires a non-empty id', 400);
      return client.request({ path: `batch-status/${encodeURIComponent(id)}` });
    }
    default:
      return makeError('unknown_tool', `Unknown AdManage tool: ${name}`, 400);
  }
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: JsonRecord;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: JsonRecord;
  error?: {
    code: number;
    message: string;
  };
}

export async function handleJsonRpcRequest(
  rawRequest: unknown,
  options: AdManageClientOptions = {},
): Promise<JsonRpcResponse | undefined> {
  if (!isRecord(rawRequest)) {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }

  const request = rawRequest as JsonRpcRequest;
  if (request.id === undefined) {
    return undefined;
  }

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return jsonRpcError(request.id ?? null, -32600, 'Invalid Request');
  }

  if (request.method === 'initialize') {
    return jsonRpcResult(request.id ?? null, {
      protocolVersion: stringParam(request.params?.protocolVersion) ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'admanage-own-cred',
        version: '0.1.0',
      },
    });
  }

  if (request.method === 'tools/list') {
    return jsonRpcResult(request.id ?? null, { tools: ADMANAGE_TOOLS as unknown as JsonValue });
  }

  if (request.method === 'tools/call') {
    const params = request.params ?? {};
    const toolName = typeof params.name === 'string' ? params.name : '';
    const toolArgs = isRecord(params.arguments) ? params.arguments as JsonRecord : {};
    if (!toolName) {
      return jsonRpcError(request.id ?? null, -32602, 'tools/call requires params.name');
    }

    const result = await callAdManageTool(toolName, toolArgs, options);
    return jsonRpcResult(request.id ?? null, {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: isAdManageError(result),
    });
  }

  return jsonRpcError(request.id ?? null, -32601, `Method not found: ${request.method}`);
}

export function buildAdManageUrl(path: string, query: JsonRecord = {}): string {
  const cleanPath = path.replace(/^\/+/, '');
  const url = new URL(`${ADMANAGE_API_BASE_URL}/${cleanPath}`);
  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(url, key, value);
  }
  return url.toString();
}

function appendQueryValue(url: URL, key: string, value: JsonValue | undefined): void {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(url, key, item);
    return;
  }
  if (typeof value === 'object') {
    url.searchParams.append(key, JSON.stringify(value));
    return;
  }
  url.searchParams.append(key, String(value));
}

async function normalizeAdManageResponse(response: Response): Promise<AdManageResult> {
  const text = await response.text();
  const rateLimit = extractRateLimit(response.headers);
  let body: JsonValue | undefined;

  try {
    body = text ? JSON.parse(text) as JsonValue : null;
  } catch {
    return makeError('invalid_json', `AdManage returned non-JSON response with HTTP ${response.status}`, response.status, undefined, rateLimit);
  }

  if (response.ok) return body ?? {};

  if (isRecord(body) && isRecord(body.error)) {
    const upstream = body.error;
    const code = stringParam(upstream.code) ?? (response.status === 429 ? 'rate_limit_exceeded' : `http_${response.status}`);
    const message = stringParam(upstream.message) ?? `AdManage request failed with HTTP ${response.status}`;
    const requestId = stringParam(upstream.requestId);
    return makeError(code, redactAdManageSecrets(message), response.status, requestId, rateLimit);
  }

  return makeError(
    response.status === 429 ? 'rate_limit_exceeded' : `http_${response.status}`,
    `AdManage request failed with HTTP ${response.status}`,
    response.status,
    undefined,
    rateLimit,
  );
}

function extractRateLimit(headers: Headers): RateLimitInfo | undefined {
  const rateLimit: RateLimitInfo = {
    limit: headers.get('x-ratelimit-limit') ?? undefined,
    remaining: headers.get('x-ratelimit-remaining') ?? undefined,
    reset: headers.get('x-ratelimit-reset') ?? undefined,
    retryAfter: headers.get('retry-after') ?? undefined,
  };
  return Object.values(rateLimit).some(Boolean) ? rateLimit : undefined;
}

function resolveSecretFileCandidates(options: LoadKeyOptions): string[] {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const candidates = new Set<string>(options.secretsFiles ?? []);
  const org = env.CTX_ORG;
  const projectRoot = env.CTX_PROJECT_ROOT;
  const frameworkRoot = env.CTX_FRAMEWORK_ROOT;

  if (org && projectRoot) candidates.add(join(projectRoot, 'orgs', org, 'secrets.env'));
  if (org && frameworkRoot) candidates.add(join(frameworkRoot, 'orgs', org, 'secrets.env'));

  let current = cwd;
  for (;;) {
    candidates.add(join(current, 'secrets.env'));
    if (org) candidates.add(join(current, 'orgs', org, 'secrets.env'));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return Array.from(candidates);
}

function validateLoadedKey(key: string, source: LoadedKey['source']): LoadKeyResult {
  if (!key.startsWith('ak_')) {
    return {
      ok: false,
      error: makeError('auth_config_invalid', `${ADMANAGE_API_KEY_ENV} must start with ak_`, 500),
    };
  }
  return { ok: true, key, source };
}

function makeError(
  code: string,
  message: string,
  status?: number,
  requestId?: string,
  rateLimit?: RateLimitInfo,
): AdManageErrorBody {
  return {
    success: false,
    error: {
      code,
      message: redactAdManageSecrets(message),
      ...(requestId ? { requestId } : {}),
      ...(status ? { status } : {}),
      ...(rateLimit ? { rateLimit } : {}),
    },
  };
}

function isAdManageError(value: unknown): value is AdManageErrorBody {
  return isRecord(value) && value.success === false && isRecord(value.error);
}

function jsonRpcResult(id: string | number | null, result: JsonRecord): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function stringParam(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function runStdioServer(): Promise<void> {
  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    void flushLines();
  });

  async function flushLines(): Promise<void> {
    for (;;) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Parse error'))}\n`);
        continue;
      }

      try {
        const response = await handleJsonRpcRequest(parsed);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        const id = isRecord(parsed) && (typeof parsed.id === 'string' || typeof parsed.id === 'number' || parsed.id === null)
          ? parsed.id
          : null;
        process.stdout.write(`${JSON.stringify(jsonRpcError(id, -32603, redactAdManageSecrets(errorMessage(error))))}\n`);
      }
    }
  }
}

if (require.main === module) {
  void runStdioServer().catch((error) => {
    process.stderr.write(`${redactAdManageSecrets(errorMessage(error))}\n`);
    process.exit(1);
  });
}
