import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, isXorgateError } from "../src/index.js";
import { stubFetch, type StubReply } from "./stub.js";

/**
 * The 0.2.0 surface, mirroring the API's productization phase: the five
 * formerly-unpaginated collections now speak the list dialect and return a
 * `page` block, `memberships.updateRole()` exists, and error bodies carry the
 * server's `requestId`.
 */

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

function page(key: string, items: unknown[], meta: Record<string, unknown>) {
  return { body: { [key]: items, page: { order: "desc", ...meta } } };
}

test("updateRole PATCHes /memberships/{id} and unwraps the membership", async () => {
  const { xg, stub } = client([
    { body: { membership: { id: "m-1", userId: "u-1", organizationId: "org-1", role: "admin" } } },
  ]);
  const updated = await xg.memberships.updateRole("m-1", "admin");
  assert.equal(updated.role, "admin");
  assert.equal(stub.calls[0]!.method, "PATCH");
  assert.ok(stub.calls[0]!.url.endsWith("/v1/memberships/m-1"));
  assert.deepEqual(stub.calls[0]!.body, { role: "admin" });
});

test("the five collections pass the list dialect through as query params", async () => {
  const { xg, stub } = client([
    page("workspaces", [{ id: "ws-1" }], { limit: 5, offset: 10, total: 11 }),
  ]);
  const rows = await xg.workspaces.list({ limit: 5, offset: 10, order: "asc", sort: "name" });
  assert.equal(rows[0]!.id, "ws-1");
  const url = new URL(stub.calls[0]!.url);
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("offset"), "10");
  assert.equal(url.searchParams.get("order"), "asc");
  assert.equal(url.searchParams.get("sort"), "name");
});

test("iterate() walks the new page blocks across requests", async () => {
  const { xg, stub } = client([
    page("memberships", [{ id: "m-1", role: "owner" }, { id: "m-2", role: "member" }], {
      limit: 2,
      offset: 0,
      total: 3,
    }),
    page("memberships", [{ id: "m-3", role: "viewer" }], { limit: 2, offset: 2, total: 3 }),
  ]);
  const all = await xg.memberships.listAll({ pageSize: 2 });
  assert.deepEqual(all.map((m) => m.id), ["m-1", "m-2", "m-3"]);
  assert.equal(stub.calls.length, 2);
});

test("a pre-productization response without a page block still lists fine", async () => {
  // The synthesized page says "this was everything", so iteration stops.
  const { xg, stub } = client([{ body: { organizations: [{ id: "org-1", name: "A", slug: "a", created_at: "2026-01-01" }] } }]);
  const all = await xg.organizations.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.createdAt, "2026-01-01");
  assert.equal(stub.calls.length, 1);
});

test("an error body's requestId lands on serverRequestId", async () => {
  const { xg } = client([
    {
      status: 404,
      body: {
        error: { code: "NOT_FOUND", message: "Device not found", requestId: "CiFDth1soAMEPVw=" },
      },
    },
  ]);
  await assert.rejects(xg.devices.get("nope"), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "NOT_FOUND");
    assert.equal(e.serverRequestId, "CiFDth1soAMEPVw=");
    // The client-generated correlation id is a different thing and still set.
    assert.ok(e.requestId);
    assert.notEqual(e.requestId, e.serverRequestId);
    return true;
  });
});

test("a body without requestId leaves serverRequestId undefined", async () => {
  const { xg } = client([
    { status: 404, body: { error: { code: "NOT_FOUND", message: "nope" } } },
  ]);
  await assert.rejects(xg.devices.get("nope"), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.serverRequestId, undefined);
    return true;
  });
});

test("SERVER_ERROR arrives as itself when the API emits the envelope", async () => {
  const { xg } = client([
    {
      status: 500,
      body: {
        error: { code: "SERVER_ERROR", message: "Internal server error.", requestId: "req-1" },
      },
    },
  ]);
  await assert.rejects(xg.devices.get("dev-1"), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "SERVER_ERROR");
    assert.equal(e.serverRequestId, "req-1");
    assert.equal(e.retryable, true);
    return true;
  });
});
