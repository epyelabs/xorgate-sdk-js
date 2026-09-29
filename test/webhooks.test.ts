import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createClient,
  DEVICE_WEBHOOK_EVENT_TYPES,
  WEBHOOK_EVENT_TYPES,
} from "../src/index.js";
import { stubFetch, type StubReply } from "./stub.js";

/** `xg.webhooks` and `xg.devices.webhooks` against a stubbed fetch. */

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

const SECRET = "whsec_" + Buffer.from("s".repeat(32)).toString("base64");

const endpoint = {
  id: "ep-1",
  organizationId: "org-1",
  name: "dispatch",
  url: "https://example.test/hooks",
  description: null,
  secretVersion: 1,
  enabled: true,
  disabledAt: null,
  disabledReason: null,
  consecutiveFailures: 0,
  lastDeliveryAt: null,
  lastSuccessAt: null,
  createdBy: "user-1",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

const delivery = {
  id: "dl-1",
  eventId: "ev-1",
  eventType: "ping",
  endpointId: "ep-1",
  redeliveryOf: null,
  status: "delivered",
  attempt: 1,
  nextAttemptAt: null,
  responseStatus: 204,
  responseMs: 120,
  error: null,
  deliveredAt: "2026-09-28T00:00:01.000Z",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:01.000Z",
};

const page = (total: number) => ({ limit: 100, offset: 0, order: "desc", total });

test("list: GET /webhooks with the org header and list params, unwraps the page", async () => {
  const { xg, stub } = client([{ body: { webhooks: [endpoint], page: page(1) } }]);
  const result = await xg.webhooks.list({ limit: 10, order: "asc", sort: "name" });
  assert.equal(result.items[0]!.name, "dispatch");
  assert.equal(result.page.total, 1);
  const call = stub.calls[0]!;
  const url = new URL(call.url);
  assert.equal(call.method, "GET");
  assert.equal(url.pathname, "/v1/webhooks");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("order"), "asc");
  assert.equal(url.searchParams.get("sort"), "name");
  assert.equal(call.headers["x-organization-id"], "org-1");
});

test("iterate / listAll walk the pages", async () => {
  const { xg, stub } = client([
    { body: { webhooks: [endpoint, { ...endpoint, id: "ep-2" }], page: { limit: 2, offset: 0, order: "desc", total: 3 } } },
    { body: { webhooks: [{ ...endpoint, id: "ep-3" }], page: { limit: 2, offset: 2, order: "desc", total: 3 } } },
  ]);
  const all = await xg.webhooks.listAll({ pageSize: 2 });
  assert.deepEqual(all.map((e) => e.id), ["ep-1", "ep-2", "ep-3"]);
  assert.equal(new URL(stub.calls[1]!.url).searchParams.get("offset"), "2");
});

test("create: POST /webhooks returns { webhook, secret }, and the client keeps no copy", async () => {
  const { xg, stub } = client([{ status: 201, body: { webhook: endpoint, secret: SECRET } }]);
  const created = await xg.webhooks.create({ name: "dispatch", url: "https://example.test/hooks" });
  assert.equal(created.webhook.id, "ep-1");
  assert.equal(created.secret, SECRET);
  assert.equal(stub.calls[0]!.method, "POST");
  assert.deepEqual(stub.calls[0]!.body, { name: "dispatch", url: "https://example.test/hooks" });
  // Nothing on the client (or its resources) serializes the secret.
  assert.ok(!JSON.stringify(xg).includes(SECRET));
  assert.ok(!JSON.stringify(xg.webhooks).includes(SECRET));
  assert.ok(!JSON.stringify(xg.webhooks.deliveries).includes(SECRET));
});

test("create: a 409 duplicate name surfaces as CONFLICT without echoing the body", async () => {
  const { xg } = client([
    { status: 409, body: { error: { code: "CONFLICT", message: 'A webhook endpoint named "dispatch" already exists' } } },
  ]);
  await assert.rejects(xg.webhooks.create({ name: "dispatch", url: "https://example.test/hooks" }), (e: unknown) => {
    assert.equal((e as { code?: string }).code, "CONFLICT");
    return true;
  });
});

test("get: deliveryStats fills missing statuses with 0", async () => {
  const { xg, stub } = client([
    { body: { webhook: { ...endpoint, deliveryStats: { windowHours: 24, delivered: 3 } } } },
  ]);
  const detail = await xg.webhooks.get("ep-1");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/webhooks/ep-1");
  assert.deepEqual(detail.deliveryStats, { windowHours: 24, pending: 0, delivered: 3, failed: 0, exhausted: 0 });
  assert.equal(detail.name, "dispatch");
});

test("update: PATCH /webhooks/{id} with the input", async () => {
  const { xg, stub } = client([{ body: { webhook: { ...endpoint, enabled: false, disabledReason: "manual" } } }]);
  const updated = await xg.webhooks.update("ep-1", { enabled: false });
  assert.equal(updated.enabled, false);
  assert.equal(stub.calls[0]!.method, "PATCH");
  assert.deepEqual(stub.calls[0]!.body, { enabled: false });
});

test("delete: DELETE /webhooks/{id}, 204", async () => {
  const { xg, stub } = client([{ status: 204 }]);
  await xg.webhooks.delete("ep/1");
  assert.equal(stub.calls[0]!.method, "DELETE");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/webhooks/ep%2F1");
});

test("test: POST /webhooks/{id}/test returns { eventId, dispatched }", async () => {
  const { xg, stub } = client([{ status: 202, body: { eventId: "ev-1", dispatched: true } }]);
  assert.deepEqual(await xg.webhooks.test("ep-1"), { eventId: "ev-1", dispatched: true });
  assert.equal(stub.calls[0]!.method, "POST");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/webhooks/ep-1/test");
});

test("rotateSecret: POST /webhooks/{id}/rotate-secret", async () => {
  const { xg, stub } = client([
    { body: { webhook: { ...endpoint, secretVersion: 2 }, secret: SECRET, previousSecretValidForHours: 24 } },
  ]);
  const rotated = await xg.webhooks.rotateSecret("ep-1");
  assert.equal(rotated.webhook.secretVersion, 2);
  assert.equal(rotated.secret, SECRET);
  assert.equal(rotated.previousSecretValidForHours, 24);
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/webhooks/ep-1/rotate-secret");
  assert.ok(!JSON.stringify(xg).includes(SECRET));
});

test("deliveries.list: status filter and paging params", async () => {
  const { xg, stub } = client([{ body: { deliveries: [delivery], page: page(1) } }]);
  const result = await xg.webhooks.deliveries.list("ep-1", { status: "failed", limit: 5, offset: 10 });
  assert.equal(result.items[0]!.status, "delivered");
  const url = new URL(stub.calls[0]!.url);
  assert.equal(url.pathname, "/v1/webhooks/ep-1/deliveries");
  assert.equal(url.searchParams.get("status"), "failed");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("offset"), "10");
});

test("deliveries.iterate walks the log", async () => {
  const { xg } = client([
    { body: { deliveries: [delivery], page: { limit: 1, offset: 0, order: "desc", total: 2 } } },
    { body: { deliveries: [{ ...delivery, id: "dl-2" }], page: { limit: 1, offset: 1, order: "desc", total: 2 } } },
  ]);
  const ids: string[] = [];
  for await (const d of xg.webhooks.deliveries.iterate("ep-1", { pageSize: 1 })) ids.push(d.id);
  assert.deepEqual(ids, ["dl-1", "dl-2"]);
});

test("deliveries.get: excerpt + typed event; eventType filled from the event", async () => {
  const { eventType: _drop, ...row } = delivery;
  const event = {
    id: "ev-1",
    type: "ping",
    apiVersion: "2026-09-27",
    createdAt: "2026-09-28T00:00:00.000Z",
    organizationId: "org-1",
    workspaceId: null,
    data: { message: "Test ping from xorgate" },
  };
  const { xg, stub } = client([{ body: { delivery: { ...row, responseExcerpt: "ok", event } } }]);
  const detail = await xg.webhooks.deliveries.get("ep-1", "dl-1");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/webhooks/ep-1/deliveries/dl-1");
  assert.equal(detail.eventType, "ping");
  assert.equal(detail.responseExcerpt, "ok");
  assert.equal(detail.event?.type, "ping");
  if (detail.event?.type === "ping") assert.equal(detail.event.data.message, "Test ping from xorgate");
});

test("deliveries.get: a missing event and excerpt read as null", async () => {
  const { xg } = client([{ body: { delivery: { ...delivery, event: null } } }]);
  const detail = await xg.webhooks.deliveries.get("ep-1", "dl-1");
  assert.equal(detail.event, null);
  assert.equal(detail.responseExcerpt, null);
  assert.equal(detail.eventType, "ping");
});

test("deliveries.redeliver: POST .../redeliver returns the new delivery", async () => {
  const { xg, stub } = client([
    { status: 202, body: { delivery: { ...delivery, id: "dl-9", status: "pending", attempt: 0, redeliveryOf: "dl-1" }, enqueued: true } },
  ]);
  const result = await xg.webhooks.deliveries.redeliver("ep-1", "dl-1");
  assert.equal(result.delivery.redeliveryOf, "dl-1");
  assert.equal(result.enqueued, true);
  assert.equal(stub.calls[0]!.method, "POST");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/webhooks/ep-1/deliveries/dl-1/redeliver");
});

test("eventTypes: GET /webhook-event-types", async () => {
  const { xg, stub } = client([
    {
      body: {
        apiVersion: "2026-09-27",
        eventTypes: [{ type: "ping", routing: "endpoint", description: "d", sample: { message: "x" } }],
      },
    },
  ]);
  const catalog = await xg.webhooks.eventTypes();
  assert.equal(catalog.apiVersion, "2026-09-27");
  assert.equal(catalog.eventTypes[0]!.routing, "endpoint");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/webhook-event-types");
});

test("devices.webhooks.get: GET /devices/{id}/webhooks unwraps routes", async () => {
  const routes = [{ endpointId: "ep-1", endpointName: "dispatch", eventTypes: ["device.online", "device.offline"] }];
  const { xg, stub } = client([{ body: { routes } }]);
  assert.deepEqual(await xg.devices.webhooks.get("dev-1"), routes);
  assert.equal(stub.calls[0]!.method, "GET");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/devices/dev-1/webhooks");
});

test("devices.webhooks.set: PUT with { routes } and returns the new set; [] clears", async () => {
  const routes = [{ endpointId: "ep-1", endpointName: "dispatch", eventTypes: ["telemetry_session.completed"] }];
  const { xg, stub } = client([{ body: { routes } }, { body: { routes: [] } }]);
  const result = await xg.devices.webhooks.set("dev-1", [
    { endpointId: "ep-1", eventTypes: ["telemetry_session.completed"] },
  ]);
  assert.deepEqual(result, routes);
  assert.equal(stub.calls[0]!.method, "PUT");
  assert.deepEqual(stub.calls[0]!.body, {
    routes: [{ endpointId: "ep-1", eventTypes: ["telemetry_session.completed"] }],
  });
  assert.deepEqual(await xg.devices.webhooks.set("dev-1", []), []);
  assert.deepEqual(stub.calls[1]!.body, { routes: [] });
});

test("the exported event-type lists match the v1 catalog", () => {
  assert.equal(WEBHOOK_EVENT_TYPES.length, 9);
  assert.equal(DEVICE_WEBHOOK_EVENT_TYPES.length, 7);
  assert.ok(!DEVICE_WEBHOOK_EVENT_TYPES.includes("workflow.event" as never));
});
