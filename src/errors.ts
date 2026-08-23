import type { HttpMethod } from "./types.js";

/**
 * Codes the API returns in `{ error: { code } }`.
 *
 * Wider than the 2026-08-10 design sketch: the auth, session-token and
 * workspace-scope codes arrived with `plans/done/platform-auth-and-live-plane/`
 * and are already documented on the docs site's Errors page. `RATE_LIMITED` is
 * the SDK's name for a bare gateway 429, which carries no code of its own.
 * `SERVER_ERROR` names any 5xx without a code; since API productization the
 * API also emits it itself, in a full envelope, for an unhandled failure.
 */
export type XorgateApiErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_API_KEY"
  | "API_KEY_EXPIRED"
  | "API_KEY_REVOKED"
  | "API_KEY_REQUIRED"
  | "INVALID_SESSION_TOKEN"
  | "SESSION_TOKEN_EXPIRED"
  | "SESSION_TOKEN_REVOKED"
  | "USER_CREDENTIAL_REQUIRED"
  | "ORGANIZATION_REQUIRED"
  | "NO_ORGANIZATION"
  | "FORBIDDEN"
  | "INSUFFICIENT_ROLE"
  | "WORKSPACE_MISMATCH"
  | "WORKSPACE_SCOPED"
  | "WORKSPACE_NOT_IN_SCOPE"
  | "NO_WORKSPACE_IN_SCOPE"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "CONFIG_PUBLISH_FAILED"
  | "COMMAND_PUBLISH_FAILED"
  | "DIST_BUCKET_UNCONFIGURED"
  | "DIST_MANIFEST_UNAVAILABLE"
  | "DIST_MANIFEST_INVALID";

/** Codes the SDK raises itself. No HTTP request necessarily happened. */
export type XorgateClientErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "ABORTED"
  | "NETWORK"
  | "INVALID_RESPONSE";

export type XorgateErrorCode = XorgateApiErrorCode | XorgateClientErrorCode;

export interface XorgateErrorInit {
  code: XorgateErrorCode;
  message: string;
  status?: number;
  details?: Record<string, unknown>;
  method?: HttpMethod;
  url?: string;
  requestId?: string;
  /** The API's own request id, from `error.requestId` in the body. */
  serverRequestId?: string;
  hint?: string;
  retryable?: boolean;
  /** Seconds to wait, parsed from a `Retry-After` header. */
  retryAfterMs?: number;
  cause?: unknown;
}

/** True for timeouts, network failures, 429 and 5xx. False for every 4xx. */
function defaultRetryable(code: XorgateErrorCode, status?: number): boolean {
  if (code === "TIMEOUT" || code === "NETWORK" || code === "RATE_LIMITED") {
    return true;
  }
  if (status === undefined) return false;
  return status === 429 || status >= 500;
}

/**
 * The single error type. Everything the SDK throws is one of these, including
 * client-side validation failures, so `catch (e) { if (isXorgateError(e)) ... }`
 * is the whole error-handling contract.
 *
 * Safe to log whole: the credential never appears in `message`, `url` or
 * `details`.
 */
export class XorgateError extends Error {
  /** Never widened to `string`: match on this, never on `message`. */
  readonly code: XorgateErrorCode;
  /** Absent when the failure never reached (or never left) the network. */
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  readonly method?: HttpMethod;
  /** Request URL with the query string, never with credentials. */
  readonly url?: string;
  /**
   * The `X-Request-ID` the SDK generated and sent. The API does not echo it,
   * so this is the client's copy, useful for correlating your own logs.
   */
  readonly requestId?: string;
  /**
   * The API Gateway request id from the error body (`error.requestId`), the
   * id the platform's own access log records. QUOTE THIS ONE in a support
   * ticket. Absent when the response never reached the API (network failures,
   * gateway-generated 429s) or predates API productization.
   */
  readonly serverRequestId?: string;
  /** SDK-authored context the API cannot know. */
  readonly hint?: string;
  readonly retryable: boolean;
  /**
   * How long the server asked us to wait, from `Retry-After`, in milliseconds.
   * Only ever set on a 429.
   */
  readonly retryAfterMs?: number;

  constructor(init: XorgateErrorInit) {
    const prefix = init.method && init.url
      ? `${init.code} ${init.method} ${init.url}: `
      : `${init.code}: `;
    super(`${prefix}${init.message}`, init.cause ? { cause: init.cause } : undefined);
    this.name = "XorgateError";
    this.code = init.code;
    if (init.status !== undefined) this.status = init.status;
    if (init.details !== undefined) this.details = init.details;
    if (init.method !== undefined) this.method = init.method;
    if (init.url !== undefined) this.url = init.url;
    if (init.requestId !== undefined) this.requestId = init.requestId;
    if (init.serverRequestId !== undefined) this.serverRequestId = init.serverRequestId;
    if (init.hint !== undefined) this.hint = init.hint;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
    this.retryable = init.retryable ?? defaultRetryable(init.code, init.status);
  }
}

export function isXorgateError(e: unknown): e is XorgateError {
  return e instanceof XorgateError ||
    (typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "XorgateError" &&
      typeof (e as { code?: unknown }).code === "string");
}
