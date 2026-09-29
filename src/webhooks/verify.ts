import { XorgateError } from "../errors.js";
import type {
  DeviceWebhookEventType,
  VerifyWebhookSignatureInput,
  WebhookEvent,
  WebhookEventType,
  WebhookHeadersLike,
} from "../types.js";

/**
 * Standard Webhooks (https://www.standardwebhooks.com) verification for
 * xorgate deliveries, with no dependency: WebCrypto (`globalThis.crypto.subtle`)
 * does the HMAC, so the same code runs on Node 20+, Deno, Bun, Cloudflare
 * Workers, Vercel Edge and browsers. WebCrypto is promise-based, which is why
 * `verifyWebhookSignature` is async.
 */

/** Why a delivery was rejected. Match on this, never on `message`. */
export type WebhookVerificationFailure =
  /** `webhook-id`, `webhook-timestamp` or `webhook-signature` is absent. */
  | "missing_headers"
  /** `webhook-timestamp` is not an integer number of seconds. */
  | "invalid_timestamp"
  /** Older than the tolerance: a replay, or a clock far behind. */
  | "timestamp_too_old"
  /** Newer than the tolerance: a clock far ahead. */
  | "timestamp_too_new"
  /** The secret is empty or not base64 after the `whsec_` prefix. */
  | "invalid_secret"
  /** `rawBody` is not a string or bytes (for example an already-parsed object). */
  | "invalid_body"
  /** No `v1,` signature in the header matches. Wrong secret or a tampered body. */
  | "no_matching_signature"
  /** The signature matched but the body is not a JSON event envelope. */
  | "invalid_payload"
  /** This runtime has no WebCrypto (`globalThis.crypto.subtle`). */
  | "crypto_unavailable";

/**
 * Thrown by `verifyWebhookSignature()`. A `XorgateError` with code
 * `WEBHOOK_VERIFICATION_FAILED`, so the SDK's one-error-type contract holds.
 * Its message never contains the secret, the body or a signature.
 */
export class WebhookVerificationError extends XorgateError {
  readonly reason: WebhookVerificationFailure;

  constructor(reason: WebhookVerificationFailure, message: string, cause?: unknown) {
    super({
      code: "WEBHOOK_VERIFICATION_FAILED",
      message,
      retryable: false,
      ...(cause !== undefined ? { cause } : {}),
    });
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

/** Every event type of the v1 catalog, in catalog order. */
export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  "device.online",
  "device.offline",
  "media_session.started",
  "media_session.ended",
  "telemetry_session.started",
  "telemetry_session.ended",
  "telemetry_session.completed",
  "workflow.event",
  "ping",
];

/** The seven types a device route may carry (`devices.webhooks.set()`). */
export const DEVICE_WEBHOOK_EVENT_TYPES: readonly DeviceWebhookEventType[] = [
  "device.online",
  "device.offline",
  "media_session.started",
  "media_session.ended",
  "telemetry_session.started",
  "telemetry_session.ended",
  "telemetry_session.completed",
];

const DEFAULT_TOLERANCE_SECONDS = 300;
const SECRET_PREFIX = "whsec_";

/**
 * Verify a delivery's Standard Webhooks signature and return its parsed,
 * typed envelope. ASYNC: `await` it.
 *
 * - Reads `webhook-id`, `webhook-timestamp` and `webhook-signature`
 *   (case-insensitive; a `Headers` instance or Node's `req.headers`).
 * - Signed content is `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the
 *   base64-decoded bytes after `whsec_`.
 * - `webhook-signature` is a space-separated list of `v1,<base64>`; any match
 *   passes, which is how a rotation's 24 h overlap (two signatures) works.
 *   Comparison is constant-time.
 * - The timestamp must be within `toleranceSeconds` (default 300) of now, in
 *   either direction.
 *
 * Pass the body EXACTLY as received. Parsing and re-serializing it changes
 * the bytes and fails verification. Throws `WebhookVerificationError`.
 *
 * ```ts
 * const event = await verifyWebhookSignature({
 *   headers: req.headers,
 *   rawBody: req.body, // a Buffer from express.raw({ type: "application/json" })
 *   secret: process.env.XORGATE_WEBHOOK_SECRET!,
 * })
 * if (event.type === "device.offline") console.log(event.data.deviceId, event.data.source)
 * ```
 */
export async function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): Promise<WebhookEvent> {
  const { headers, rawBody, secret } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");
  if (!id || !timestamp || !signatureHeader) {
    const missing = [
      !id && "webhook-id",
      !timestamp && "webhook-timestamp",
      !signatureHeader && "webhook-signature",
    ].filter(Boolean);
    throw new WebhookVerificationError(
      "missing_headers",
      `Missing required header(s): ${missing.join(", ")}.`,
    );
  }

  if (!/^\d+$/.test(timestamp)) {
    throw new WebhookVerificationError(
      "invalid_timestamp",
      "webhook-timestamp is not an integer number of seconds.",
    );
  }
  const ts = Number(timestamp);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (nowSeconds - ts > tolerance) {
    throw new WebhookVerificationError(
      "timestamp_too_old",
      `webhook-timestamp is more than ${tolerance} s in the past.`,
    );
  }
  if (ts - nowSeconds > tolerance) {
    throw new WebhookVerificationError(
      "timestamp_too_new",
      `webhook-timestamp is more than ${tolerance} s in the future.`,
    );
  }

  const key = decodeSecret(secret);
  const body = bodyBytes(rawBody);

  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) {
    throw new WebhookVerificationError(
      "crypto_unavailable",
      "This runtime has no WebCrypto (globalThis.crypto.subtle); Node 20+ and every edge runtime do.",
    );
  }

  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix, 0);
  signed.set(body, prefix.length);

  const cryptoKey = await subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await subtle.sign("HMAC", cryptoKey, signed));

  let matched = false;
  for (const part of signatureHeader.split(" ")) {
    const comma = part.indexOf(",");
    if (comma === -1) continue;
    if (part.slice(0, comma) !== "v1") continue;
    const candidate = tryBase64(part.slice(comma + 1));
    // Evaluate every candidate, so timing does not reveal which one matched.
    if (candidate && constantTimeEqual(candidate, expected)) matched = true;
  }
  if (!matched) {
    throw new WebhookVerificationError(
      "no_matching_signature",
      "No v1 signature matches: wrong secret, or the body was changed (pass it exactly as received).",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    // No `cause`: V8's SyntaxError quotes a slice of the body.
    throw new WebhookVerificationError("invalid_payload", "The body is not JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { type?: unknown }).type !== "string"
  ) {
    throw new WebhookVerificationError(
      "invalid_payload",
      "The body is not a webhook event envelope (no string `type`).",
    );
  }
  return parsed as WebhookEvent;
}

function header(headers: WebhookHeadersLike, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get(name: string): string | null }).get(name);
    return value ?? undefined;
  }
  const record = headers as Record<string, string | readonly string[] | undefined>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== name) continue;
    if (value === undefined) return undefined;
    return typeof value === "string" ? value : value.join(" ");
  }
  return undefined;
}

function decodeSecret(secret: string): Uint8Array<ArrayBuffer> {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new WebhookVerificationError("invalid_secret", "The secret is empty.");
  }
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const bytes = tryBase64(raw);
  if (!bytes || bytes.length === 0) {
    throw new WebhookVerificationError(
      "invalid_secret",
      "The secret is not `whsec_` followed by standard base64.",
    );
  }
  return bytes;
}

function bodyBytes(rawBody: unknown): Uint8Array {
  if (typeof rawBody === "string") return new TextEncoder().encode(rawBody);
  // `ArrayBuffer.isView` rather than `instanceof`, so a Buffer or view from
  // another realm (a test VM, a worker) is still recognized.
  if (ArrayBuffer.isView(rawBody)) {
    return new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  if (rawBody instanceof ArrayBuffer) return new Uint8Array(rawBody);
  throw new WebhookVerificationError(
    "invalid_body",
    "rawBody must be the unparsed body as a string or bytes. Got " +
      (rawBody === null ? "null" : typeof rawBody) +
      "; with Express use express.raw({ type: \"application/json\" }) on the webhook route.",
  );
}

/** Standard base64 (RFC 4648 §4, padding optional) to bytes; undefined if invalid. */
function tryBase64(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) return undefined;
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
