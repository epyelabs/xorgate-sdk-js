import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, isXorgateError } from "../src/index.js";
import type { TransferPreview, TransferSummary } from "../src/index.js";
import { deviceRow, stubFetch, type StubReply } from "./stub.js";

/**
 * `devices.transfer()`, `devices.previewTransfer()`, `devices.transferMany()`
 * and `xg.transferOffers`.
 *
 * The API shape these are written against is FROZEN and already serving
 * production traffic (`plans/transfer-device-ownership/PROGRESS.md`, "THE FROZEN
 * API SHAPE"). Several assertions here exist to pin decisions that a future
 * tidy-up would otherwise reverse: the `{code}` path parameter on every offer
 * route including cancel, the 201-vs-200 distinction on offer creation, and the
 * fact that the recipient's preview is a SMALLER, allowlisted type rather than a
 * short `TransferOffer`.
 */

function client(replies: StubReply[], organizationId = "org-1") {
  const stub = stubFetch(...replies);
  return {
    stub,
    xg: createClient({
      auth: { apiKey: "xg_test" },
      organizationId,
      fetch: stub.fetch,
    }),
  };
}

const summary: TransferSummary = {
  id: "tr-1",
  deviceId: "dev-1",
  from: { workspaceId: "ws-1", organizationId: "org-1" },
  to: { workspaceId: "ws-2", organizationId: "org-1" },
  crossOrg: false,
  detachedWorkflowAttachments: [],
  kvsChannelsRetagged: 2,
  scopeAttributes: "written",
  adoption: "pending",
  warnings: [],
};

const preview: TransferPreview = {
  deviceId: "dev-1",
  deviceName: "Excavator 12",
  serial: "XG-0042",
  from: {
    workspaceId: "ws-1",
    organizationId: "org-1",
    workspaceName: "Yard",
    organizationName: "Acme",
  },
  to: {
    workspaceId: "ws-2",
    organizationId: "org-1",
    workspaceName: "Depot",
    organizationName: "Acme",
  },
  crossOrg: false,
  workflowAttachments: [],
  runningWorkflowRuns: 0,
  openMediaSessions: 1,
  staleSessionTokens: 3,
  kvsChannels: 2,
  carriesHistory: true,
  blockers: [],
  warnings: ["The device is not currently online."],
};

const offerRow = {
  id: "off-1",
  code: "ABCD-EFGH-JKLM",
  status: "pending" as const,
  direction: "outgoing" as const,
  deviceId: "dev-1",
  deviceName: "Excavator 12",
  from: { organizationId: "org-1", workspaceId: "ws-1" },
  acceptedBy: null,
  transferId: null,
  expiresAt: "2026-09-26T00:00:00.000Z",
  resolvedAt: null,
  createdAt: "2026-09-19T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// devices.transfer()
// ---------------------------------------------------------------------------

test("transfer posts workspaceId and unwraps both halves of the envelope", async () => {
  const { xg, stub } = client([
    { body: { device: deviceRow({ workspaceId: "ws-2" }), transfer: summary } },
  ]);
  const result = await xg.devices.transfer("dev-1", { workspaceId: "ws-2" });

  const call = stub.calls[0]!;
  assert.equal(call.method, "POST");
  assert.equal(new URL(call.url).pathname, "/v1/devices/dev-1/transfer");
  assert.deepEqual(call.body, { workspaceId: "ws-2" });
  // The device comes back NORMALIZED (the deprecated top-level duplicates on
  // the wire are dropped), which is how a caller detects the move.
  assert.equal(result.device.workspaceId, "ws-2");
  assert.equal(
    (result.device as unknown as Record<string, unknown>).firmwareVersion,
    undefined,
  );
  assert.equal(result.transfer.id, "tr-1");
  assert.equal(result.transfer.kvsChannelsRetagged, 2);
});

test("organizationId is sent only when given, so a same-org move stays a same-org request", async () => {
  const { xg, stub } = client([{ body: { device: deviceRow(), transfer: summary } }]);
  await xg.devices.transfer("dev-1", { workspaceId: "ws-2" });
  await xg.devices.transfer("dev-1", { workspaceId: "ws-9", organizationId: "org-2" });
  assert.deepEqual(stub.calls[0]!.body, { workspaceId: "ws-2" });
  assert.deepEqual(stub.calls[1]!.body, { workspaceId: "ws-9", organizationId: "org-2" });
});

test("a device id with a slash cannot escape its path segment", async () => {
  const { xg, stub } = client([{ body: { device: deviceRow(), transfer: summary } }]);
  await xg.devices.transfer("a/b", { workspaceId: "ws-2" });
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/devices/a%2Fb/transfer");
});

test("adoption:'unknown' survives the round trip and is never collapsed", async () => {
  const { xg } = client([
    {
      body: {
        device: deviceRow(),
        transfer: { ...summary, adoption: "unknown", scopeAttributes: "unchanged" },
      },
    },
  ]);
  const { transfer } = await xg.devices.transfer("dev-1", { workspaceId: "ws-2" });
  assert.equal(transfer.adoption, "unknown");
});

test("scopeAttributes:'failed' is a DEGRADED SUCCESS: a 200, not a thrown error", async () => {
  const { xg } = client([
    {
      status: 200,
      body: {
        device: deviceRow({ workspaceId: "ws-2" }),
        transfer: {
          ...summary,
          scopeAttributes: "failed",
          warnings: ["The broker was not told about the new tenancy."],
        },
      },
    },
  ]);
  const { transfer } = await xg.devices.transfer("dev-1", { workspaceId: "ws-2" });
  assert.equal(transfer.scopeAttributes, "failed");
  assert.equal(transfer.warnings.length, 1);
});

test("SAME_WORKSPACE maps to its own code, not to a bare BAD_REQUEST", async () => {
  const { xg } = client([
    {
      status: 400,
      body: {
        error: { code: "SAME_WORKSPACE", message: "The device is already in that workspace." },
      },
    },
  ]);
  await assert.rejects(
    () => xg.devices.transfer("dev-1", { workspaceId: "ws-1" }),
    (e: unknown) => isXorgateError(e) && e.code === "SAME_WORKSPACE" && e.status === 400,
  );
});

test("TRANSFER_FAILED is a 502 and is retryable, because it rolled itself back", async () => {
  const { xg } = client([
    {
      status: 502,
      body: { error: { code: "TRANSFER_FAILED", message: "rolled back, nothing changed" } },
    },
  ]);
  await assert.rejects(
    () => xg.devices.transfer("dev-1", { workspaceId: "ws-2" }),
    (e: unknown) =>
      isXorgateError(e) &&
      e.code === "TRANSFER_FAILED" &&
      e.retryable === true &&
      typeof e.hint === "string",
  );
});

test("SERIAL_COLLISION and TRANSFER_IN_PROGRESS keep their 409 codes", async () => {
  for (const code of ["SERIAL_COLLISION", "TRANSFER_IN_PROGRESS", "CONCURRENT_MODIFICATION"]) {
    const { xg } = client([{ status: 409, body: { error: { code, message: code } } }]);
    await assert.rejects(
      () => xg.devices.transfer("dev-1", { workspaceId: "ws-2" }),
      (e: unknown) => isXorgateError(e) && e.code === code && e.retryable === false,
    );
  }
});

// ---------------------------------------------------------------------------
// devices.previewTransfer()
// ---------------------------------------------------------------------------

test("preview is a GET with the destination in the query string", async () => {
  const { xg, stub } = client([{ body: { preview } }]);
  const result = await xg.devices.previewTransfer("dev-1", {
    workspaceId: "ws-2",
    organizationId: "org-2",
  });
  const url = new URL(stub.calls[0]!.url);
  assert.equal(stub.calls[0]!.method, "GET");
  assert.equal(url.pathname, "/v1/devices/dev-1/transfer/preview");
  assert.equal(url.searchParams.get("workspaceId"), "ws-2");
  assert.equal(url.searchParams.get("organizationId"), "org-2");
  assert.equal(result.carriesHistory, true);
  assert.equal(result.staleSessionTokens, 3);
});

test("blockers are RETURNED, not thrown: a blocked preview is still a 200", async () => {
  const { xg } = client([
    {
      body: {
        preview: {
          ...preview,
          blockers: [
            { code: "SERIAL_COLLISION", message: 'serial "XG-0042" already exists there' },
          ],
        },
      },
    },
  ]);
  const result = await xg.devices.previewTransfer("dev-1", { workspaceId: "ws-2" });
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0]!.code, "SERIAL_COLLISION");
});

// ---------------------------------------------------------------------------
// devices.transferMany() — a client-side loop, deliberately
// ---------------------------------------------------------------------------

test("transferMany issues ONE request per device, sequentially", async () => {
  const { xg, stub } = client([{ body: { device: deviceRow(), transfer: summary } }]);
  const out = await xg.devices.transferMany(["a", "b", "c"], { workspaceId: "ws-2" });
  assert.equal(stub.calls.length, 3);
  assert.deepEqual(
    stub.calls.map((c) => new URL(c.url).pathname),
    ["/v1/devices/a/transfer", "/v1/devices/b/transfer", "/v1/devices/c/transfer"],
  );
  assert.equal(out.length, 3);
  assert.ok(out.every((i) => i.ok));
});

test("transferMany does not stop at a failure and records it per device", async () => {
  const { xg } = client([
    { body: { device: deviceRow(), transfer: summary } },
    { status: 409, body: { error: { code: "SERIAL_COLLISION", message: "taken" } } },
    { body: { device: deviceRow(), transfer: summary } },
  ]);
  const out = await xg.devices.transferMany(["a", "b", "c"], { workspaceId: "ws-2" });
  assert.deepEqual(
    out.map((i) => [i.deviceId, i.ok]),
    [
      ["a", true],
      ["b", false],
      ["c", true],
    ],
  );
  assert.equal(out[1]!.error!.code, "SERIAL_COLLISION");
  assert.equal(out[1]!.error!.status, 409);
  assert.equal(out[1]!.transfer, undefined);
});

test("transferMany stops at an aborted signal rather than firing the rest", async () => {
  const { xg, stub } = client([{ body: { device: deviceRow(), transfer: summary } }]);
  const controller = new AbortController();
  controller.abort();
  const out = await xg.devices.transferMany(["a", "b"], {
    workspaceId: "ws-2",
    signal: controller.signal,
  });
  assert.deepEqual(out, []);
  assert.equal(stub.calls.length, 0);
});

// ---------------------------------------------------------------------------
// transferOffers
// ---------------------------------------------------------------------------

test("creating an offer reports 201 as a fresh mint and 200 as a reuse", async () => {
  const body = { offer: offerRow, willDetachWorkflowAttachments: ["Geofence"] };
  const fresh = client([{ status: 201, body }]);
  assert.equal((await fresh.xg.transferOffers.create("dev-1")).reused, false);

  const reused = client([{ status: 200, body }]);
  const result = await reused.xg.transferOffers.create("dev-1");
  assert.equal(result.reused, true);
  // Both bodies are byte-identical on the wire, so `reused` is the ONLY signal.
  assert.deepEqual(result.offer, offerRow);
  assert.deepEqual(result.willDetachWorkflowAttachments, ["Geofence"]);
  assert.equal(
    new URL(reused.stub.calls[0]!.url).pathname,
    "/v1/devices/dev-1/transfer-offers",
  );
});

test("an offer body is an empty object, not an absent one", async () => {
  const { xg, stub } = client([
    { status: 201, body: { offer: offerRow, willDetachWorkflowAttachments: [] } },
  ]);
  await xg.transferOffers.create("dev-1");
  assert.deepEqual(stub.calls[0]!.body, {});
});

test("list sends the status filter and unwraps the bare `offers` collection", async () => {
  const { xg, stub } = client([{ body: { offers: [offerRow] } }]);
  const offers = await xg.transferOffers.list({ status: "pending" });
  assert.equal(new URL(stub.calls[0]!.url).searchParams.get("status"), "pending");
  assert.equal(offers[0]!.code, "ABCD-EFGH-JKLM");
  assert.equal(offers[0]!.direction, "outgoing");
});

test("listAll over the unpaginated collection costs exactly one request", async () => {
  const { xg, stub } = client([{ body: { offers: [offerRow, { ...offerRow, id: "off-2" }] } }]);
  const all = await xg.transferOffers.listAll();
  assert.equal(all.length, 2);
  assert.equal(stub.calls.length, 1);
});

test("listForDevice is the device-scoped history route", async () => {
  const { xg, stub } = client([{ body: { offers: [] } }]);
  await xg.transferOffers.listForDevice("dev-1");
  assert.equal(
    new URL(stub.calls[0]!.url).pathname,
    "/v1/devices/dev-1/transfer-offers",
  );
  assert.equal(stub.calls[0]!.method, "GET");
});

test("get(code) returns the RECIPIENT's allowlist, which carries no device id", async () => {
  const wire = {
    code: "ABCD-EFGH-JKLM",
    status: "pending",
    expiresAt: "2026-09-26T00:00:00.000Z",
    createdAt: "2026-09-19T00:00:00.000Z",
    device: { name: "Excavator 12", model: { id: "dm-1", name: "Argus v1", sku: "ARG-1" } },
    from: { organizationName: "Acme" },
  };
  const { xg, stub } = client([{ body: { offer: wire } }]);
  const offer = await xg.transferOffers.get("ABCD-EFGH-JKLM");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/transfer-offers/ABCD-EFGH-JKLM");
  assert.equal(offer.device!.model.sku, "ARG-1");
  assert.equal(offer.from.organizationName, "Acme");
  // The whole point of the separate type: these fields are absent on the wire
  // and must not be reachable on the SDK value either.
  for (const leaked of ["deviceId", "serial", "workspaceId", "organizationId"]) {
    assert.equal((offer as unknown as Record<string, unknown>)[leaked], undefined, leaked);
  }
});

test("accept posts the destination workspace and returns device, transfer and offer", async () => {
  const accepted = { ...offerRow, status: "accepted" as const, direction: "incoming" as const };
  const { xg, stub } = client([
    {
      body: {
        device: deviceRow({ workspaceId: "ws-9" }),
        transfer: { ...summary, crossOrg: true, detachedWorkflowAttachments: ["Geofence"] },
        offer: accepted,
      },
    },
  ]);
  const result = await xg.transferOffers.accept("ABCD-EFGH-JKLM", { workspaceId: "ws-9" });
  assert.equal(
    new URL(stub.calls[0]!.url).pathname,
    "/v1/transfer-offers/ABCD-EFGH-JKLM/accept",
  );
  assert.deepEqual(stub.calls[0]!.body, { workspaceId: "ws-9" });
  assert.equal(result.device.workspaceId, "ws-9");
  assert.deepEqual(result.transfer.detachedWorkflowAttachments, ["Geofence"]);
  assert.equal(result.offer.status, "accepted");
});

test("decline returns the resolved offer, which is how the SOURCE learns of it", async () => {
  const declined = { ...offerRow, status: "declined" as const, resolvedAt: "2026-09-20T00:00:00.000Z" };
  const { xg, stub } = client([{ body: { offer: declined } }]);
  const offer = await xg.transferOffers.decline("ABCD-EFGH-JKLM");
  assert.equal(
    new URL(stub.calls[0]!.url).pathname,
    "/v1/transfer-offers/ABCD-EFGH-JKLM/decline",
  );
  assert.equal(offer.status, "declined");
  assert.equal(offer.resolvedAt, "2026-09-20T00:00:00.000Z");
});

test("cancel is BY CODE and answers 204 with no body", async () => {
  const { xg, stub } = client([{ status: 204 }]);
  const result = await xg.transferOffers.cancel("ABCD-EFGH-JKLM");
  assert.equal(result, undefined);
  assert.equal(stub.calls[0]!.method, "DELETE");
  // Every offer route uses {code}. There is no cancel-by-id, and a resource id
  // in this position would 404.
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/transfer-offers/ABCD-EFGH-JKLM");
});

test("an already-resolved offer is a CONFLICT the caller can match on", async () => {
  const { xg } = client([
    { status: 409, body: { error: { code: "CONFLICT", message: "This offer is already accepted." } } },
  ]);
  await assert.rejects(
    () => xg.transferOffers.cancel("ABCD-EFGH-JKLM"),
    (e: unknown) => isXorgateError(e) && e.code === "CONFLICT" && e.status === 409,
  );
});

test("every offer route carries the organization header, including the preview", async () => {
  const { xg, stub } = client([{ body: { offer: { code: "c", status: "pending", expiresAt: "", createdAt: "", device: null, from: { organizationName: "X" } } } }]);
  await xg.transferOffers.get("c");
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");
});
