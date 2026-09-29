import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "standardwebhooks";
import {
  isXorgateError,
  verifyWebhookSignature,
  WebhookVerificationError,
  type WebhookEvent,
  type WebhookVerificationFailure,
} from "../src/index.js";

/**
 * `verifyWebhookSignature()` against the Standard Webhooks reference library
 * (`standardwebhooks`, devDependency only) and the vector pinned in the
 * engine (scripts/smoke.mjs §2c) and core (test/webhooks.test.ts).
 */

const SHARED = {
  secret: "whsec_eG9yZ2F0ZS13ZWJob29rcy1zaGFyZWQtdmVjdG9yLTMyYg==",
  id: "01928f3e-5c2a-7b4d-8e9f-0a1b2c3d4e5f",
  ts: 1790000000,
  body: '{"id":"01928f3e-5c2a-7b4d-8e9f-0a1b2c3d4e5f","type":"ping","apiVersion":"2026-09-27","data":{"message":"hello"}}',
  signature: "v1,eunRXoEGTAdBvdruPkA9OUvMYGdgpA+cG8cpxQnFfVM=",
};
const AT_SHARED = new Date(SHARED.ts * 1000);

const SECRET_A = "whsec_" + Buffer.from("a".repeat(32)).toString("base64");
const SECRET_B = "whsec_" + Buffer.from("b".repeat(32)).toString("base64");

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "01a0e9a0-f2ad-7000-8000-000000000001",
    type: "device.offline",
    apiVersion: "2026-09-27",
    createdAt: "2026-09-28T19:00:00.000Z",
    organizationId: "org-1",
    workspaceId: "ws-1",
    data: {
      deviceId: "dev-1",
      serial: "XG-1",
      name: "Truck 01",
      status: "offline",
      previousStatus: "online",
      lastSeenAt: "2026-09-28T18:59:00.000Z",
      source: "lwt",
    },
    ...overrides,
  });
}

/** Headers signed by the reference library. */
function signed(secret: string, body: string, at = new Date(), id = "msg-1") {
  const signature = new Webhook(secret).sign(id, at, body);
  return {
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
    "webhook-signature": signature,
  };
}

async function rejects(
  promise: Promise<unknown>,
  reason: WebhookVerificationFailure,
): Promise<WebhookVerificationError> {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof WebhookVerificationError, `expected WebhookVerificationError, got ${String(e)}`);
    assert.equal(e.reason, reason);
    assert.equal(e.code, "WEBHOOK_VERIFICATION_FAILED");
    assert.ok(isXorgateError(e));
    return e;
  }
  assert.fail(`expected a rejection with reason ${reason}`);
}

test("the shared vector: the reference library and this verifier agree byte for byte", async () => {
  const ref = new Webhook(SHARED.secret).sign(SHARED.id, AT_SHARED, SHARED.body);
  assert.equal(ref, SHARED.signature);

  const event = await verifyWebhookSignature({
    headers: {
      "webhook-id": SHARED.id,
      "webhook-timestamp": String(SHARED.ts),
      "webhook-signature": SHARED.signature,
    },
    rawBody: SHARED.body,
    secret: SHARED.secret,
    now: AT_SHARED,
  });
  assert.equal(event.type, "ping");
  assert.equal(event.id, SHARED.id);
  if (event.type === "ping") assert.equal(event.data.message, "hello");
});

test("the shared vector also verifies within tolerance via toleranceSeconds, and fails outside it", async () => {
  const headers = {
    "webhook-id": SHARED.id,
    "webhook-timestamp": String(SHARED.ts),
    "webhook-signature": SHARED.signature,
  };
  const later = new Date((SHARED.ts + 3600) * 1000);
  await verifyWebhookSignature({ headers, rawBody: SHARED.body, secret: SHARED.secret, now: later, toleranceSeconds: 3600 });
  await rejects(
    verifyWebhookSignature({ headers, rawBody: SHARED.body, secret: SHARED.secret, now: later, toleranceSeconds: 3599 }),
    "timestamp_too_old",
  );
});

test("a reference-signed delivery verifies and comes back typed", async () => {
  const body = envelope();
  const event: WebhookEvent = await verifyWebhookSignature({
    headers: signed(SECRET_A, body),
    rawBody: body,
    secret: SECRET_A,
  });
  assert.equal(event.type, "device.offline");
  if (event.type === "device.offline") {
    const source: "graceful" | "lwt" | "sweeper" = event.data.source;
    assert.equal(source, "lwt");
  }
});

test("bytes work as well as strings (Buffer, Uint8Array, ArrayBuffer)", async () => {
  const body = envelope();
  const headers = signed(SECRET_A, body);
  const buf = Buffer.from(body);
  for (const rawBody of [buf, new Uint8Array(buf), new TextEncoder().encode(body).buffer]) {
    const event = await verifyWebhookSignature({ headers, rawBody, secret: SECRET_A });
    assert.equal(event.type, "device.offline");
  }
});

test("a pooled Buffer slice verifies over its own bytes only", async () => {
  const body = envelope();
  const headers = signed(SECRET_A, body);
  const pool = Buffer.from("XXXX" + body + "YYYY");
  const slice = pool.subarray(4, 4 + Buffer.byteLength(body));
  const event = await verifyWebhookSignature({ headers, rawBody: slice, secret: SECRET_A });
  assert.equal(event.type, "device.offline");
});

test("a Headers instance and mixed-case object keys are both read case-insensitively", async () => {
  const body = envelope();
  const h = signed(SECRET_A, body);
  await verifyWebhookSignature({ headers: new Headers(h), rawBody: body, secret: SECRET_A });
  await verifyWebhookSignature({
    headers: {
      "Webhook-Id": h["webhook-id"],
      "WEBHOOK-TIMESTAMP": h["webhook-timestamp"],
      "Webhook-Signature": h["webhook-signature"],
    },
    rawBody: body,
    secret: SECRET_A,
  });
});

test("rotation: two signatures, either secret verifies; a third secret does not", async () => {
  const body = envelope();
  const at = new Date();
  const a = signed(SECRET_A, body, at);
  const b = signed(SECRET_B, body, at);
  const headers = { ...a, "webhook-signature": `${b["webhook-signature"]} ${a["webhook-signature"]}` };
  await verifyWebhookSignature({ headers, rawBody: body, secret: SECRET_A });
  await verifyWebhookSignature({ headers, rawBody: body, secret: SECRET_B });
  // And the reference library agrees with the two-signature header.
  new Webhook(SECRET_A).verify(body, headers);
  const other = "whsec_" + Buffer.from("c".repeat(32)).toString("base64");
  await rejects(verifyWebhookSignature({ headers, rawBody: body, secret: other }), "no_matching_signature");
});

test("unknown versions and malformed entries in the list are skipped, not fatal", async () => {
  const body = envelope();
  const h = signed(SECRET_A, body);
  const headers = { ...h, "webhook-signature": `v2,abc v1,!!notbase64 junk ${h["webhook-signature"]}` };
  await verifyWebhookSignature({ headers, rawBody: body, secret: SECRET_A });
});

test("a secret without the whsec_ prefix works, like the reference library", async () => {
  const body = envelope();
  await verifyWebhookSignature({
    headers: signed(SECRET_A, body),
    rawBody: body,
    secret: SECRET_A.slice("whsec_".length),
  });
});

test("a tampered body is rejected", async () => {
  const body = envelope();
  const headers = signed(SECRET_A, body);
  const tampered = body.replace('"lwt"', '"graceful"');
  await rejects(verifyWebhookSignature({ headers, rawBody: tampered, secret: SECRET_A }), "no_matching_signature");
  // Re-serialized JSON (whitespace) is also a different body.
  const reserialized = JSON.stringify(JSON.parse(body), null, 1);
  await rejects(verifyWebhookSignature({ headers, rawBody: reserialized, secret: SECRET_A }), "no_matching_signature");
});

test("a tampered id or timestamp is rejected", async () => {
  const body = envelope();
  const headers = signed(SECRET_A, body);
  await rejects(
    verifyWebhookSignature({ headers: { ...headers, "webhook-id": "msg-2" }, rawBody: body, secret: SECRET_A }),
    "no_matching_signature",
  );
  await rejects(
    verifyWebhookSignature({
      headers: { ...headers, "webhook-timestamp": String(Number(headers["webhook-timestamp"]) - 1) },
      rawBody: body,
      secret: SECRET_A,
    }),
    "no_matching_signature",
  );
});

test("a wrong secret is rejected", async () => {
  const body = envelope();
  await rejects(
    verifyWebhookSignature({ headers: signed(SECRET_A, body), rawBody: body, secret: SECRET_B }),
    "no_matching_signature",
  );
});

test("timestamp tolerance: too old and too new, default 300 s", async () => {
  const body = envelope();
  const now = new Date("2026-09-28T12:00:00.000Z");
  const old = signed(SECRET_A, body, new Date(now.getTime() - 301_000));
  const future = signed(SECRET_A, body, new Date(now.getTime() + 301_000));
  const edge = signed(SECRET_A, body, new Date(now.getTime() - 300_000));
  await rejects(verifyWebhookSignature({ headers: old, rawBody: body, secret: SECRET_A, now }), "timestamp_too_old");
  await rejects(verifyWebhookSignature({ headers: future, rawBody: body, secret: SECRET_A, now }), "timestamp_too_new");
  await verifyWebhookSignature({ headers: edge, rawBody: body, secret: SECRET_A, now });
  // The reference library rejects the same two.
  assert.throws(() => new Webhook(SECRET_A).verify(body, old));
  assert.throws(() => new Webhook(SECRET_A).verify(body, future));
});

test("missing headers are named, in the message and the reason", async () => {
  const body = envelope();
  const h = signed(SECRET_A, body);
  for (const name of ["webhook-id", "webhook-timestamp", "webhook-signature"] as const) {
    const headers: Record<string, string> = { ...h };
    delete headers[name];
    const e = await rejects(verifyWebhookSignature({ headers, rawBody: body, secret: SECRET_A }), "missing_headers");
    assert.match(e.message, new RegExp(name));
  }
  await rejects(verifyWebhookSignature({ headers: {}, rawBody: body, secret: SECRET_A }), "missing_headers");
});

test("a non-numeric timestamp, a bad secret and a parsed body are rejected with their own reasons", async () => {
  const body = envelope();
  const h = signed(SECRET_A, body);
  await rejects(
    verifyWebhookSignature({ headers: { ...h, "webhook-timestamp": "12e9" }, rawBody: body, secret: SECRET_A }),
    "invalid_timestamp",
  );
  await rejects(verifyWebhookSignature({ headers: h, rawBody: body, secret: "whsec_" }), "invalid_secret");
  await rejects(verifyWebhookSignature({ headers: h, rawBody: body, secret: "whsec_not base64!" }), "invalid_secret");
  await rejects(
    verifyWebhookSignature({ headers: h, rawBody: JSON.parse(body) as never, secret: SECRET_A }),
    "invalid_body",
  );
});

test("a validly signed body that is not an envelope is invalid_payload", async () => {
  for (const body of ["not json", "[1,2]", '{"id":"x"}']) {
    await rejects(
      verifyWebhookSignature({ headers: signed(SECRET_A, body), rawBody: body, secret: SECRET_A }),
      "invalid_payload",
    );
  }
});

test("no error message or serialization ever carries the secret, the key or the body", async () => {
  const body = envelope({ data: { message: "SENSITIVE-BODY-MARKER" } });
  const key = SECRET_B.slice("whsec_".length);
  const cases: Array<() => Promise<unknown>> = [
    () => verifyWebhookSignature({ headers: signed(SECRET_A, body), rawBody: body, secret: SECRET_B }),
    () => verifyWebhookSignature({ headers: signed(SECRET_A, "not json SENSITIVE-BODY-MARKER"), rawBody: "not json SENSITIVE-BODY-MARKER", secret: SECRET_A }),
    () => verifyWebhookSignature({ headers: {}, rawBody: body, secret: SECRET_B }),
  ];
  for (const c of cases) {
    try {
      await c();
      assert.fail("expected rejection");
    } catch (e) {
      const text = `${String(e)} ${JSON.stringify(e)} ${(e as Error).stack ?? ""} ${String((e as Error).cause ?? "")}`;
      assert.ok(!text.includes(key), "key leaked");
      assert.ok(!text.includes("SENSITIVE-BODY-MARKER"), "body leaked");
    }
  }
});
