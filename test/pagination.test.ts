import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/index.js";
import { deviceRow, stubFetch, type StubReply } from "./stub.js";

function client(replies: StubReply[]) {
  const stub = stubFetch(...replies);
  return {
    stub,
    xg: createClient({
      auth: { apiKey: "xg_test" },
      organizationId: "org-1",
      fetch: stub.fetch,
    }),
  };
}

function devicePage(ids: string[], total: number, limit = 2, offset = 0): StubReply {
  return {
    body: {
      devices: ids.map((id) => deviceRow({ id })),
      page: { limit, offset, order: "desc", total },
    },
  };
}

test("list() on a paginated endpoint returns { items, page }", async () => {
  const { xg } = client([devicePage(["a", "b"], 7)]);
  const page = await xg.devices.list({ limit: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.page.total, 7);
  assert.equal(page.page.limit, 2);
});

test("list() on an unpaginated endpoint returns a plain array", async () => {
  const { xg } = client([{ body: { workspaces: [{ id: "ws-1" }, { id: "ws-2" }] } }]);
  const workspaces = await xg.workspaces.list();
  assert.ok(Array.isArray(workspaces));
  assert.equal(workspaces.length, 2);
});

test("iterate() walks pages sequentially and stops at total", async () => {
  const { xg, stub } = client([
    devicePage(["a", "b"], 5, 2, 0),
    devicePage(["c", "d"], 5, 2, 2),
    devicePage(["e"], 5, 2, 4),
  ]);
  const ids: string[] = [];
  for await (const d of xg.devices.iterate({ limit: 2 })) ids.push(d.id);
  assert.deepEqual(ids, ["a", "b", "c", "d", "e"]);
  assert.equal(stub.calls.length, 3);
  assert.match(stub.calls[1]!.url, /offset=2/);
});

test("breaking out of a for-await issues no further requests", async () => {
  const { xg, stub } = client([
    devicePage(["a", "b"], 100, 2, 0),
    devicePage(["c", "d"], 100, 2, 2),
  ]);
  for await (const d of xg.devices.iterate({ limit: 2 })) {
    if (d.id === "b") break;
  }
  assert.equal(stub.calls.length, 1);
});

test("a short page ends the walk even when total claims more (the readings cap)", async () => {
  const { xg, stub } = client([
    {
      body: {
        readings: [
          { ts: "2026-08-22T00:00:00Z", metric: "gps.lat", value: 1, unit: "deg" },
        ],
        page: { limit: 100, offset: 0, order: "desc", total: 10000, totalIsCapped: true },
      },
    },
  ]);
  const seen: unknown[] = [];
  for await (const r of xg.telemetry.iterateReadings("dev-1")) seen.push(r);
  assert.equal(seen.length, 1);
  assert.equal(stub.calls.length, 1);
});

test("onPage sees the page block, which is the only way to notice totalIsCapped", async () => {
  const { xg } = client([
    {
      body: {
        readings: [],
        page: { limit: 100, offset: 0, order: "desc", total: 10000, totalIsCapped: true, coveredFrom: "a", coveredTo: "b" },
      },
    },
  ]);
  let capped = false;
  for await (const _ of xg.telemetry.iterateReadings("dev-1", {
    onPage: (p) => {
      capped ||= p.totalIsCapped === true;
    },
  })) {
    void _;
  }
  assert.equal(capped, true);
});

test("iterate() on an unpaginated collection yields everything in one page", async () => {
  const { xg, stub } = client([{ body: { workspaces: [{ id: "ws-1" }, { id: "ws-2" }] } }]);
  const ids: string[] = [];
  let pages = 0;
  for await (const w of xg.workspaces.iterate({ onPage: () => pages++ })) ids.push(w.id);
  assert.deepEqual(ids, ["ws-1", "ws-2"]);
  assert.equal(pages, 1);
  assert.equal(stub.calls.length, 1);
});

test("listAll() drains the same requests iterate() would make", async () => {
  const { xg, stub } = client([devicePage(["a", "b"], 3, 2, 0), devicePage(["c"], 3, 2, 2)]);
  const all = await xg.devices.listAll({ limit: 2 });
  assert.equal(all.length, 3);
  assert.equal(stub.calls.length, 2);
});

test("pageSize drives the underlying limit", async () => {
  const { xg, stub } = client([devicePage(["a"], 1, 500, 0)]);
  for await (const _ of xg.devices.iterate({ pageSize: 500 })) void _;
  assert.match(stub.calls[0]!.url, /limit=500/);
});

test("an empty page terminates rather than looping forever", async () => {
  const { xg, stub } = client([{ body: { devices: [], page: { limit: 100, offset: 0, order: "desc", total: 42 } } }]);
  const ids: string[] = [];
  for await (const d of xg.devices.iterate()) ids.push(d.id);
  assert.deepEqual(ids, []);
  assert.equal(stub.calls.length, 1);
});
