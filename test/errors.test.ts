import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, isXorgateError, XorgateError } from "../src/index.js";
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

test("the API's error envelope becomes the code, status and details", async () => {
  const { xg } = client([
    {
      status: 403,
      body: {
        error: {
          code: "INSUFFICIENT_ROLE",
          message: "Requires one of: owner, admin. This API key has: member.",
          details: { required: ["owner", "admin"] },
        },
      },
    },
  ]);
  await assert.rejects(xg.devices.reboot("dev-1"), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "INSUFFICIENT_ROLE");
    assert.equal(e.status, 403);
    assert.deepEqual(e.details, { required: ["owner", "admin"] });
    assert.equal(e.method, "POST");
    assert.equal(e.retryable, false);
    return true;
  });
});

test("every 4xx is retryable:false and 5xx is retryable:true", async () => {
  const cases: Array<[number, string, boolean]> = [
    [400, "BAD_REQUEST", false],
    [401, "INVALID_API_KEY", false],
    [404, "NOT_FOUND", false],
    [409, "CONFLICT", false],
    [502, "CONFIG_PUBLISH_FAILED", true],
  ];
  for (const [status, code, retryable] of cases) {
    const { xg } = client([{ status, body: { error: { code, message: code } } }]);
    await assert.rejects(xg.workspaces.get("ws-1"), (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.code, code);
      assert.equal(e.retryable, retryable, `${code} retryable`);
      return true;
    });
  }
});

test("a 5xx with no envelope is SERVER_ERROR rather than a guessed API code", async () => {
  const { xg } = client([{ status: 503, text: "<html>Service Unavailable</html>" }]);
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "SERVER_ERROR");
    assert.equal(e.retryable, true);
    return true;
  });
});

test("a bare gateway 429 becomes RATE_LIMITED and carries Retry-After", async () => {
  const { xg } = client([
    { status: 429, body: { message: "Too Many Requests" }, headers: { "retry-after": "2" } },
  ]);
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "RATE_LIMITED");
    assert.equal(e.status, 429);
    assert.equal(e.retryable, true);
    assert.equal(e.retryAfterMs, 2000);
    return true;
  });
});

test("Retry-After as an HTTP date is understood too", async () => {
  const when = new Date(Date.now() + 5000).toUTCString();
  const { xg } = client([{ status: 429, body: {}, headers: { "retry-after": when } }]);
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.ok(e.retryAfterMs! > 3000 && e.retryAfterMs! <= 5000);
    return true;
  });
});

test("a network failure is NETWORK, with the cause attached", async () => {
  const boom = new TypeError("fetch failed");
  const { xg } = client([{ throws: boom }]);
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "NETWORK");
    assert.equal(e.status, undefined);
    assert.equal((e as { cause?: unknown }).cause, boom);
    return true;
  });
});

test("timeoutMs produces TIMEOUT, and a caller's signal produces ABORTED", async () => {
  const slow = createClient({
    auth: { apiKey: "xg_test" },
    organizationId: "org-1",
    timeoutMs: 20,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  });
  await assert.rejects(slow.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "TIMEOUT");
    return true;
  });

  const ac = new AbortController();
  const hung = createClient({
    auth: { apiKey: "xg_test" },
    organizationId: "org-1",
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  });
  const pending = hung.telemetry.history("dev-1", {
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
    signal: ac.signal,
  });
  ac.abort();
  await assert.rejects(pending, (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "ABORTED");
    return true;
  });
});

test("a signal that fires mid-flight aborts a request already on the wire", async () => {
  const ac = new AbortController();
  const inflight = createClient({
    auth: { apiKey: "xg_test" },
    organizationId: "org-1",
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  });
  const pending = inflight.telemetry.history("dev-1", {
    from: "2026-08-01T00:00:00Z",
    to: "2026-08-02T00:00:00Z",
    signal: ac.signal,
  });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(pending, (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "ABORTED");
    return true;
  });
});

test("a 2xx whose body is not JSON is INVALID_RESPONSE, not a parse crash", async () => {
  const { xg } = client([{ text: "<html>captive portal</html>" }]);
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "INVALID_RESPONSE");
    return true;
  });
});

test("a 2xx missing its envelope is INVALID_RESPONSE and names what it got", async () => {
  const { xg } = client([{ body: { unexpected: true } }]);
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "INVALID_RESPONSE");
    assert.match(e.message, /workspaces/);
    return true;
  });
});

test("the message is prefixed with code, method and path, and holds no credential", async () => {
  const { xg } = client([{ status: 404, body: { error: { code: "NOT_FOUND", message: "Device \"dev-1\" not found" } } }]);
  await assert.rejects(xg.devices.get("dev-1"), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.match(e.message, /^NOT_FOUND GET https:\/\/api\.xorgate\.io\/v1\/devices\/dev-1: /);
    assert.ok(!e.message.includes("xg_test"));
    assert.ok(!(e.url ?? "").includes("xg_test"));
    return true;
  });
});

test("CONFIG_PUBLISH_FAILED carries the do-not-retry hint", async () => {
  const { xg } = client([
    { status: 502, body: { error: { code: "CONFIG_PUBLISH_FAILED", message: "saved, not delivered" } } },
  ]);
  await assert.rejects(xg.devices.patchConfig("dev-1", { gnssAntBias: true }), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.match(e.hint!, /self-heals/);
    return true;
  });
});

test("isXorgateError recognizes a structurally identical error from another copy", () => {
  const real = new XorgateError({ code: "TIMEOUT", message: "x" });
  assert.ok(isXorgateError(real));
  assert.ok(isXorgateError({ name: "XorgateError", code: "TIMEOUT", message: "x" }));
  assert.ok(!isXorgateError(new Error("plain")));
  assert.ok(!isXorgateError(null));
});
