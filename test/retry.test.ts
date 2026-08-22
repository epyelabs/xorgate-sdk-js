import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, isXorgateError } from "../src/index.js";
import { stubFetch, type StubReply } from "./stub.js";

function client(replies: StubReply[], extra: Record<string, unknown> = {}) {
  const stub = stubFetch(...replies);
  return {
    stub,
    xg: createClient({
      auth: { apiKey: "xg_test" },
      organizationId: "org-1",
      fetch: stub.fetch,
      ...extra,
    }),
  };
}

test("retry is off by default: one attempt, even on a 503", async () => {
  const { xg, stub } = client([{ status: 503, body: {} }]);
  await assert.rejects(xg.workspaces.list());
  assert.equal(stub.calls.length, 1);
});

test("with retry on, a GET retries a 503 and then succeeds", async () => {
  const { xg, stub } = client(
    [{ status: 503, body: {} }, { body: { workspaces: [{ id: "ws-1" }] } }],
    { retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 2 } },
  );
  const workspaces = await xg.workspaces.list();
  assert.equal(stub.calls.length, 2);
  assert.equal(workspaces[0]!.id, "ws-1");
});

test("with retry on, a GET retries a 429", async () => {
  const { xg, stub } = client(
    [
      { status: 429, body: {}, headers: { "retry-after": "0" } },
      { body: { workspaces: [] } },
    ],
    { retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 2 } },
  );
  await xg.workspaces.list();
  assert.equal(stub.calls.length, 2);
});

test("a non-GET is NEVER retried, because the API has no idempotency keys", async () => {
  const { xg, stub } = client([{ status: 503, body: {} }], {
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  });
  await assert.rejects(
    xg.workspaces.create({ name: "North Yard", slug: "north-yard" }),
  );
  assert.equal(stub.calls.length, 1);
});

test("a 4xx fails immediately even with retry on", async () => {
  const { xg, stub } = client(
    [{ status: 404, body: { error: { code: "NOT_FOUND", message: "nope" } } }],
    { retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 } },
  );
  await assert.rejects(xg.workspaces.get("ws-1"), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "NOT_FOUND");
    return true;
  });
  assert.equal(stub.calls.length, 1);
});

test("attempts is a ceiling: it gives up and throws the last error", async () => {
  const { xg, stub } = client([{ status: 503, body: {} }], {
    retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
  });
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.status, 503);
    return true;
  });
  assert.equal(stub.calls.length, 3);
});

test("Retry-After raises the backoff floor without exceeding maxDelayMs", async () => {
  const started = Date.now();
  const { xg } = client(
    [
      { status: 429, body: {}, headers: { "retry-after": "60" } },
      { body: { workspaces: [] } },
    ],
    { retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 40 } },
  );
  await xg.workspaces.list();
  const elapsed = Date.now() - started;
  // Retry-After said 60 s; maxDelayMs caps it at 40 ms, so a minute-long stall
  // is not what a misconfigured gateway can inflict on a caller.
  assert.ok(elapsed < 1000, `waited ${elapsed}ms`);
});
