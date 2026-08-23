import { XorgateError, type XorgateApiErrorCode } from "./errors.js";
import type {
  FetchLike,
  HttpMethod,
  RawRequestInit,
  RetryOptions,
  XorgateAuth,
} from "./types.js";

/** The production deployment. `baseUrl` defaults here. */
export const DEFAULT_BASE_URL = "https://api.xorgate.io";

/**
 * The one version segment the SDK speaks. It is appended to `baseUrl` here
 * rather than being part of it, so pointing `baseUrl` at another deployment or
 * a proxy cannot silently drop the version and land on a deprecated
 * unversioned alias.
 */
export const VERSION_PREFIX = "/v1";

export const SDK_VERSION = "0.1.1";

/**
 * Make properties non-enumerable, so they cannot be serialized.
 *
 * TypeScript's `private` is a compile-time fiction: `private readonly auth` is
 * an ordinary enumerable property at runtime, reachable from the client, from
 * every resource module hanging off it, and therefore from anything that walks
 * the object. `JSON.stringify(client)` used to print the API key, and so did any
 * structured logger or error reporter handed the client. That is exactly the
 * leak this SDK tells people it does not have.
 *
 * The fields stay writable and readable; they simply stop showing up in
 * `Object.keys`, `JSON.stringify` and `console.log`. Applied to the two fields
 * that can hold a secret, which is the whole of it: the credential lives in
 * exactly one object.
 */
export function hideProperties(target: object, keys: string[]): void {
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) continue;
    Object.defineProperty(target, key, { ...descriptor, enumerable: false });
  }
}

export interface HttpCoreOptions {
  baseUrl?: string;
  auth: XorgateAuth;
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: RetryOptions | false;
  headers?: Record<string, string>;
  userAgent?: string;
}

interface ResolvedRetry {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Headers the caller may not override, because the SDK owns their meaning. */
const RESERVED_HEADERS = new Set([
  "authorization",
  "x-organization-id",
  "x-workspace-id",
  "x-request-id",
  "content-type",
]);

function invalidConfig(message: string): XorgateError {
  return new XorgateError({ code: "INVALID_CONFIG", message });
}

/**
 * Everything that touches the network. Auth resolution, tenancy headers,
 * `X-Request-ID` generation, `AbortSignal` merging for `timeoutMs`, error
 * mapping and GET-only retry all live here; every resource method is a thin
 * call into `request()`.
 */
export class HttpCore {
  readonly baseUrl: string;
  private readonly auth: XorgateAuth;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retry: ResolvedRetry | null;
  private readonly extraHeaders: Record<string, string>;
  private readonly userAgent: string;

  constructor(options: HttpCoreOptions) {
    const raw = options.baseUrl ?? DEFAULT_BASE_URL;
    this.baseUrl = normalizeBaseUrl(raw);

    if (!options.auth || typeof options.auth !== "object") {
      throw invalidConfig("`auth` is required: pass { apiKey } or { getToken }.");
    }
    const hasKey = typeof options.auth.apiKey === "string";
    const hasToken = typeof options.auth.getToken === "function";
    if (hasKey && hasToken) {
      throw invalidConfig(
        "`auth` takes exactly one of { apiKey } or { getToken }, not both.",
      );
    }
    if (!hasKey && !hasToken) {
      throw invalidConfig(
        "`auth` must be { apiKey: string } or { getToken: () => string }.",
      );
    }
    if (hasKey && options.auth.apiKey!.length === 0) {
      throw invalidConfig("`auth.apiKey` is an empty string.");
    }
    this.auth = options.auth;

    // The global must be BOUND: browsers implement `fetch` as a Window method,
    // and calling a detached reference (which `this.fetchImpl(...)` is) throws
    // "Illegal invocation". Node's fetch does not care, which is why every
    // Node-side suite passed while the first real browser consumer broke.
    // A caller-supplied fetch is used as given — its binding is its business.
    const fetchImpl =
      options.fetch ??
      (typeof globalThis.fetch === "function"
        ? (globalThis.fetch.bind(globalThis) as FetchLike)
        : undefined);
    if (typeof fetchImpl !== "function") {
      throw invalidConfig(
        "No global `fetch` in this runtime. Pass one as `fetch` in the client options.",
      );
    }
    this.fetchImpl = fetchImpl;

    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw invalidConfig("`timeoutMs` must be a positive number of milliseconds.");
    }

    this.retry =
      options.retry === undefined || options.retry === false
        ? null
        : {
            attempts: options.retry.attempts ?? 2,
            baseDelayMs: options.retry.baseDelayMs ?? 250,
            maxDelayMs: options.retry.maxDelayMs ?? 4_000,
          };

    this.extraHeaders = {};
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (RESERVED_HEADERS.has(key.toLowerCase())) continue;
      this.extraHeaders[key] = value;
    }

    this.userAgent = options.userAgent
      ? `xorgate-sdk-js/${SDK_VERSION} ${options.userAgent}`
      : `xorgate-sdk-js/${SDK_VERSION}`;

    // `auth` holds the credential. `headers` is caller-supplied and may hold a
    // second one. Neither is ever serializable from here on.
    hideProperties(this, ["auth", "extraHeaders"]);
  }

  /**
   * One request, with retry when the method and the failure both allow it.
   *
   * `tenancy` carries the headers the calling client wants on this request.
   * `HttpCore` is shared by derived clients, so it never holds them itself.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    init: RawRequestInit = {},
    tenancy: { organizationId?: string; workspaceId?: string } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, init.query);
    const attempts = this.retry && method === "GET" ? this.retry.attempts + 1 : 1;

    let lastError: XorgateError | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.attempt<T>(method, url, init, tenancy);
      } catch (e) {
        const err = e as XorgateError;
        lastError = err;
        const isLast = attempt === attempts - 1;
        if (isLast || !err.retryable || err.code === "ABORTED") throw err;
        await sleep(this.backoffMs(attempt, err), init.signal);
      }
    }
    // Unreachable: the loop either returns or throws.
    throw lastError;
  }

  /**
   * Full jitter, doubling, with a `Retry-After` floor.
   *
   * Rate limiting does not exist on the platform yet and arrives as gateway
   * throttling. Honouring `Retry-After` now means the SDK does not have to ship
   * in lockstep with it: when 429s become real, an already-deployed client
   * backs off the way the gateway asked instead of hammering it.
   */
  private backoffMs(attempt: number, err: XorgateError): number {
    const r = this.retry!;
    const ceiling = Math.min(r.baseDelayMs * 2 ** attempt, r.maxDelayMs);
    const jittered = Math.random() * ceiling;
    return err.retryAfterMs !== undefined
      ? Math.max(jittered, Math.min(err.retryAfterMs, r.maxDelayMs))
      : jittered;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = `${this.baseUrl}${VERSION_PREFIX}${suffix}`;
    if (!query) return url;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      search.append(key, String(value));
    }
    const qs = search.toString();
    return qs ? `${url}?${qs}` : url;
  }

  private async attempt<T>(
    method: HttpMethod,
    url: string,
    init: RawRequestInit,
    tenancy: { organizationId?: string; workspaceId?: string },
  ): Promise<T> {
    const requestId = randomRequestId();
    // Short-circuit an already-fired signal. `credential()` is awaited below,
    // so a caller that aborts in the same tick as the call gets here with the
    // signal already down; issuing the request anyway would mean a real network
    // round trip whose only possible outcome is this same error.
    if (init.signal?.aborted) {
      throw new XorgateError({
        code: "ABORTED",
        message: "The request was aborted before it was sent.",
        method,
        url,
        requestId,
      });
    }
    const headers: Record<string, string> = {
      ...this.extraHeaders,
      accept: "application/json",
      "x-request-id": requestId,
    };
    if (!isBrowser()) headers["user-agent"] = this.userAgent;

    try {
      headers["authorization"] = `Bearer ${await this.credential()}`;
    } catch (cause) {
      throw new XorgateError({
        code: "UNAUTHORIZED",
        message:
          "The `getToken` callback threw, so no credential could be resolved.",
        method,
        url,
        requestId,
        cause,
      });
    }

    if (tenancy.organizationId) {
      headers["x-organization-id"] = tenancy.organizationId;
    }
    const workspaceId = init.workspaceId ?? tenancy.workspaceId;
    if (workspaceId) headers["x-workspace-id"] = workspaceId;

    for (const [key, value] of Object.entries(init.headers ?? {})) {
      if (RESERVED_HEADERS.has(key.toLowerCase())) continue;
      headers[key] = value;
    }

    let body: string | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(TIMEOUT_REASON), this.timeoutMs);
    const detach = forwardAbort(init.signal, controller);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted && controller.signal.reason === TIMEOUT_REASON) {
        throw new XorgateError({
          code: "TIMEOUT",
          message: `No response within ${this.timeoutMs} ms.`,
          method,
          url,
          requestId,
          hint:
            "The production database auto-pauses when idle, so the first request " +
            "after a quiet period is slow. Do not set timeoutMs below ~3000.",
          cause,
        });
      }
      if (init.signal?.aborted) {
        throw new XorgateError({
          code: "ABORTED",
          message: "The request was aborted by its AbortSignal.",
          method,
          url,
          requestId,
          cause,
        });
      }
      throw new XorgateError({
        code: "NETWORK",
        message: describeNetworkError(cause),
        method,
        url,
        requestId,
        cause,
      });
    } finally {
      clearTimeout(timer);
      detach();
    }

    return await readResponse<T>(response, method, url, requestId);
  }

  private async credential(): Promise<string> {
    if (this.auth.apiKey !== undefined) return this.auth.apiKey;
    return await this.auth.getToken!();
  }
}

const TIMEOUT_REASON = "xorgate-sdk:timeout";

/** `crypto.randomUUID` where it exists, a good-enough fallback where it does not. */
function randomRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  let out = "";
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function isBrowser(): boolean {
  return typeof (globalThis as { document?: unknown }).document !== "undefined";
}

function normalizeBaseUrl(raw: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw invalidConfig("`baseUrl` must be a non-empty string when provided.");
  }
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalidConfig(
      `\`baseUrl\` is not a URL: ${JSON.stringify(raw)}. Expected an origin like "https://api.xorgate.io".`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidConfig("`baseUrl` must be an http(s) URL.");
  }
  if (trimmed.endsWith(VERSION_PREFIX)) {
    throw invalidConfig(
      "`baseUrl` must be a bare origin; the SDK appends `/v1` itself. " +
        `Pass ${JSON.stringify(trimmed.slice(0, -VERSION_PREFIX.length))} instead.`,
    );
  }
  return trimmed;
}

/** Bridges the caller's signal onto ours, and unhooks itself when done. */
function forwardAbort(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(
        new XorgateError({
          code: "ABORTED",
          message: "The request was aborted by its AbortSignal.",
        }),
      );
    }
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function describeNetworkError(cause: unknown): string {
  const message =
    cause instanceof Error ? cause.message : String(cause ?? "unknown error");
  return `The request never got an answer: ${message}`;
}

/** `Retry-After` is either delta-seconds or an HTTP date. Both are legal. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}

async function readResponse<T>(
  response: Response,
  method: HttpMethod,
  url: string,
  requestId: string,
): Promise<T> {
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const raw = await response.text().catch(() => "");
  let parsed: unknown = undefined;
  let parseFailed = false;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parseFailed = true;
    }
  }

  if (response.ok) {
    if (raw.length === 0) return undefined as T;
    if (parseFailed) {
      throw new XorgateError({
        code: "INVALID_RESPONSE",
        message:
          "The response was a success but its body was not JSON. That is usually " +
          "a proxy or a captive portal rather than the API.",
        status: response.status,
        method,
        url,
        requestId,
        details: { bodyPreview: raw.slice(0, 200) },
      });
    }
    return parsed as T;
  }

  throw errorFromResponse(response, parsed, raw, method, url, requestId);
}

function errorFromResponse(
  response: Response,
  parsed: unknown,
  raw: string,
  method: HttpMethod,
  url: string,
  requestId: string,
): XorgateError {
  const envelope =
    typeof parsed === "object" && parsed !== null
      ? (parsed as {
          error?: {
            code?: unknown;
            message?: unknown;
            details?: unknown;
            requestId?: unknown;
          };
        }).error
      : undefined;

  const apiCode =
    envelope && typeof envelope.code === "string"
      ? (envelope.code as XorgateApiErrorCode)
      : undefined;
  const apiMessage =
    envelope && typeof envelope.message === "string"
      ? envelope.message
      : undefined;
  const details =
    envelope && typeof envelope.details === "object" && envelope.details !== null
      ? (envelope.details as Record<string, unknown>)
      : undefined;
  const serverRequestId =
    envelope && typeof envelope.requestId === "string"
      ? envelope.requestId
      : undefined;

  // API Gateway throttling answers `{"message":"Too Many Requests"}` with no
  // code envelope at all, so 429 is recognized by status and named here.
  const code: XorgateApiErrorCode =
    apiCode ??
    (response.status === 429 ? "RATE_LIMITED" : statusFallbackCode(response.status));

  const retryAfterMs = response.status === 429
    ? parseRetryAfter(response.headers.get("retry-after"))
    : undefined;

  return new XorgateError({
    code,
    message: apiMessage ?? fallbackMessage(response, raw),
    status: response.status,
    ...(details ? { details } : {}),
    method,
    url,
    requestId,
    ...(serverRequestId !== undefined ? { serverRequestId } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(hintFor(code) ? { hint: hintFor(code) } : {}),
  });
}

function statusFallbackCode(status: number): XorgateApiErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 405) return "METHOD_NOT_ALLOWED";
  if (status === 409) return "CONFLICT";
  if (status >= 500) return "SERVER_ERROR";
  return "BAD_REQUEST";
}

function fallbackMessage(response: Response, raw: string): string {
  const text = raw.trim();
  if (text.length > 0 && text.length <= 200) return text;
  return `HTTP ${response.status} ${response.statusText}`.trim();
}

const HINTS: Partial<Record<XorgateApiErrorCode, string>> = {
  RATE_LIMITED:
    "The gateway is throttling. Retry is GET-only and off by default; enable " +
    "`retry` to have the SDK back off for you.",
  CONFIG_PUBLISH_FAILED:
    "The config write SUCCEEDED and only the retained MQTT publish failed. Do " +
    "not retry: the device self-heals on its next config report, and a retry " +
    "bumps configRev again.",
  USER_CREDENTIAL_REQUIRED:
    "This operation needs a signed-in user. An API key and a session token are " +
    "both refused on credential shape, before any lookup.",
  API_KEY_REQUIRED:
    "Minting a session token takes an `xg_` API key only. A user token and a " +
    "session token are both refused.",
  NOT_FOUND:
    "A resource in another organization also answers 404, so this does not " +
    "prove the resource does not exist.",
  SERVER_ERROR:
    "A 5xx with no error envelope, so it came from the gateway rather than " +
    "from the API. Retryable.",
  ORGANIZATION_REQUIRED:
    "Should be unreachable through the SDK, which always sends " +
    "X-Organization-Id. If you see it, the header was stripped in transit.",
};

function hintFor(code: XorgateApiErrorCode): string | undefined {
  return HINTS[code];
}
