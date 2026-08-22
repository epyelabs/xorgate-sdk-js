/**
 * The integration suite. It runs against PRODUCTION, which is the environment a
 * real consumer uses, and that fact sets every rule below.
 *
 * Credentials come from a gitignored `.env` (see `.env.example`) or the
 * environment. The key is `xorgate/integration-test-api-key` in AWS Secrets
 * Manager, account 865609249890: the suite's OWN key, deliberately not the one
 * Alocate's backend runs on, so revoking either costs the other nothing.
 *
 *   npm run test:integration
 *
 * THE RULES, in order of how much damage breaking them does:
 *
 * 1. **The suite creates and destroys its own workspace, every run.** It never
 *    writes to a workspace it did not create, and it never deletes one it did
 *    not create. Deleting a workspace cascades to its devices, their media and
 *    their telemetry, so a wrong id here is not recoverable.
 * 2. **Reads against a shared device are read-only.** `XORGATE_TEST_DEVICE_ID`
 *    names a real device with real telemetry. Nothing here writes to it, sends
 *    it a command, or touches its config.
 * 3. **No test may assume a fast first request.** The production Aurora cluster
 *    auto-pauses at 0 ACU after 30 idle minutes, so the first call of a run can
 *    take seconds while it resumes. `timeoutMs` is never set below 3000.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createClient,
  declaredMetrics,
  isXorgateError,
  validateIoCapabilities,
  type Workspace,
  type XorgateClient,
} from "../src/index.js";

import {
  apiKey,
  baseUrl,
  deviceSkipReason,
  organizationId,
  skipReason,
  testDeviceId,
} from "./config.js";

/** Names the suite's own rows unmistakably, so a leaked one is obvious. */
const RUN_TAG = `sdk-it-${Date.now().toString(36)}`;

describe("integration: @xorgate/sdk against production", { skip: skipReason() }, () => {
  let xg: XorgateClient;
  let workspace: Workspace | undefined;

  before(async () => {
    xg = createClient({
      auth: { apiKey: apiKey! },
      organizationId: organizationId!,
      ...(baseUrl ? { baseUrl } : {}),
      // Generous on purpose: the first call may be waiting for a paused
      // database to resume. Never lower this to "fail fast".
      timeoutMs: 60_000,
      userAgent: `integration-suite/${RUN_TAG}`,
    });
  });

  after(async () => {
    // The one destructive call in the suite, and it only ever names a workspace
    // this run created.
    if (workspace) await xg.workspaces.delete(workspace.id);
  });

  it("authenticates an xg_ key on Authorization: Bearer", async () => {
    const workspaces = await xg.workspaces.list();
    assert.ok(Array.isArray(workspaces));
  });

  it("refuses a bad key with a code, not just a 401", async () => {
    const bogus = createClient({
      auth: { apiKey: "xg_thisisnotarealkey000000000000" },
      organizationId: organizationId!,
      ...(baseUrl ? { baseUrl } : {}),
      timeoutMs: 30_000,
    });
    await assert.rejects(bogus.workspaces.list(), (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.status, 401);
      assert.equal(e.code, "INVALID_API_KEY");
      return true;
    });
  });

  it("refuses a key on the person-scoped endpoints", async () => {
    await assert.rejects(xg.me(), (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.code, "USER_CREDENTIAL_REQUIRED");
      return true;
    });
  });

  it("creates its own workspace, reads it back, and updates it", async () => {
    workspace = await xg.workspaces.create({
      name: `SDK integration ${RUN_TAG}`,
      slug: RUN_TAG,
      description: "Created by the @xorgate/sdk integration suite. Safe to delete.",
    });
    assert.equal(workspace.slug, RUN_TAG);
    assert.equal(workspace.organizationId, organizationId);

    const read = await xg.workspaces.get(workspace.id);
    assert.equal(read.id, workspace.id);

    const updated = await xg.workspaces.update(workspace.id, { description: null });
    assert.equal(updated.description, null);

    const listed = await xg.workspaces.list();
    assert.ok(listed.some((w) => w.id === workspace!.id));
  });

  it("mints a session token scoped to that workspace, and it is enforced", async () => {
    assert.ok(workspace, "the workspace test must run first");
    const token = await xg.auth.createSessionToken({
      workspaceId: workspace!.id,
      ttlSeconds: 60,
    });
    assert.match(token.token, /^xgs_/);
    assert.equal(token.workspaceId, workspace!.id);
    assert.ok(token.live.realtimeEndpoint.length > 0);
    assert.ok(token.live.region.length > 0);

    // A scoped token sees only its own workspace. The refusal for a sibling is
    // 404, not 403: a scoped credential is told the row does not exist rather
    // than that it may not have it.
    const scoped = createClient({
      auth: { apiKey: token.token },
      organizationId: organizationId!,
      ...(baseUrl ? { baseUrl } : {}),
      timeoutMs: 30_000,
    });
    const visible = await scoped.workspaces.list();
    assert.deepEqual(
      visible.map((w) => w.id),
      [workspace!.id],
    );

    // Organization-wide operations are closed to it at any role.
    await assert.rejects(scoped.apiKeys.list(), (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.code, "WORKSPACE_SCOPED");
      return true;
    });
  });

  it("mints a registration code for its own workspace, idempotently", async () => {
    assert.ok(workspace, "the workspace test must run first");
    const scoped = xg.forWorkspace(workspace!.id);
    const first = await scoped.deviceRegistrations.create();
    assert.match(first.installUrl, /\/get\//);
    assert.equal(first.status, "pending");

    // Idempotent per workspace: a pending, un-expired code comes back rather
    // than a new one being minted.
    const second = await scoped.deviceRegistrations.create();
    assert.equal(second.code, first.code);

    const read = await xg.deviceRegistrations.get(first.code);
    assert.equal(read.code, first.code);
  });

  it("lists the platform device-model catalog", async () => {
    const models = await xg.deviceModels.list();
    assert.ok(models.length > 0, "production has at least one device model");
    for (const model of models) {
      if (model.ioCapabilities === null) continue;
      const result = validateIoCapabilities(model.ioCapabilities);
      assert.ok(
        result.valid,
        `${model.sku} would provision zero video channels: ${JSON.stringify(result.issues)}`,
      );
    }
  });

  it("refuses a device-model write, because a key is never a platform admin", async () => {
    await assert.rejects(
      xg.deviceModels.create({
        name: `should never exist ${RUN_TAG}`,
        sku: `SHOULD-NEVER-EXIST-${RUN_TAG}`,
      }),
      (e: unknown) => {
        assert.ok(isXorgateError(e));
        assert.equal(e.status, 403);
        return true;
      },
    );
  });

  it("pages the device list and iterates it", async () => {
    const page = await xg.devices.list({ limit: 1 });
    assert.ok(page.page.total >= 0);
    assert.ok(page.items.length <= 1);

    let count = 0;
    for await (const _ of xg.devices.iterate({ pageSize: 1 })) {
      void _;
      if (++count >= 3) break;
    }
    assert.ok(count >= 0);
  });

  it("filters devices by a workspace with none, and gets an empty page not an error", async () => {
    assert.ok(workspace, "the workspace test must run first");
    const page = await xg.devices.list({ workspaceId: workspace!.id });
    assert.deepEqual(page.items, []);
    assert.equal(page.page.total, 0);
  });

  it("answers 404 for a device that does not exist", async () => {
    await assert.rejects(
      xg.devices.get("00000000-0000-4000-8000-000000000000"),
      (e: unknown) => {
        assert.ok(isXorgateError(e));
        assert.equal(e.code, "NOT_FOUND");
        return true;
      },
    );
  });

  it("reads the fleet-wide latest agent build, or null", async () => {
    const latest = await xg.devices.latestAgentBuild();
    if (latest !== null) assert.ok(latest.version.length > 0);
  });

  describe("read-only, against the shared production device", { skip: deviceSkipReason() }, () => {
    it("reads the device and its config view without writing anything", async () => {
      const device = await xg.devices.get(testDeviceId!);
      assert.equal(device.id, testDeviceId);
      const config = await xg.devices.getConfig(testDeviceId!);
      assert.equal(config.configRev, device.configRev);
      assert.equal(typeof config.pending, "boolean");
      // The deprecated top-level duplicates are gone from the SDK's shape.
      assert.equal((device as unknown as Record<string, unknown>)["firmwareVersion"], undefined);
    });

    it("reads latest telemetry, keyed both ways", async () => {
      const rows = await xg.telemetry.latest(testDeviceId!);
      assert.ok(rows.length > 0, "the test device has reported telemetry");
      const byMetric = await xg.telemetry.latestByMetric(testDeviceId!);
      assert.equal(Object.keys(byMetric).length, rows.length);
      for (const row of rows) assert.equal(byMetric[row.metric]!.value, row.value);
    });

    it("reads recent telemetry and reports truncation honestly", async () => {
      const recent = await xg.telemetry.recent(testDeviceId!, { limit: 10 });
      assert.equal(recent.bucketSeconds, null);
      assert.equal(typeof recent.truncated, "boolean");
      assert.ok(recent.readings.length <= 10);
    });

    it("rejects an out-of-range recent limit rather than clamping it", async () => {
      await assert.rejects(
        xg.telemetry.recent(testDeviceId!, { limit: 99_999 }),
        (e: unknown) => {
          assert.ok(isXorgateError(e));
          assert.equal(e.code, "BAD_REQUEST");
          return true;
        },
      );
    });

    it("reads a history window and echoes bucketSeconds", async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 60 * 60_000);
      const history = await xg.telemetry.history(testDeviceId!, {
        from,
        to,
        interval: 60,
      });
      assert.equal(history.bucketSeconds, 60);
      assert.equal(typeof history.truncated, "boolean");
    });

    it("refuses a history range longer than 31 days", async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 40 * 24 * 60 * 60_000);
      await assert.rejects(
        xg.telemetry.history(testDeviceId!, { from, to }),
        (e: unknown) => isXorgateError(e) && e.code === "BAD_REQUEST",
      );
    });

    it("reads the paginated readings table, positional rows and all", async () => {
      const page = await xg.telemetry.readings(testDeviceId!, { limit: 5 });
      assert.ok(["request", "model", "data"].includes(page.columnSource));
      for (const row of page.rows) {
        assert.equal(row.v.length, page.columns.length, "v is positional and dense");
      }
    });

    it("reads the same rows flat, and iterates them", async () => {
      const flat = await xg.telemetry.readingsFlat(testDeviceId!, { limit: 5 });
      assert.ok(flat.items.length <= 5 * 60);

      let seen = 0;
      let sawPage = false;
      for await (const _ of xg.telemetry.iterateReadings(testDeviceId!, {
        limit: 5,
        onPage: () => {
          sawPage = true;
        },
      })) {
        void _;
        if (++seen >= 10) break;
      }
      assert.equal(sawPage, true);
    });

    it("lists media sessions and runs without creating any", async () => {
      const sessions = await xg.media.sessions.list(testDeviceId!, { limit: 5 });
      assert.ok(Array.isArray(sessions.items));
      const runs = await xg.media.sessions.listRuns(testDeviceId!, { limit: 5 });
      assert.ok(Array.isArray(runs.items));
    });

    it("reads the device's video channels and its IoT identity", async () => {
      const channels = await xg.devices.videoChannels(testDeviceId!);
      assert.ok(Array.isArray(channels));
      for (const channel of channels) {
        assert.ok(channel.channelRef.length > 0);
        assert.ok(channel.streamKey.length > 0);
      }
      const identity = await xg.devices.identity(testDeviceId!);
      if (identity !== null) assert.equal(identity.iotThingName, testDeviceId);
    });

    it("finds the device through search", async () => {
      const device = await xg.devices.get(testDeviceId!);
      const hits = await xg.search(device.serial);
      assert.ok(hits.some((h) => h.type === "device" && h.id === testDeviceId));
    });

    it("derives the device's declared metrics from its model", async () => {
      const device = await xg.devices.get(testDeviceId!);
      const model = await xg.deviceModels.get(device.deviceModelId);
      const declared = declaredMetrics(model);
      const reported = (await xg.telemetry.latest(testDeviceId!)).map((r) => r.metric);
      assert.ok(declared.length > 0, "the model declares metrics");
      assert.ok(
        declared.some((m) => reported.includes(m)),
        "at least one declared metric has actually been reported",
      );
    });
  });
});

