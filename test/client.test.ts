import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, createBootstrapClient, isXorgateError, DEFAULT_BASE_URL } from "../src/index.js";
import { stubFetch } from "./stub.js";

function client(stub: ReturnType<typeof stubFetch>, extra: Record<string, unknown> = {}) {
  return createClient({
    auth: { apiKey: "xg_test" },
    organizationId: "org-1",
    fetch: stub.fetch,
    ...extra,
  });
}

test("baseUrl defaults to production and the SDK owns the /v1 segment", async () => {
  const stub = stubFetch({ body: { workspaces: [] } });
  const xg = client(stub);
  assert.equal(xg.baseUrl, DEFAULT_BASE_URL);
  await xg.workspaces.list();
  assert.equal(stub.calls[0]!.url, "https://api.xorgate.io/v1/workspaces");
});

test("a custom baseUrl still gets /v1 appended, and a trailing slash is trimmed", async () => {
  const stub = stubFetch({ body: { workspaces: [] } });
  await client(stub, { baseUrl: "https://api.example.test/" }).workspaces.list();
  assert.equal(stub.calls[0]!.url, "https://api.example.test/v1/workspaces");
});

test("a baseUrl that already ends in /v1 is refused, not silently doubled", () => {
  assert.throws(
    () => client(stubFetch(), { baseUrl: "https://api.xorgate.io/v1" }),
    (e: unknown) => isXorgateError(e) && e.code === "INVALID_CONFIG",
  );
});

test("the credential goes on Authorization as a Bearer token, never X-Api-Key", async () => {
  const stub = stubFetch({ body: { workspaces: [] } });
  await client(stub).workspaces.list();
  const headers = stub.calls[0]!.headers;
  assert.equal(headers["authorization"], "Bearer xg_test");
  assert.equal(headers["x-api-key"], undefined);
});

test("getToken is called once per request and is never cached", async () => {
  let calls = 0;
  const stub = stubFetch({ body: { workspaces: [] } });
  const xg = createClient({
    auth: { getToken: () => `jwt-${++calls}` },
    organizationId: "org-1",
    fetch: stub.fetch,
  });
  await xg.workspaces.list();
  await xg.workspaces.list();
  assert.equal(stub.calls[0]!.headers["authorization"], "Bearer jwt-1");
  assert.equal(stub.calls[1]!.headers["authorization"], "Bearer jwt-2");
});

test("a getToken that throws surfaces as UNAUTHORIZED with the original cause", async () => {
  const boom = new Error("refresh failed");
  const xg = createClient({
    auth: {
      getToken: () => {
        throw boom;
      },
    },
    organizationId: "org-1",
    fetch: stubFetch().fetch,
  });
  await assert.rejects(xg.workspaces.list(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "UNAUTHORIZED");
    assert.equal((e as { cause?: unknown }).cause, boom);
    return true;
  });
});

test("both auth modes at once, and neither, are INVALID_CONFIG", () => {
  const bad = [
    { apiKey: "xg_a", getToken: () => "jwt" },
    {},
  ];
  for (const auth of bad) {
    assert.throws(
      () =>
        createClient({
          auth: auth as never,
          organizationId: "org-1",
          fetch: stubFetch().fetch,
        }),
      (e: unknown) => isXorgateError(e) && e.code === "INVALID_CONFIG",
    );
  }
});

test("organizationId is required and travels as X-Organization-Id", async () => {
  assert.throws(
    () =>
      createClient({
        auth: { apiKey: "xg_test" },
        organizationId: "",
        fetch: stubFetch().fetch,
      }),
    (e: unknown) => isXorgateError(e) && e.code === "INVALID_CONFIG",
  );
  const stub = stubFetch({ body: { workspaces: [] } });
  await client(stub).workspaces.list();
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");
});

test("X-Workspace-Id comes from the client default, and a per-call value beats it", async () => {
  const stub = stubFetch({ body: { devices: [], page: { limit: 100, offset: 0, order: "desc", total: 0 } } });
  const xg = client(stub, { workspaceId: "ws-default" });
  await xg.devices.list();
  assert.equal(stub.calls[0]!.headers["x-workspace-id"], "ws-default");
  await xg.devices.list({ workspaceId: "ws-other" });
  assert.equal(stub.calls[1]!.headers["x-workspace-id"], "ws-other");
});

test("forWorkspace(undefined) widens a scoped client back to the organization", async () => {
  const stub = stubFetch({ body: { devices: [], page: { limit: 100, offset: 0, order: "desc", total: 0 } } });
  const xg = client(stub, { workspaceId: "ws-default" });
  await xg.forWorkspace(undefined).devices.list();
  assert.equal(stub.calls[0]!.headers["x-workspace-id"], undefined);
});

test("forOrganization keeps the workspace default and swaps only the org", () => {
  const xg = client(stubFetch(), { workspaceId: "ws-1" });
  const other = xg.forOrganization("org-2");
  assert.equal(other.organizationId, "org-2");
  assert.equal(other.workspaceId, "ws-1");
  assert.equal(xg.organizationId, "org-1");
});

test("caller headers merge in, but cannot overwrite auth or tenancy", async () => {
  const stub = stubFetch({ body: { workspaces: [] } });
  const xg = client(stub, {
    headers: { "X-Trace": "abc", Authorization: "Bearer hijack", "X-Organization-Id": "org-hijack" },
  });
  await xg.workspaces.list();
  const headers = stub.calls[0]!.headers;
  assert.equal(headers["x-trace"], "abc");
  assert.equal(headers["authorization"], "Bearer xg_test");
  assert.equal(headers["x-organization-id"], "org-1");
});

test("every request carries a fresh X-Request-ID, echoed onto the error", async () => {
  const stub = stubFetch(
    { body: { workspaces: [] } },
    { status: 404, body: { error: { code: "NOT_FOUND", message: "nope" } } },
  );
  const xg = client(stub);
  await xg.workspaces.list();
  const first = stub.calls[0]!.headers["x-request-id"];
  assert.ok(first);
  await assert.rejects(xg.workspaces.get("ws-1"), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.requestId, stub.calls[1]!.headers["x-request-id"]);
    assert.notEqual(e.requestId, first);
    return true;
  });
});

test("me() normalizes both casing outliers and tolerates the camelCase future", async () => {
  const stub = stubFetch({
    body: {
      user: { id: "u1", email: "ops@acme.co", name: null, tier: "free", role: "user" },
      memberships: [{ id: "m1", userId: "u1", organizationId: "org-1", role: "owner", createdAt: "2026-01-01T00:00:00Z" }],
      organizations: [
        { id: "org-1", name: "Alocate", slug: "alocate", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
        { id: "org-2", name: "Future", slug: "future", createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" },
      ],
    },
  });
  const me = await client(stub).me();
  assert.equal(me.organizations[0]!.createdAt, "2026-01-01T00:00:00Z");
  assert.equal(me.organizations[0]!.updatedAt, "2026-02-01T00:00:00Z");
  assert.equal(me.organizations[1]!.createdAt, "2026-03-01T00:00:00Z");
  // GET /me builds `user` from the auth context and carries no timestamp.
  assert.equal(me.user.createdAt, null);
});

test("the bootstrap client sends no tenancy header and can upgrade", async () => {
  const stub = stubFetch({ body: { organizations: [{ id: "org-9", name: "New", slug: "new", created_at: "x", updated_at: "y" }] } });
  const boot = createBootstrapClient({ auth: { getToken: () => "jwt" }, fetch: stub.fetch });
  const orgs = await boot.listOrganizations();
  assert.equal(stub.calls[0]!.headers["x-organization-id"], undefined);
  assert.equal(orgs[0]!.id, "org-9");
  assert.equal(boot.forOrganization("org-9").organizationId, "org-9");
});

test("search passes q through and unwraps results", async () => {
  const stub = stubFetch({ body: { results: [{ type: "device", id: "dev-1", title: "XG-0042", subtitle: null }] } });
  const hits = await client(stub).search("XG-0042");
  assert.equal(stub.calls[0]!.url, "https://api.xorgate.io/v1/search?q=XG-0042");
  assert.equal(hits[0]!.type, "device");
});

test("request() is a raw escape hatch: no unwrapping, no normalization", async () => {
  const stub = stubFetch({ body: { device_models: [{ id: "dm-1" }] } });
  const raw = await client(stub).request<{ device_models: unknown[] }>("GET", "/device-models");
  assert.equal(raw.device_models.length, 1);
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");
});
