import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/index.js";
import { stubFetch, type StubReply } from "./stub.js";

/**
 * `xg.workflowTemplates`. The reads a program needs to find a template by tag,
 * and nothing else: the authoring surface is undocumented and out of this
 * package.
 */

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

const row = {
  id: "t1",
  name: "Geofence",
  slug: "geofence",
  description: null,
  tags: ["geofence", "zone-a"],
  status: "draft",
  currentVersion: 1,
  publishedVersion: null,
  usedBy: 0,
  requiredCapabilities: ["gps"],
  createdBy: { id: "u1", name: "A", email: "a@example.test" },
  updatedBy: { id: "u1", name: "A", email: "a@example.test" },
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

test("list unwraps the `templates` envelope and its page block", async () => {
  const { xg } = client([
    { body: { templates: [row], page: { limit: 100, offset: 0, order: "desc", total: 1 } } },
  ]);
  const page = await xg.workflowTemplates.list();
  assert.equal(page.items[0]!.name, "Geofence");
  assert.deepEqual(page.items[0]!.tags, ["geofence", "zone-a"]);
  assert.equal(page.page.total, 1);
});

test("the tag filter goes out as one comma-separated `tag` parameter", async () => {
  const { xg, stub } = client([{ body: { templates: [] } }]);
  await xg.workflowTemplates.list({ tags: ["geofence", "speeding"], status: "published" });
  const url = new URL(stub.calls[0]!.url);
  assert.equal(url.pathname, "/v1/workflow-templates");
  assert.equal(url.searchParams.get("tag"), "geofence,speeding");
  assert.equal(url.searchParams.get("status"), "published");
  // One parameter, not two: repeating it would mean the same request anyway.
  assert.equal(url.searchParams.getAll("tag").length, 1);
});

test("an empty or absent tag list sends no `tag` parameter at all", async () => {
  const { xg, stub } = client([{ body: { templates: [] } }]);
  await xg.workflowTemplates.list({ tags: [] });
  await xg.workflowTemplates.list();
  for (const call of stub.calls) {
    assert.equal(new URL(call.url).searchParams.has("tag"), false);
  }
});

test("tags and requiredCapabilities default to [] against an older deployment", async () => {
  const { xg } = client([
    { body: { templates: [{ ...row, tags: undefined, requiredCapabilities: undefined }] } },
  ]);
  const page = await xg.workflowTemplates.list();
  assert.deepEqual(page.items[0]!.tags, []);
  assert.deepEqual(page.items[0]!.requiredCapabilities, []);
});

test("iterate walks the pages and stops at the total", async () => {
  const { xg, stub } = client([
    {
      body: {
        templates: [row, { ...row, id: "t2" }],
        page: { limit: 2, offset: 0, order: "desc", total: 3 },
      },
    },
    {
      body: {
        templates: [{ ...row, id: "t3" }],
        page: { limit: 2, offset: 2, order: "desc", total: 3 },
      },
    },
  ]);
  const ids: string[] = [];
  for await (const template of xg.workflowTemplates.iterate({ limit: 2, tags: ["geofence"] })) {
    ids.push(template.id);
  }
  assert.deepEqual(ids, ["t1", "t2", "t3"]);
  // The filter is carried onto every page, not just the first.
  for (const call of stub.calls) {
    assert.equal(new URL(call.url).searchParams.get("tag"), "geofence");
  }
});

test("get returns the detail, with versions and usage present as arrays", async () => {
  const { xg, stub } = client([
    {
      body: {
        template: {
          ...row,
          versions: [
            {
              id: "v1",
              version: 1,
              status: "draft",
              message: null,
              definition: { schemaVersion: 2, nodes: [], edges: [] },
              storedSchemaVersion: 2,
              createdBy: row.createdBy,
              createdAt: row.createdAt,
            },
          ],
          usage: [],
        },
      },
    },
  ]);
  const detail = await xg.workflowTemplates.get("t1");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/workflow-templates/t1");
  assert.deepEqual(detail.tags, ["geofence", "zone-a"]);
  assert.equal(detail.versions[0]!.definition.schemaVersion, 2);
  assert.deepEqual(detail.usage, []);
});

test("get tolerates a detail with neither versions nor usage", async () => {
  const { xg } = client([{ body: { template: row } }]);
  const detail = await xg.workflowTemplates.get("t1");
  assert.deepEqual(detail.versions, []);
  assert.deepEqual(detail.usage, []);
});

test("tags() returns the vocabulary from its own route", async () => {
  const { xg, stub } = client([
    { body: { tags: [{ tag: "geofence", count: 2 }, { tag: "zone-a", count: 1 }] } },
  ]);
  const tags = await xg.workflowTemplates.tags();
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/workflow-templates/tags");
  assert.deepEqual(tags.map((t) => t.tag), ["geofence", "zone-a"]);
  assert.equal(tags[0]!.count, 2);
});

test("an id is path-encoded, so a stray slash cannot escape the route", async () => {
  const { xg, stub } = client([{ body: { template: row } }]);
  await xg.workflowTemplates.get("a/b");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/workflow-templates/a%2Fb");
});
