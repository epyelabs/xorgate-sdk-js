import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, isXorgateError } from "../src/index.js";
import { deviceRow, stubFetch, type StubReply } from "./stub.js";

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

test("api-keys unwraps the snake_case envelopes in both directions", async () => {
  const { xg } = client([
    { body: { api_keys: [{ id: "k1", keyPrefix: "xg_AbCdE", lastUsedAt: "2026-08-22T14:22:09.844Z" }] } },
    { status: 201, body: { api_key: { id: "k2", keyPrefix: "xg_AAAAA" }, plaintext_key: "xg_secret" } },
  ]);
  const keys = await xg.apiKeys.list();
  assert.equal(keys[0]!.id, "k1");
  // lastUsedAt is a real signal now: it advances on every authenticated call.
  assert.equal(keys[0]!.lastUsedAt, "2026-08-22T14:22:09.844Z");

  const created = await xg.apiKeys.create({ name: "test", scope: "cloud" });
  assert.equal(created.apiKey.id, "k2");
  assert.equal(created.plaintextKey, "xg_secret");
});

test("api-keys also accepts the camelCase envelope, so a later rename is free", async () => {
  const { xg } = client([{ body: { apiKeys: [{ id: "k1" }] } }]);
  assert.equal((await xg.apiKeys.list())[0]!.id, "k1");
});

test("device-models unwraps device_model / device_models", async () => {
  const { xg } = client([
    { body: { device_models: [{ id: "dm-1", sku: "XG-CM5-DUAL" }] } },
    { body: { device_model: { id: "dm-1", sku: "XG-CM5-DUAL" } } },
  ]);
  assert.equal((await xg.deviceModels.list())[0]!.sku, "XG-CM5-DUAL");
  assert.equal((await xg.deviceModels.get("dm-1")).sku, "XG-CM5-DUAL");
});

test("a device-model write validates ioCapabilities BEFORE any request", async () => {
  const { xg, stub } = client([{ status: 201, body: { device_model: { id: "dm-2" } } }]);
  await assert.rejects(
    xg.deviceModels.create({
      name: "Tracker v2",
      sku: "XG-T2",
      ioCapabilities: { schemaVersion: 1, media: { video: [{ key: "cam0" }] } } as never,
    }),
    (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.code, "INVALID_INPUT");
      const issues = e.details!["issues"] as Array<{ path: string }>;
      assert.equal(issues[0]!.path, "media.video[0].codec");
      return true;
    },
  );
  assert.equal(stub.calls.length, 0, "no request was made");
});

test("{ validate: false } lets a rejected document through", async () => {
  const { xg, stub } = client([{ status: 201, body: { device_model: { id: "dm-2" } } }]);
  await xg.deviceModels.create(
    { name: "x", sku: "y", ioCapabilities: { schemaVersion: 2 } as never },
    { validate: false },
  );
  assert.equal(stub.calls.length, 1);
});

test("devices.get drops the deprecated top-level duplicates", async () => {
  const { xg } = client([{ body: { device: deviceRow() } }]);
  const device = await xg.devices.get("dev-1");
  const keys = Object.keys(device);
  for (const gone of ["firmwareVersion", "gnssAntBias", "activeStreamsViewType", "recordingConfig"]) {
    assert.ok(!keys.includes(gone), `${gone} should not be on the SDK's Device`);
  }
  assert.equal(device.agentVersion, "b30d3f4");
  assert.equal(device.config.recording?.telemetry?.enabled, true);
});

test("getConfig() computes pending, and an offline device is never pending", async () => {
  const online = client([
    { body: { device: deviceRow({ configRev: 5, reportedConfig: { rev: 4 }, status: "online" }) } },
  ]);
  assert.equal((await online.xg.devices.getConfig("dev-1")).pending, true);

  const caughtUp = client([
    { body: { device: deviceRow({ configRev: 5, reportedConfig: { rev: 5 }, status: "online" }) } },
  ]);
  assert.equal((await caughtUp.xg.devices.getConfig("dev-1")).pending, false);

  const offline = client([
    { body: { device: deviceRow({ configRev: 5, reportedConfig: { rev: 1 }, status: "offline" }) } },
  ]);
  assert.equal((await offline.xg.devices.getConfig("dev-1")).pending, false);

  const neverReported = client([
    { body: { device: deviceRow({ configRev: 1, reportedConfig: null, status: "online" }) } },
  ]);
  assert.equal((await neverReported.xg.devices.getConfig("dev-1")).pending, true);
});

test("patchConfig sends the patch verbatim: it replaces a namespace whole", async () => {
  const { xg, stub } = client([{ body: { device: deviceRow() } }]);
  await xg.devices.patchConfig("dev-1", { recording: { telemetry: { enabled: true } } });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]!.method, "PATCH");
  assert.deepEqual(stub.calls[0]!.body, { recording: { telemetry: { enabled: true } } });
});

test("mergeConfig reads first and sends the whole namespace back", async () => {
  const current = deviceRow({
    config: {
      recording: {
        telemetry: { enabled: false, rateHz: 1 },
        video: { enabled: true, cameras: { cam1: false } },
      },
    },
  });
  const { xg, stub } = client([{ body: { device: current } }, { body: { device: current } }]);

  await xg.devices.mergeConfig("dev-1", { recording: { telemetry: { enabled: true } } });

  assert.equal(stub.calls.length, 2, "one read, one write");
  assert.equal(stub.calls[0]!.method, "GET");
  // The exact regression Phase 0 hit: cam1:false must survive a telemetry write.
  assert.deepEqual(stub.calls[1]!.body, {
    recording: {
      telemetry: { enabled: true, rateHz: 1 },
      video: { enabled: true, cameras: { cam1: false } },
    },
  });
});

test("mergeConfig passes a namespace-level null through as a revert", async () => {
  const { xg, stub } = client([{ body: { device: deviceRow() } }, { body: { device: deviceRow() } }]);
  await xg.devices.mergeConfig("dev-1", { cellular: null });
  assert.deepEqual(stub.calls[1]!.body, { cellular: null });
});

test("mergeConfig treats a null BELOW a namespace as a key deletion", async () => {
  const current = deviceRow({
    config: { recording: { telemetry: { enabled: true, rateHz: 5 } } },
  });
  const { xg, stub } = client([{ body: { device: current } }, { body: { device: current } }]);
  await xg.devices.mergeConfig("dev-1", { recording: { telemetry: { rateHz: null } as never } });
  assert.deepEqual(stub.calls[1]!.body, { recording: { telemetry: { enabled: true } } });
});

test("mergeConfig replaces arrays rather than concatenating them", async () => {
  const current = deviceRow({ config: { timeSync: { offlineSources: true, maxStepsPerBoot: 4 } } });
  const { xg, stub } = client([{ body: { device: current } }, { body: { device: current } }]);
  await xg.devices.mergeConfig("dev-1", { timeSync: { maxStepsPerBoot: 2 } });
  assert.deepEqual(stub.calls[1]!.body, {
    timeSync: { offlineSources: true, maxStepsPerBoot: 2 },
  });
});

test("commands hit their own paths and return the flat ack", async () => {
  const ack = { requestId: "req-1", command: "reboot", expiresAt: 1787410000000 };
  const { xg, stub } = client([{ status: 202, body: ack }]);
  const result = await xg.devices.reboot("dev-1");
  assert.equal(stub.calls[0]!.url, "https://api.xorgate.io/v1/devices/dev-1/reboot");
  assert.equal(result.requestId, "req-1");

  for (const [method, path] of [
    ["powerOff", "power-off"],
    ["refreshState", "refresh-state"],
    ["updateAgent", "update"],
  ] as const) {
    const c = client([{ status: 202, body: ack }]);
    await c.xg.devices[method]("dev-1");
    assert.match(c.stub.calls[0]!.url, new RegExp(`/devices/dev-1/${path}$`));
  }
});

test("videoChannels uses the renamed route and the opaque channelRef", async () => {
  const { xg, stub } = client([
    { body: { channels: [{ streamKey: "cam0", channelName: "dev-1-cam0", channelRef: "arn:...", region: "us-east-1" }] } },
  ]);
  const channels = await xg.devices.videoChannels("dev-1");
  assert.match(stub.calls[0]!.url, /\/devices\/dev-1\/video-channels$/);
  assert.equal(channels[0]!.channelRef, "arn:...");
});

test("identity() answers null for an unprovisioned device, with a 200", async () => {
  const { xg } = client([{ body: { identity: null } }]);
  assert.equal(await xg.devices.identity("dev-1"), null);
});

test("latestAgentBuild() maps the 404 to null: latest unknown is not an error", async () => {
  const missing = client([
    { status: 404, body: { error: { code: "NOT_FOUND", message: "No published agent build manifest yet" } } },
  ]);
  assert.equal(await missing.xg.devices.latestAgentBuild(), null);

  const present = client([{ body: { latest: { version: "b30d3f4", channel: null, builtAt: null, packageVersion: null, tarball: null } } }]);
  assert.equal((await present.xg.devices.latestAgentBuild())!.version, "b30d3f4");
});

test("a 403 from latestAgentBuild still throws: only NOT_FOUND is swallowed", async () => {
  const { xg } = client([{ status: 403, body: { error: { code: "FORBIDDEN", message: "no" } } }]);
  await assert.rejects(xg.devices.latestAgentBuild(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "FORBIDDEN");
    return true;
  });
});

test("deviceRegistrations.create() refuses to guess a workspace", async () => {
  const { xg, stub } = client([{ body: {} }]);
  await assert.rejects(xg.deviceRegistrations.create(), (e: unknown) => {
    assert.ok(isXorgateError(e));
    assert.equal(e.code, "INVALID_CONFIG");
    return true;
  });
  assert.equal(stub.calls.length, 0);
});

test("deviceRegistrations.create() sends the workspace as a header", async () => {
  const { xg, stub } = client([
    { body: { code: "K7QF4M2P", status: "pending", deviceId: null, expiresAt: "x", installUrl: "y" } },
  ]);
  const reg = await xg.forWorkspace("ws-1").deviceRegistrations.create();
  assert.equal(stub.calls[0]!.headers["x-workspace-id"], "ws-1");
  assert.equal(reg.code, "K7QF4M2P");
});

test("waitForClaim resolves on claimed, throws CONFLICT on expired", async () => {
  const pending = { code: "C", status: "pending", deviceId: null, expiresAt: "x", installUrl: "y" };
  const claimed = { ...pending, status: "claimed", deviceId: "dev-9" };
  const ok = client([{ body: pending }, { body: claimed }]);
  const result = await ok.xg.deviceRegistrations.waitForClaim("C", { pollIntervalMs: 1 });
  assert.equal(result.deviceId, "dev-9");

  const gone = client([{ body: { ...pending, status: "expired" } }]);
  await assert.rejects(
    gone.xg.deviceRegistrations.waitForClaim("C", { pollIntervalMs: 1 }),
    (e: unknown) => isXorgateError(e) && e.code === "CONFLICT",
  );
});

test("waitForClaim gives up with TIMEOUT rather than polling forever", async () => {
  const { xg } = client([
    { body: { code: "C", status: "pending", deviceId: null, expiresAt: "x", installUrl: "y" } },
  ]);
  await assert.rejects(
    xg.deviceRegistrations.waitForClaim("C", { pollIntervalMs: 5, timeoutMs: 1 }),
    (e: unknown) => isXorgateError(e) && e.code === "TIMEOUT",
  );
});

test("media.sessions.listRuns forces group=runs and sort=startedAt", async () => {
  const { xg, stub } = client([{ body: { runs: [], page: { limit: 100, offset: 0, order: "desc", total: 0 } } }]);
  await xg.media.sessions.listRuns("dev-1", { limit: 20 });
  assert.match(stub.calls[0]!.url, /group=runs/);
  assert.match(stub.calls[0]!.url, /sort=startedAt/);
});

test("Date parameters are sent as ISO-8601", async () => {
  const { xg, stub } = client([{ body: { sessions: [], page: { limit: 100, offset: 0, order: "desc", total: 0 } } }]);
  await xg.media.sessions.list("dev-1", {
    from: new Date("2026-08-09T00:00:00.000Z"),
    to: "2026-08-10T00:00:00Z",
  });
  assert.match(stub.calls[0]!.url, /from=2026-08-09T00%3A00%3A00\.000Z/);
  assert.match(stub.calls[0]!.url, /to=2026-08-10T00%3A00%3A00Z/);
});

test("replayManifest takes either a session or a range, and unwraps `replay`", async () => {
  const manifest = { deviceId: "dev-1", from: 1, to: 2, urlExpiresAt: 3, sessions: [] };
  const bySession = client([{ body: { replay: manifest } }]);
  assert.equal((await bySession.xg.media.replayManifest("dev-1", { sessionId: "s1" })).deviceId, "dev-1");
  assert.match(bySession.stub.calls[0]!.url, /sessionId=s1/);

  const byRange = client([{ body: { replay: manifest } }]);
  await byRange.xg.media.replayManifest("dev-1", {
    from: "2026-08-09T14:20:00Z",
    to: "2026-08-09T14:35:00Z",
    streamKey: "cam0",
  });
  assert.match(byRange.stub.calls[0]!.url, /streamKey=cam0/);
});

test("replayManifest sends telemetry=0 only on the opt-out, and passes the block through untouched", async () => {
  const telemetry = {
    sessions: [
      {
        id: "t1",
        status: "closed",
        rateHz: 1,
        timeSource: "rtc",
        from: 1,
        to: 2,
        overview: { format: "overview.v1", url: "https://s3/overview", bytes: 23579, builtAt: 3 },
        segments: [{ seq: 0, startTs: 1, endTs: 2, samples: 60, bytes: 5466, url: "https://s3/seg" }],
        insights: { computed: { distance: 1 }, computedAt: 3, events: [], distance: { meters: 25181.6 } },
      },
    ],
    truncated: false,
  };
  const manifest = { deviceId: "dev-1", from: 1, to: 2, urlExpiresAt: 3, sessions: [], telemetry };
  const withBlock = client([{ body: { replay: manifest } }]);
  const replay = await withBlock.xg.media.replayManifest("dev-1", { sessionId: "s1" });
  assert.doesNotMatch(withBlock.stub.calls[0]!.url, /telemetry=/);
  assert.deepEqual(replay.telemetry, telemetry);
  assert.equal(replay.telemetry?.sessions[0]!.insights?.distance?.meters, 25181.6);

  const optOut = client([{ body: { replay: { ...manifest, telemetry: undefined } } }]);
  const bare = await optOut.xg.media.replayManifest("dev-1", {
    from: "2026-08-09T14:20:00Z",
    to: "2026-08-09T14:35:00Z",
    telemetry: false,
  });
  assert.match(optOut.stub.calls[0]!.url, /telemetry=0/);
  // An old server (or the opt-out) leaves the field absent, never null.
  assert.equal(bare.telemetry, undefined);
});

test("telemetry.sessions.list hits /telemetry/sessions, sends overlap bounds as ISO, and unwraps the page", async () => {
  const { xg, stub } = client([
    {
      body: {
        sessions: [{ id: "t1", deviceId: "dev-1", status: "closed", segments: 52, insights: null }],
        page: { limit: 25, offset: 0, order: "desc", total: 1 },
      },
    },
  ]);
  const page = await xg.telemetry.sessions.list("dev-1", {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: "2026-10-01T00:00:00Z",
    status: "closed",
  });
  assert.match(stub.calls[0]!.url, /\/devices\/dev-1\/telemetry\/sessions\?/);
  assert.match(stub.calls[0]!.url, /from=2026-09-01T00%3A00%3A00\.000Z/);
  assert.match(stub.calls[0]!.url, /status=closed/);
  assert.equal(page.items[0]!.segments, 52);
  assert.equal(page.page.total, 1);
});

test("telemetry metric lists are sent comma-separated, and latestByMetric rekeys", async () => {
  const { xg } = client([
    {
      body: {
        latest: [
          { metric: "gps.lat", value: 43.663339, unit: "deg", ts: "2026-08-22T14:00:00Z" },
          { metric: "gps.lon", value: -79.519454, unit: "deg", ts: "2026-08-22T14:00:00Z" },
        ],
      },
    },
  ]);
  const byMetric = await xg.telemetry.latestByMetric("dev-1");
  assert.equal(byMetric["gps.lat"]!.value, 43.663339);

  const history = client([{ body: { readings: [], bucketSeconds: 60, truncated: false } }]);
  await history.xg.telemetry.history("dev-1", {
    from: "2026-08-09T00:00:00Z",
    to: "2026-08-10T00:00:00Z",
    metric: ["gps.lat", "gps.lon"],
    interval: 60,
  });
  assert.match(history.stub.calls[0]!.url, /metric=gps\.lat%2Cgps\.lon/);
  assert.match(history.stub.calls[0]!.url, /interval=60/);
});

test("readings() defaults to the table shape and readingsFlat() to the flat one", async () => {
  const table = client([
    {
      body: {
        columns: [{ key: "gps.lat", unit: "deg" }],
        rows: [{ ts: "2026-08-22T14:00:00Z", v: [43.6] }],
        columnSource: "model",
        page: { limit: 100, offset: 0, order: "desc", total: 1 },
      },
    },
  ]);
  const page = await table.xg.telemetry.readings("dev-1");
  assert.match(table.stub.calls[0]!.url, /shape=table/);
  assert.equal(page.columnSource, "model");
  assert.equal(page.rows[0]!.v[0], 43.6);

  const flat = client([
    { body: { readings: [{ ts: "t", metric: "gps.lat", value: 1, unit: "deg" }], page: { limit: 100, offset: 0, order: "desc", total: 1 } } },
  ]);
  const flatPage = await flat.xg.telemetry.readingsFlat("dev-1");
  assert.match(flat.stub.calls[0]!.url, /shape=flat/);
  assert.equal(flatPage.items[0]!.metric, "gps.lat");
});

test("a 204 resolves to undefined rather than failing to parse an empty body", async () => {
  const { xg } = client([{ status: 204 }]);
  assert.equal(await xg.workspaces.delete("ws-1"), undefined);
});

test("memberships.add returns the invited flag alongside the row", async () => {
  const { xg } = client([
    { status: 201, body: { membership: { id: "m1", userId: "u1", organizationId: "org-1", role: "admin", createdAt: "t" }, invited: true } },
  ]);
  const result = await xg.memberships.add({ email: "new@acme.co", role: "admin" });
  assert.equal(result.invited, true);
  assert.equal(result.membership.role, "admin");
});

test("auth.createSessionToken posts the scope and returns the flat credential", async () => {
  const { xg, stub } = client([
    {
      status: 201,
      body: {
        id: "st-1",
        token: "xgs_secret",
        expiresAt: "2026-08-22T14:46:38.208Z",
        workspaceId: "ws-1",
        role: "member",
        live: { region: "us-east-1", realtimeEndpoint: "a3gywhain1zxdl-ats.iot.us-east-1.amazonaws.com" },
      },
    },
  ]);
  const token = await xg.auth.createSessionToken({ workspaceId: "ws-1", ttlSeconds: 900 });
  assert.deepEqual(stub.calls[0]!.body, { workspaceId: "ws-1", ttlSeconds: 900 });
  assert.equal(token.live.region, "us-east-1");
});

// ---- devices.purges -------------------------------------------------------

/** A purge row as `POST /devices/{id}/purges` answers (queued, worker not started). */
function purgeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01a0ee8e-3d96-7873-993c-ce0b06b96ae9",
    deviceId: "dev-1",
    workspaceId: "ws-1",
    organizationId: "org-1",
    scopes: ["workflows", "telemetry", "media"],
    status: "queued",
    cutoff: "2026-09-29T19:04:54.000Z",
    cursor: null,
    counts: {},
    error: null,
    requestedBy: "user-1",
    requestedAt: "2026-09-29T19:04:54.000Z",
    startedAt: null,
    finishedAt: null,
    leaseUntil: null,
    stalled: false,
    ...overrides,
  };
}

test("devices.purges.preview: GET /devices/{id}/purges/preview returns the flat body with tenancy", async () => {
  const preview = {
    workflows: { attachments: 1, runs: 2 },
    telemetry: { sessions: 1, readingsFrom: "2026-09-26T18:04:35.743Z", readingsTo: "2026-09-29T18:04:03.743Z" },
    media: { sessions: 1 },
  };
  const { xg, stub } = client([{ body: preview }]);
  assert.deepEqual(await xg.devices.purges.preview("dev 1"), preview);
  assert.equal(stub.calls[0]!.method, "GET");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/devices/dev%201/purges/preview");
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");
  assert.equal(stub.calls[0]!.body, undefined);
});

test("devices.purges.create: POST { scopes } to /devices/{id}/purges, unwraps the 202 purge", async () => {
  const { xg, stub } = client([{ status: 202, body: { purge: purgeRow({ scopes: ["media", "telemetry"] }) } }]);
  const purge = await xg.devices.purges.create("dev-1", { scopes: ["media", "telemetry"] });
  assert.equal(purge.status, "queued");
  assert.deepEqual(purge.scopes, ["media", "telemetry"]);
  assert.deepEqual(purge.counts, {});
  assert.equal(purge.stalled, false);
  assert.equal(stub.calls[0]!.method, "POST");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/devices/dev-1/purges");
  assert.deepEqual(stub.calls[0]!.body, { scopes: ["media", "telemetry"] });
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");
});

test("devices.purges.create: a 409 PURGE_IN_PROGRESS surfaces its code and details.purgeId", async () => {
  const { xg } = client([
    {
      status: 409,
      body: {
        error: {
          code: "PURGE_IN_PROGRESS",
          message: "A purge for this device is already in progress.",
          details: { purgeId: "p-live" },
        },
      },
    },
  ]);
  await assert.rejects(
    xg.devices.purges.create("dev-1", { scopes: ["workflows"] }),
    (e: unknown) =>
      isXorgateError(e) &&
      e.code === "PURGE_IN_PROGRESS" &&
      e.status === 409 &&
      e.details?.purgeId === "p-live" &&
      e.retryable === false,
  );
});

test("devices.purges.list: GET /devices/{id}/purges?limit=N unwraps the array, and omits limit by default", async () => {
  const rows = [purgeRow({ id: "p-2", status: "succeeded" }), purgeRow({ id: "p-1", status: "failed", error: "abandoned" })];
  const { xg, stub } = client([{ body: { purges: rows } }, { body: { purges: [] } }]);
  assert.deepEqual(await xg.devices.purges.list("dev-1", { limit: 5 }), rows);
  const first = new URL(stub.calls[0]!.url);
  assert.equal(stub.calls[0]!.method, "GET");
  assert.equal(first.pathname, "/v1/devices/dev-1/purges");
  assert.equal(first.searchParams.get("limit"), "5");
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");

  assert.deepEqual(await xg.devices.purges.list("dev-1"), []);
  assert.equal(new URL(stub.calls[1]!.url).search, "");
});

test("devices.purges.get: GET /devices/{id}/purges/{purgeId} unwraps the purge with counts and cursor", async () => {
  const done = purgeRow({
    id: "p-1",
    status: "succeeded",
    cursor: { step: "done" },
    counts: {
      attachments: 1,
      runs: 2,
      runObjects: 2,
      telemetrySessions: 1,
      telemetryObjects: 3,
      ingestLogRows: 2,
      readings: 4985,
      mediaSessions: 1,
      mediaObjects: 0,
    },
    startedAt: "2026-09-29T19:04:55.000Z",
    finishedAt: "2026-09-29T19:04:59.000Z",
  });
  const { xg, stub } = client([{ body: { purge: done } }]);
  const purge = await xg.devices.purges.get("dev-1", "p/1");
  assert.deepEqual(purge, done);
  assert.equal(purge.cursor?.step, "done");
  assert.equal(purge.counts.readings, 4985);
  assert.equal(stub.calls[0]!.method, "GET");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/devices/dev-1/purges/p%2F1");
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");
});

// ---- devices.simulations ---------------------------------------------------

function simulationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: "dev-1",
    scenarioId: "city-2026-09-27",
    desiredState: "running",
    startRequestedAt: null,
    hostId: null,
    hostState: "pending",
    hostMessage: null,
    hostReportedAt: null,
    createdBy: "user-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

test("devices.simulations.create: POST /device-simulations, normalizes the device and returns the simulation", async () => {
  const { xg, stub } = client([
    {
      status: 201,
      body: {
        device: deviceRow({ serial: "SIM-0a1b2c3d", simulated: true }),
        simulation: simulationRow({ scenarioId: "parked-2026-09-17" }),
      },
    },
  ]);
  const created = await xg.devices.simulations.create({ workspaceId: "ws-1", scenarioId: "parked-2026-09-17" });
  assert.equal(created.device.simulated, true);
  assert.equal(created.device.serial, "SIM-0a1b2c3d");
  assert.equal(created.simulation.scenarioId, "parked-2026-09-17");
  assert.equal(created.simulation.hostState, "pending");
  assert.equal(stub.calls[0]!.method, "POST");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/device-simulations");
  assert.deepEqual(stub.calls[0]!.body, { workspaceId: "ws-1", scenarioId: "parked-2026-09-17" });
  assert.equal(stub.calls[0]!.headers["x-organization-id"], "org-1");
});

test("devices.simulations.create: a 409 SIMULATION_QUOTA_EXCEEDED surfaces its scope", async () => {
  const { xg } = client([
    {
      status: 409,
      body: {
        error: {
          code: "SIMULATION_QUOTA_EXCEEDED",
          message: "limit",
          details: { scope: "organization", limit: 2, count: 2 },
        },
      },
    },
  ]);
  await assert.rejects(
    xg.devices.simulations.create({ workspaceId: "ws-1" }),
    (e: unknown) =>
      isXorgateError(e) && e.code === "SIMULATION_QUOTA_EXCEEDED" && e.status === 409 && e.details?.scope === "organization",
  );
});

test("devices.simulations.get/start: GET and POST under /device-simulations/{id}", async () => {
  const running = simulationRow({ hostId: "homelab-dev", hostState: "running", hostMessage: "connected" });
  const started = simulationRow({ startRequestedAt: "2026-10-01T01:00:00.000Z" });
  const { xg, stub } = client([{ body: { simulation: running } }, { body: { simulation: started } }]);
  assert.deepEqual(await xg.devices.simulations.get("dev 1"), running);
  assert.equal(stub.calls[0]!.method, "GET");
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/device-simulations/dev%201");

  assert.deepEqual(await xg.devices.simulations.start("dev-1"), started);
  assert.equal(stub.calls[1]!.method, "POST");
  assert.equal(new URL(stub.calls[1]!.url).pathname, "/v1/device-simulations/dev-1/start");
});

test("devices.simulations.scenarios.list: GET /device-simulations/scenarios returns the flat catalog", async () => {
  const catalog = {
    assetsVersion: "v1",
    defaultScenarioId: "city-2026-09-27",
    scenarios: [
      {
        id: "city-2026-09-27",
        title: "City drive with stops",
        description: null,
        durationMs: 940000,
        distanceM: 7890,
        maxKph: 108.9,
        streams: [{ streamKey: "cam0", width: 1280, height: 720, fps: 15 }],
        thumbnailUrl: "https://s3.example/thumb.jpg?sig",
      },
    ],
  };
  const { xg, stub } = client([{ body: catalog }]);
  assert.deepEqual(await xg.devices.simulations.scenarios.list(), catalog);
  assert.equal(new URL(stub.calls[0]!.url).pathname, "/v1/device-simulations/scenarios");
});

test("devices.list({ simulated }) sends the filter as a string, and Device.simulated defaults to false", async () => {
  const { xg, stub } = client([
    { body: { devices: [deviceRow({ simulated: true })], page: { limit: 50, offset: 0, order: "desc", total: 1 } } },
    { body: { devices: [deviceRow()], page: { limit: 50, offset: 0, order: "desc", total: 1 } } },
  ]);
  const sims = await xg.devices.list({ simulated: true });
  assert.equal(new URL(stub.calls[0]!.url).searchParams.get("simulated"), "true");
  assert.equal(sims.items[0]!.simulated, true);

  const all = await xg.devices.list();
  assert.equal(new URL(stub.calls[1]!.url).searchParams.has("simulated"), false);
  // A backend that predates simulations sends no flag: every device is real.
  assert.equal(all.items[0]!.simulated, false);
});
