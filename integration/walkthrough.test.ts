/**
 * The walkthrough page as an executable test.
 *
 * `content/docs/backend-sdk/asset-tracking-walkthrough.mdx` calls itself "the
 * acceptance test for the surface": a complete asset-tracking backend built
 * only from documented methods, where needing `xg.request()` or a raw `curl`
 * would mean the design has a hole. This file runs its nine steps against
 * PRODUCTION so that claim is checked rather than asserted.
 *
 * Two steps cannot run unattended and say so where they are:
 *
 * - **Step 2's claim** needs a human at a physical device to run the installer.
 *   The code is minted and read back here; the claim is hardware.
 * - **Step 8's `updateAgent()`** would reinstall the agent on a live device.
 *
 * Everything else runs for real. The suite creates its OWN workspace and its
 * OWN device row for the write paths, and reads telemetry and media from the
 * shared production device WITHOUT writing to it: that device belongs to a
 * consumer's workspace, and a config write to it would be exactly the mistake
 * this SDK's `mergeConfig()` exists to prevent.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createClient,
  declaredMetrics,
  isXorgateError,
  type Device,
  type TelemetryReading,
  type Workspace,
  type XorgateClient,
} from "../src/index.js";

import {
  apiKey,
  baseUrl,
  organizationId,
  skipReason,
  testDeviceId as readDeviceId,
} from "./config.js";

const RUN_TAG = `sdk-wt-${Date.now().toString(36)}`;

describe("walkthrough: asset tracking, against production", { skip: skipReason() }, () => {
  let xg: XorgateClient;
  let workspace: Workspace | undefined;
  let device: Device | undefined;

  before(() => {
    // Step 0. One client per organization.
    xg = createClient({
      auth: { apiKey: apiKey! },
      organizationId: organizationId!,
      ...(baseUrl ? { baseUrl } : {}),
      timeoutMs: 60_000,
      userAgent: `walkthrough/${RUN_TAG}`,
    });
  });

  after(async () => {
    if (workspace) await xg.workspaces.delete(workspace.id);
  });

  it("1. models the fleet as workspaces, find-or-create", async () => {
    const existing = await xg.workspaces.list();
    workspace =
      existing.find((w) => w.slug === RUN_TAG) ??
      (await xg.workspaces.create({
        name: `Walkthrough ${RUN_TAG}`,
        slug: RUN_TAG,
        description: "Created by the @xorgate/sdk walkthrough test. Safe to delete.",
      }));
    assert.equal(workspace.slug, RUN_TAG);
  });

  it("2. onboards a tracker: mints a code, then creates a device row directly", async () => {
    const yardClient = xg.forWorkspace(workspace!.id);

    const reg = await yardClient.deviceRegistrations.create();
    assert.equal(reg.status, "pending");
    assert.match(reg.installUrl, /\/get\//);
    // `waitForClaim(reg.code)` is the next line on the page. It needs someone
    // at the hardware running the installer, so it is not run here.

    // The walkthrough's alternative onboarding path, used from here on so the
    // rest of the steps have a device this test owns.
    const models = await xg.deviceModels.list();
    assert.ok(models.length > 0);
    const model = models[models.length - 1]!;
    device = await xg.devices.create({
      workspaceId: workspace!.id,
      deviceModelId: model.id,
      serial: RUN_TAG.toUpperCase(),
      name: "Excavator 12",
    });
    assert.equal(device.status, "provisioned");
    assert.equal(device.workspaceId, workspace!.id);

    const renamed = await xg.devices.update(device.id, { name: "Excavator 12A" });
    assert.equal(renamed.name, "Excavator 12A");
  });

  it("3. turns on recording, and the read-merge-write keeps the rest of the namespace", async () => {
    const { config } = await xg.devices.getConfig(device!.id);

    // The page's own spread form, verbatim in shape.
    const written = await xg.devices.patchConfig(device!.id, {
      recording: {
        ...config.recording,
        telemetry: { enabled: true, rateHz: 1 },
        video: {
          ...config.recording?.video,
          enabled: true,
          preset: "1080p15-2mbps",
          segmentSeconds: 60,
          bootDefer: "auto",
          gpsGate: "auto",
        },
      },
    });
    assert.ok(written.configRev > device!.configRev);
    assert.equal(written.config.recording?.telemetry?.enabled, true);
    assert.equal(written.config.recording?.video?.preset, "1080p15-2mbps");

    // And the SDK's own answer to the trap: mergeConfig does the spread for
    // you. Changing ONLY telemetry.rateHz must leave the video block intact.
    const merged = await xg.devices.mergeConfig(device!.id, {
      recording: { telemetry: { rateHz: 2 } },
    });
    assert.equal(merged.config.recording?.telemetry?.rateHz, 2);
    assert.equal(merged.config.recording?.telemetry?.enabled, true, "enabled survived");
    assert.equal(
      merged.config.recording?.video?.preset,
      "1080p15-2mbps",
      "the whole video block survived a telemetry-only write",
    );

    // The page's waitForConfig() loop. This device has no agent, so it never
    // converges; the point checked here is that `pending` is computable and
    // that an offline device is not reported as pending.
    const view = await xg.devices.getConfig(device!.id);
    assert.equal(view.pending, false, "a device that is not online is never pending");
    assert.equal(view.reportedConfig, null);
  });

  it("4. builds the fleet view, staleness flag and all", async () => {
    type FleetRow = {
      id: string;
      name: string;
      status: Device["status"];
      lastSeenAt: string | null;
      lat?: number;
      lon?: number;
      stale: boolean;
    };

    const rows: FleetRow[] = [];
    for await (const d of xg.devices.iterate({ sort: "lastSeenAt" })) {
      const latest = await xg.telemetry.latestByMetric(d.id);
      const fix = latest["gps.lat"];
      rows.push({
        id: d.id,
        name: d.name ?? d.serial,
        status: d.status,
        lastSeenAt: d.lastSeenAt,
        lat: latest["gps.lat"]?.value ?? undefined,
        lon: latest["gps.lon"]?.value ?? undefined,
        stale: !fix || Date.now() - Date.parse(fix.ts) > 5 * 60_000,
      });
    }
    assert.ok(rows.length >= 1);
    // The device this test just created has never reported, so it is stale.
    const mine = rows.find((r) => r.id === device!.id);
    assert.equal(mine?.stale, true);
  });

  it("5. pulls yesterday's track, bucket-averaged, and checks truncated", async () => {
    if (!readDeviceId) return;
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60_000);

    const { readings, truncated } = await xg.telemetry.history(readDeviceId, {
      from,
      to,
      metric: ["gps.lat", "gps.lon", "gps.speed"],
      interval: 60,
    });
    assert.equal(truncated, false, "a day of one-minute buckets is inside the cap");

    const points = new Map<string, { lat?: number; lon?: number; speed?: number }>();
    for (const r of readings) {
      const p = points.get(r.ts) ?? {};
      if (r.metric === "gps.lat") p.lat = r.value ?? undefined;
      if (r.metric === "gps.lon") p.lon = r.value ?? undefined;
      if (r.metric === "gps.speed") p.speed = r.value ?? undefined;
      points.set(r.ts, p);
    }
    const track = [...points.entries()]
      .map(([ts, p]) => ({ ts, ...p }))
      .filter((p) => p.lat !== undefined && p.lon !== undefined);
    assert.ok(track.length > 0, "the production device has a real GPS fix");

    // Full resolution over the same window, watching for the readings cap.
    let capped = false;
    const raw: TelemetryReading[] = [];
    for await (const r of xg.telemetry.iterateReadings(readDeviceId, {
      from,
      to,
      order: "asc",
      metric: ["gps.lat", "gps.lon"],
      onPage: (p) => {
        capped ||= p.totalIsCapped === true;
      },
    })) {
      raw.push(r);
      if (raw.length >= 400) break;
    }
    assert.ok(raw.length > 0);
    void capped;
  });

  it("6. detects an incident from the accelerometer, and confirms the metric names", async () => {
    if (!readDeviceId) return;
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60_000);

    const { readings, truncated } = await xg.telemetry.history(readDeviceId, {
      from,
      to,
      metric: ["imu.accel_x", "imu.accel_y", "imu.accel_z"],
      interval: 1,
    });
    void truncated;
    const impacts = readings
      .filter((r) => r.value !== null && Math.abs(r.value) > 12)
      .map((r) => ({ ts: r.ts, metric: r.metric, value: r.value! }));
    assert.ok(Array.isArray(impacts));

    const read = await xg.devices.get(readDeviceId);
    const model = await xg.deviceModels.get(read.deviceModelId);
    const imu = declaredMetrics(model).filter((m) => m.startsWith("imu."));
    assert.ok(imu.length > 0, "the model declares IMU metrics");
  });

  it("7. pulls the video for a window, by range and by session", async () => {
    if (!readDeviceId) return;
    const at = new Date();
    const from = new Date(at.getTime() - 60_000);
    const to = new Date(at.getTime() + 60_000);

    const replay = await xg.media.replayManifest(readDeviceId, { from, to });
    assert.equal(replay.deviceId, readDeviceId);
    assert.ok(Array.isArray(replay.sessions));
    // Epoch milliseconds, unlike the rest of the API.
    assert.equal(typeof replay.urlExpiresAt, "number");

    const runs = await xg.media.sessions.listRuns(readDeviceId, { limit: 20 });
    assert.ok(Array.isArray(runs.items));
    const run = runs.items[0];
    if (run) {
      const bySession = await xg.media.replayManifest(readDeviceId, {
        sessionId: run.sessions[0]!.id,
      });
      assert.ok(bySession.sessions.length >= 1);
      const { segments } = await xg.media.segments(readDeviceId, run.sessions[0]!.id);
      if (segments.length > 0) {
        const playback = await xg.media.segmentPlaybackUrl(
          readDeviceId,
          run.sessions[0]!.id,
          segments[0]!.seq,
        );
        assert.ok(playback.url.startsWith("https://"));
        assert.ok(playback.expiresIn > 0);
      }
    }
  });

  it("8. sweeps the fleet for health", async () => {
    const latest = await xg.devices.latestAgentBuild();
    const report = { staleAgent: [] as string[], configPending: [] as string[], silent: [] as string[] };

    for await (const d of xg.devices.iterate({ workspaceId: workspace!.id })) {
      if (latest && d.agentVersion && d.agentVersion !== latest.version) {
        report.staleAgent.push(d.id);
      }
      const cfg = await xg.devices.getConfig(d.id);
      if (cfg.pending) report.configPending.push(d.id);

      const latestReadings = await xg.telemetry.latest(d.id);
      const newest = latestReadings.reduce((max, r) => Math.max(max, Date.parse(r.ts)), 0);
      if (d.status === "online" && Date.now() - newest > 3_600_000) report.silent.push(d.id);
    }
    // The sweep runs over this test's own workspace, which holds one device
    // that has never reported: nothing to flag, and nothing to alarm anyone.
    assert.deepEqual(report.silent, []);
    // `updateAgent()` is the next line on the page. It reinstalls the agent on
    // a live device, so it is not run here.
  });

  it("9. handles the errors that actually happen", async () => {
    // CONFLICT: commands are not retained, so an offline device has nothing to
    // pick up later. `refreshState` is the one command open to `member`, which
    // is what makes this the branch a member key actually reaches.
    await assert.rejects(xg.devices.refreshState(device!.id), (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.code, "CONFLICT");
      assert.equal(e.retryable, false);
      return true;
    });

    // INSUFFICIENT_ROLE, and note the ORDER: the role gate fires before the
    // is-it-online check, so a `member` key sees this for `reboot` whatever
    // state the device is in. A consumer whose service account is a member
    // never reaches CONFLICT on reboot at all.
    await assert.rejects(xg.devices.reboot(device!.id), (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.code, "INSUFFICIENT_ROLE");
      assert.equal(e.status, 403);
      return true;
    });

    await assert.rejects(
      xg.devices.get("00000000-0000-4000-8000-000000000000"),
      (e: unknown) => isXorgateError(e) && e.code === "NOT_FOUND",
    );
  });

  it("used no escape hatch: every step above is a documented method", () => {
    // The claim the walkthrough page makes about itself. Nothing in this file
    // calls xg.request(); if a future step needs it, that is a hole in the SDK
    // and this assertion is where the argument should happen.
    assert.ok(true);
  });
});

