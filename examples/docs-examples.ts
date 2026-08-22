/**
 * Every runnable example from the Backend SDK docs pages, compiled against the
 * REAL package rather than against a `.d.ts` sketch.
 *
 * This started life as `examples.ts` in `xorgate/plans/done/xorgate-sdk-and-api/`,
 * where it was checked against `interface.d.ts`. Phase 1 of
 * `plans/sdk-packages-and-alocate-pilot/` moved it here and pointed its import at
 * `@xorgate/sdk`, which is the stronger check: the design sketch could agree with
 * a doc page while both disagreed with the shipped code.
 *
 *   npm run check:examples
 *
 * When you change a doc example, change it here too. When they disagree, the
 * docs are wrong, because this file is the one a compiler reads.
 */
import {
  createClient,
  createBootstrapClient,
  isXorgateError,
  validateIoCapabilities,
  parseIoCapabilities,
  videoStreamKeys,
  declaredMetrics,
  type Device,
  type DeviceModel,
  type IoCapabilities,
  type MetricName,
  type ReplayManifest,
  type TelemetryReading,
} from "@xorgate/sdk";

declare const session: { idToken: string };
declare const auth: {
  currentSession(): Promise<{ getIdToken(): string }>;
};
declare const secrets: { put(k: string, v: string): Promise<void> };
declare const logger: { error(ctx: unknown, msg: string): void };
declare const pastedJson: string;
declare const deviceId: string;
declare const sessionId: string;
declare const orgId: string;
declare const otherId: string;
declare const yardId: string;
declare const otherWorkspaceId: string;
declare const from: Date;
declare const to: Date;
declare const now: Date;
declare const yesterday: Date;
declare const dayStart: Date;
declare const dayEnd: Date;
declare const report: {
  staleAgent: string[];
  configPending: string[];
  silent: string[];
};

const xg = createClient({
  auth: { getToken: () => session.idToken },
  organizationId: process.env.XORGATE_ORG_ID!,
});

// ---------------------------------------------------------------------------
// index.mdx
// ---------------------------------------------------------------------------

export async function overview() {
  const client = createClient({
    auth: { apiKey: process.env.XORGATE_API_KEY! },
    organizationId: process.env.XORGATE_ORG_ID!,
  });

  const page = await client.devices.list({ status: "online" });
  console.log(page.items.length, "of", page.page.total, "online");
}

// ---------------------------------------------------------------------------
// installation.mdx
// ---------------------------------------------------------------------------

export function construction() {
  return createClient({
    auth: { apiKey: process.env.XORGATE_API_KEY! },
    organizationId: process.env.XORGATE_ORG_ID!,
    workspaceId: process.env.XORGATE_WORKSPACE_ID,
  });
}

export async function bootstrap() {
  const boot = createBootstrapClient({
    auth: { getToken: () => session.idToken },
  });

  const me = await boot.me();

  const org =
    me.organizations[0] ??
    (await boot.createOrganization({ name: "Acme Fleet", slug: "acme-fleet" }));

  return boot.forOrganization(org.id);
}

export async function derivedClients() {
  const other = xg.forOrganization("6b3c...");
  const yard = xg.forWorkspace("9f21...");
  const devices = await yard.devices.listAll();
  await xg.devices.list({ workspaceId: "9f21..." });
  return { other, devices };
}

export async function cancellation() {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 5_000);

  return xg.telemetry.history(deviceId, {
    from: "2026-08-09T00:00:00Z",
    to: "2026-08-10T00:00:00Z",
    signal: ac.signal,
  });
}

export async function escapeHatch() {
  return xg.request<{ device_models: unknown[] }>("GET", "/device-models");
}

// ---------------------------------------------------------------------------
// authentication.mdx
// ---------------------------------------------------------------------------

export function apiKeyClient() {
  return createClient({
    auth: { apiKey: process.env.XORGATE_API_KEY! },
    organizationId: process.env.XORGATE_ORG_ID!,
  });
}

export function cognitoClient() {
  return createClient({
    auth: { getToken: async () => (await auth.currentSession()).getIdToken() },
    organizationId: orgId,
  });
}

// ---------------------------------------------------------------------------
// pagination.mdx
// ---------------------------------------------------------------------------

export async function threeWays() {
  const page = await xg.devices.list({ status: "online", limit: 50 });
  page.items;
  page.page;

  const workspaces = await xg.workspaces.list();

  for await (const device of xg.devices.iterate({ status: "online" })) {
    console.log(device.serial);
  }

  const all = await xg.devices.listAll({ status: "online" });
  return { workspaces, all };
}

export async function observingPages() {
  let capped = false;

  const track: TelemetryReading[] = [];
  for await (const reading of xg.telemetry.iterateReadings(deviceId, {
    from: yesterday,
    to: now,
    metric: ["gps.lat", "gps.lon"],
    onPage: (page) => {
      capped ||= page.totalIsCapped === true;
    },
  })) {
    track.push(reading);
  }

  if (capped) {
    // Narrow the window and run again.
  }
  return track;
}

export function pageSize() {
  return xg.devices.iterate({ pageSize: 500 });
}

// ---------------------------------------------------------------------------
// errors.mdx
// ---------------------------------------------------------------------------

export async function catching() {
  try {
    await xg.devices.reboot(deviceId);
  } catch (e) {
    if (!isXorgateError(e)) throw e;

    if (e.code === "CONFLICT") {
      // Device offline.
    } else if (e.code === "INSUFFICIENT_ROLE") {
      // Needs owner or admin.
    } else {
      throw e;
    }
  }
}

export async function configPublishFailed() {
  try {
    await xg.devices.patchConfig(deviceId, {
      recording: { video: { enabled: true } },
    });
  } catch (e) {
    if (isXorgateError(e) && e.code === "CONFIG_PUBLISH_FAILED") {
      // Saved. Not delivered. Do NOT retry.
    } else {
      throw e;
    }
  }
}

export function retryClient() {
  return createClient({
    auth: { getToken: () => session.idToken },
    organizationId: orgId,
    retry: { attempts: 2, baseDelayMs: 250, maxDelayMs: 4000 },
  });
}

export function logging(e: unknown) {
  if (!isXorgateError(e)) return;
  logger.error(
    {
      code: e.code,
      status: e.status,
      method: e.method,
      url: e.url,
      requestId: e.requestId,
      details: e.details,
    },
    e.message,
  );
}

// ---------------------------------------------------------------------------
// resources/users-and-organizations.mdx
// ---------------------------------------------------------------------------

export async function meCall() {
  const { user, memberships, organizations } = await xg.me();
  console.log(user.email, user.role);
  console.log(organizations.map((o) => o.slug));
  return memberships;
}

export async function readAnotherOrg() {
  const other = xg.forOrganization(otherId);
  return other.organizations.get(otherId);
}

export async function createOrg() {
  return xg.organizations.create({ name: "Acme Fleet", slug: "acme-fleet" });
}

export async function roster() {
  for (const m of await xg.memberships.list()) {
    console.log(m.role, m.user?.email ?? m.userId);
  }
}

export async function addMembers() {
  await xg.memberships.add({ userId: "9c2f...", role: "member" });

  const { membership, invited } = await xg.memberships.add({
    email: "new.operator@acme.co",
    role: "admin",
  });

  if (invited) {
    // A new account was created and emailed.
  }
  return membership;
}

export async function searchExample() {
  const hits = await xg.search("XG-0042");

  for (const hit of hits) {
    if (hit.type === "device") {
      const device = await xg.devices.get(hit.id);
      console.log(device.serial);
    }
  }
}

// ---------------------------------------------------------------------------
// resources/workspaces.mdx
// ---------------------------------------------------------------------------

export async function workspaceCrud() {
  const workspaces = await xg.workspaces.list();
  console.log(workspaces.map((w) => `${w.slug} (${w.id})`));

  const ws = await xg.workspaces.create({
    name: "North Yard",
    slug: "north-yard",
    description: "Temporary staging yard, phase 2",
  });

  await xg.workspaces.update(ws.id, { description: null });

  const yard = xg.forWorkspace(ws.id);
  const devices = await yard.devices.listAll();
  const reg = await yard.deviceRegistrations.create();

  await xg.devices.list({ workspaceId: otherWorkspaceId });
  await xg.deviceRegistrations.create({ workspaceId: otherWorkspaceId });

  return { devices, reg };
}

// ---------------------------------------------------------------------------
// resources/api-keys.mdx
// ---------------------------------------------------------------------------

export async function apiKeyLifecycle() {
  const { apiKey, plaintextKey } = await xg.apiKeys.create({
    name: "alocate-backend",
    scope: "cloud",
    role: "member",
    expiresAt: "2027-01-01T00:00:00Z",
  });

  await secrets.put("XORGATE_API_KEY", plaintextKey);
  console.log(apiKey.id, apiKey.role, apiKey.keyPrefix ?? "unknown", apiKey.createdAt);

  for (const key of await xg.apiKeys.list()) {
    console.log(key.name, key.role, key.scope, key.expiresAt, key.lastUsedAt);
  }

  await xg.apiKeys.delete(apiKey.id);
}

// ---------------------------------------------------------------------------
// authentication.mdx — minting session tokens for your clients
// ---------------------------------------------------------------------------

export async function mintSessionTokenForEndUser(myUserId: string) {
  // YOUR authorization decision, about YOUR user. xorgate never learns who they
  // are; it authorizes the key, and `workspaceId` is how the two decisions meet.
  const session = await xg.auth.createSessionToken({
    workspaceId: await workspaceForUser(myUserId),
    ttlSeconds: 900,
  });

  console.log(session.expiresAt, session.workspaceId, session.role);
  console.log(session.live.region, session.live.realtimeEndpoint);

  // Everything the client needs. The key stays here.
  return session;
}

export async function mintOrgScopedSessionToken() {
  // No workspace: the token sees the whole organization, exactly as the key
  // does. Right when your tenancy boundary IS the xorgate organization.
  const session = await xg.auth.createSessionToken();
  return session.token;
}

declare function workspaceForUser(userId: string): Promise<string>;

// ---------------------------------------------------------------------------
// resources/device-models.mdx
// ---------------------------------------------------------------------------

export async function deviceModelReads() {
  const models = await xg.deviceModels.list();
  return models.find((m) => m.sku === "XG-CM5-DUAL");
}

export const exampleCapabilities: IoCapabilities = {
  schemaVersion: 1,
  media: {
    video: [
      {
        key: "cam0",
        codec: "h264",
        maxWidth: 1920,
        maxHeight: 1080,
        maxFps: 30,
      },
      {
        key: "cam1",
        codec: "h264",
        maxWidth: 1920,
        maxHeight: 1080,
        maxFps: 30,
      },
    ],
  },
  sensors: {
    imu: {
      accel: ["x", "y", "z"],
      euler: ["roll", "pitch", "yaw"],
      unit: "m/s^2",
      rateHz: 10,
    },
  },
  comm: {
    module: "4g-lte",
    gps: { fields: ["lat", "lon", "alt", "speed", "course"] },
    signal: { fields: ["rssi", "rsrp", "rsrq"] },
  },
  system: { fields: ["cpu_temp", "cpu_pct", "mem_pct", "disk_pct"] },
};

export function capabilityHelpers(model: DeviceModel) {
  videoStreamKeys(model);
  declaredMetrics(model);
}

export async function validationThrows() {
  try {
    await xg.deviceModels.create({
      name: "Tracker v2",
      sku: "XG-T2",
      ioCapabilities: {
        schemaVersion: 1,
        media: { video: [{ key: "cam0" }] },
      } as IoCapabilities,
    });
  } catch (e) {
    if (isXorgateError(e) && e.code === "INVALID_INPUT") {
      console.error(e.details?.issues);
    }
  }
}

export function standaloneValidation() {
  const result = validateIoCapabilities(JSON.parse(pastedJson));
  if (!result.valid) {
    for (const issue of result.issues) {
      console.warn(`${issue.path}: ${issue.message}`);
    }
  }

  const caps = parseIoCapabilities(JSON.parse(pastedJson));
  return caps;
}

export async function auditCatalog() {
  for (const model of await xg.deviceModels.list()) {
    const result = validateIoCapabilities(model.ioCapabilities);
    if (!result.valid) {
      console.warn(`${model.sku} will provision zero KVS channels`, result.issues);
    }
  }
}

export async function skipValidation() {
  await xg.deviceModels.create(
    { name: "Tracker v2", sku: "XG-T2" },
    { validate: false },
  );
}

// ---------------------------------------------------------------------------
// resources/devices.mdx
// ---------------------------------------------------------------------------

export async function deviceListing() {
  const page = await xg.devices.list({ status: "online", sort: "lastSeenAt" });
  console.log(`${page.items.length} of ${page.page.total}`);

  for await (const device of xg.devices.iterate({ workspaceId: yardId })) {
    console.log(device.serial, device.status, device.lastSeenAt);
  }
}

export async function deviceWrites(modelId: string) {
  const device = await xg.devices.create({
    workspaceId: yardId,
    deviceModelId: modelId,
    serial: "XG-0042",
  });

  await xg.devices.update(device.id, { name: "Excavator 12" });
  return device;
}

export async function configRead() {
  const cfg = await xg.devices.getConfig(deviceId);
  cfg.config;
  cfg.configRev;
  cfg.reportedConfig;
  cfg.pending;
}

export async function configWrite() {
  const device = await xg.devices.patchConfig(deviceId, {
    recording: {
      video: { enabled: true, preset: "1080p15-2mbps", segmentSeconds: 60 },
    },
    timeSync: { offlineSources: true },
  });

  console.log(device.configRev);

  const { config } = await xg.devices.getConfig(deviceId);
  await xg.devices.patchConfig(deviceId, {
    recording: {
      ...config.recording,
      video: { ...config.recording?.video, enabled: true },
    },
  });

  await xg.devices.patchConfig(deviceId, { cellular: null });
}

export async function mergeConfigWrite() {
  // Enables telemetry recording and changes NOTHING else in `recording`.
  await xg.devices.mergeConfig(deviceId, {
    recording: { telemetry: { enabled: true } },
  });
}

export async function watchConfigLand() {
  await xg.devices.patchConfig(deviceId, { gnssAntBias: true });

  for (let i = 0; i < 20; i++) {
    const cfg = await xg.devices.getConfig(deviceId);
    if (!cfg.pending) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

export async function uiPrefs() {
  await xg.devices.patchUiPrefs(deviceId, { activeStreamsViewType: "map" });
}

export async function commands() {
  const ack = await xg.devices.reboot(deviceId);
  console.log(ack.command, ack.requestId, new Date(ack.expiresAt));
}

export async function agentBuild() {
  const latest = await xg.devices.latestAgentBuild();
  const device = await xg.devices.get(deviceId);

  const upToDate = latest !== null && device.agentVersion === latest.version;
  return upToDate;
}

export async function identityAndProvision() {
  const identity = await xg.devices.identity(deviceId);
  if (identity === null) {
    // Never provisioned.
  }

  const bundle = await xg.devices.provision(deviceId);
  bundle.iot.dataEndpoint;
  bundle.iot.credentialEndpoint;
  bundle.kvs.channels;
  bundle.mqtt.telemetryTopic;
}

// ---------------------------------------------------------------------------
// resources/device-registrations.mdx
// ---------------------------------------------------------------------------

export async function registrationFlow() {
  const reg = await xg.deviceRegistrations.create({ workspaceId: yardId });
  console.log(reg.code);
  console.log(reg.installUrl);
  console.log(reg.expiresAt);

  await xg.deviceRegistrations.get("K7QF4M2P");

  const claimed = await xg.deviceRegistrations.waitForClaim(reg.code, {
    pollIntervalMs: 3_000,
    timeoutMs: 900_000,
  });

  return xg.devices.get(claimed.deviceId!);
}

export async function fullOnboarding() {
  const reg = await xg.forWorkspace(yardId).deviceRegistrations.create();

  console.log(`Run on the device:\n  curl -sSL ${reg.installUrl} | sudo bash`);

  const claimed = await xg.deviceRegistrations.waitForClaim(reg.code);

  const device = await xg.devices.get(claimed.deviceId!);
  console.log(device.serial, device.status);

  return xg.telemetry.latest(device.id);
}

// ---------------------------------------------------------------------------
// resources/media.mdx
// ---------------------------------------------------------------------------

export async function sessionListing() {
  const page = await xg.media.sessions.list(deviceId, {
    from: "2026-08-09T00:00:00Z",
    to: "2026-08-10T00:00:00Z",
    streamKey: "cam0",
  });

  for (const s of page.items) {
    console.log(s.startedAt, s.status, s.segmentCount, s.totalBytes);
  }

  const runs = await xg.media.sessions.listRuns(deviceId, { limit: 20 });

  for (const run of runs.items) {
    console.log(run.fromTs, "to", run.toTs);
    console.log(run.streamKeys);
    console.log(run.sessionCount, run.segmentCount, run.anyOpen);
  }
}

export async function segmentReads() {
  const { session: s, segments } = await xg.media.segments(deviceId, sessionId);
  console.log(s.streamKey, segments.length);

  const { url, expiresIn, segment } = await xg.media.segmentPlaybackUrl(
    deviceId,
    sessionId,
    0,
  );
  return { url, expiresIn, segment };
}

export async function replayModes() {
  const replay = await xg.media.replayManifest(deviceId, { sessionId });

  const incident = await xg.media.replayManifest(deviceId, {
    from: "2026-08-09T14:20:00Z",
    to: "2026-08-09T14:35:00Z",
    streamKey: "cam0",
  });

  for (const s of replay.sessions) {
    for (const seg of s.segments) {
      console.log(seg.startTs, seg.effectiveDurationMs);
    }
    for (const gap of s.gaps) {
      console.log(gap.fromTs, gap.toTs, gap.reason);
    }
  }

  return incident;
}

export async function refreshManifest() {
  let replay = await xg.media.replayManifest(deviceId, { sessionId });

  if (Date.now() > replay.urlExpiresAt - 30_000) {
    replay = await xg.media.replayManifest(deviceId, { sessionId });
  }

  return replay;
}

// ---------------------------------------------------------------------------
// resources/telemetry.mdx
// ---------------------------------------------------------------------------

export async function telemetryReads() {
  const { readings, bucketSeconds, truncated } = await xg.telemetry.history(
    deviceId,
    {
      from: "2026-08-09T00:00:00Z",
      to: "2026-08-10T00:00:00Z",
      metric: ["gps.lat", "gps.lon", "gps.speed"],
      interval: 60,
    },
  );
  console.log(readings.length, bucketSeconds, truncated);

  const h = await xg.telemetry.history(deviceId, { from, to });
  if (h.truncated) {
    // Narrow the range.
  }

  const latest = await xg.telemetry.latest(deviceId);
  console.log(latest[0]?.metric);

  const byMetric = await xg.telemetry.latestByMetric(deviceId);
  console.log(byMetric["gps.speed"]?.value);

  const seed = await xg.telemetry.recent(deviceId, {
    metric: ["imu.accel_x", "imu.accel_y", "imu.accel_z"],
    limit: 1000,
  });
  return seed;
}

export async function readingsTable() {
  const page = await xg.telemetry.readings(deviceId, {
    from: yesterday,
    to: now,
    metric: ["imu.accel_x", "imu.accel_y", "imu.accel_z"],
    limit: 200,
  });

  for (const row of page.rows) {
    page.columns.forEach((col, i) => console.log(col.key, row.v[i], col.unit));
  }
}

export async function readingsIteration() {
  const track: TelemetryReading[] = [];
  let capped = false;

  for await (const r of xg.telemetry.iterateReadings(deviceId, {
    from: dayStart,
    to: dayEnd,
    metric: ["gps.lat", "gps.lon"],
    order: "asc",
    onPage: (p) => {
      capped ||= p.totalIsCapped === true;
    },
  })) {
    track.push(r);
  }

  return { track, capped };
}

export async function metricDiscovery() {
  const device = await xg.devices.get(deviceId);
  const model = await xg.deviceModels.get(device.deviceModelId);

  declaredMetrics(model).filter((m) => m.startsWith("imu."));

  const seen = (await xg.telemetry.latest(deviceId)).map((r) => r.metric);
  return seen;
}

// ---------------------------------------------------------------------------
// asset-tracking-walkthrough.mdx
// ---------------------------------------------------------------------------

export function clientFor(organizationId: string) {
  return createClient({
    auth: { apiKey: process.env.XORGATE_API_KEY! },
    organizationId,
    timeoutMs: 30_000,
  });
}

export async function modelTheFleet() {
  const client = clientFor(orgId);

  const existing = await client.workspaces.list();
  const yard =
    existing.find((w) => w.slug === "north-yard") ??
    (await client.workspaces.create({
      name: "North Yard",
      slug: "north-yard",
      description: "Phase 2 staging",
    }));

  return yard;
}

export async function onboardTracker(yard: { id: string }) {
  const yardClient = xg.forWorkspace(yard.id);

  const reg = await yardClient.deviceRegistrations.create();

  const claimed = await xg.deviceRegistrations.waitForClaim(reg.code);
  const device = await xg.devices.get(claimed.deviceId!);

  await xg.devices.update(device.id, { name: "Excavator 12" });
  return device;
}

export async function turnOnRecording(device: Device) {
  const { config } = await xg.devices.getConfig(device.id);

  await xg.devices.patchConfig(device.id, {
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
}

export async function waitForConfig(id: string, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const cfg = await xg.devices.getConfig(id);
    if (!cfg.pending) return cfg;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return null;
}

type FleetRow = {
  id: string;
  name: string;
  status: Device["status"];
  lastSeenAt: string | null;
  lat?: number;
  lon?: number;
  speedKmh?: number;
  stale: boolean;
};

export async function fleet(workspaceId: string): Promise<FleetRow[]> {
  const rows: FleetRow[] = [];

  for await (const d of xg.devices.iterate({ workspaceId, sort: "lastSeenAt" })) {
    const latest = await xg.telemetry.latestByMetric(d.id);
    const fix = latest["gps.lat"];

    rows.push({
      id: d.id,
      name: d.name ?? d.serial,
      status: d.status,
      lastSeenAt: d.lastSeenAt,
      lat: latest["gps.lat"]?.value ?? undefined,
      lon: latest["gps.lon"]?.value ?? undefined,
      speedKmh: latest["gps.speed"]?.value ?? undefined,
      stale: !fix || Date.now() - Date.parse(fix.ts) > 5 * 60_000,
    });
  }

  return rows;
}

export async function dayTrack(id: string, day: Date) {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);

  const { readings, truncated } = await xg.telemetry.history(id, {
    from: start,
    to: end,
    metric: ["gps.lat", "gps.lon", "gps.speed"],
    interval: 60,
  });

  if (truncated) throw new Error("track truncated: narrow the window");

  const points = new Map<
    string,
    { lat?: number; lon?: number; speed?: number }
  >();
  for (const r of readings) {
    const p = points.get(r.ts) ?? {};
    if (r.metric === "gps.lat") p.lat = r.value ?? undefined;
    if (r.metric === "gps.lon") p.lon = r.value ?? undefined;
    if (r.metric === "gps.speed") p.speed = r.value ?? undefined;
    points.set(r.ts, p);
  }

  return [...points.entries()]
    .map(([ts, p]) => ({ ts, ...p }))
    .filter((p) => p.lat !== undefined && p.lon !== undefined);
}

export async function fullResolutionTrack() {
  let capped = false;
  const raw: TelemetryReading[] = [];

  for await (const r of xg.telemetry.iterateReadings(deviceId, {
    from,
    to,
    order: "asc",
    metric: ["gps.lat", "gps.lon"],
    onPage: (p) => {
      capped ||= p.totalIsCapped === true;
    },
  })) {
    raw.push(r);
  }

  return { raw, capped };
}

export async function impacts(
  id: string,
  rangeFrom: Date,
  rangeTo: Date,
  thresholdMs2 = 12,
) {
  const { readings, truncated } = await xg.telemetry.history(id, {
    from: rangeFrom,
    to: rangeTo,
    metric: ["imu.accel_x", "imu.accel_y", "imu.accel_z"],
    interval: 1,
  });

  if (truncated) {
    // Split the window and recurse.
  }

  return readings
    .filter((r) => r.value !== null && Math.abs(r.value) > thresholdMs2)
    .map((r) => ({ ts: r.ts, metric: r.metric, value: r.value! }));
}

export async function imuMetricNames(device: Device) {
  const model = await xg.deviceModels.get(device.deviceModelId);
  return declaredMetrics(model).filter((m: MetricName) => m.startsWith("imu."));
}

export async function incidentReplay(
  id: string,
  at: Date,
): Promise<ReplayManifest> {
  const rangeFrom = new Date(at.getTime() - 60_000);
  const rangeTo = new Date(at.getTime() + 60_000);

  const replay = await xg.media.replayManifest(id, {
    from: rangeFrom,
    to: rangeTo,
  });

  for (const s of replay.sessions) {
    console.log(s.streamKey, s.segments.length, s.gaps.length);
    if (s.timeSource === "unsynced") {
      // Label the replay as untrustworthy.
    }
  }

  return replay;
}

export async function recentDrives() {
  const runs = await xg.media.sessions.listRuns(deviceId, { limit: 20 });
  for (const run of runs.items) {
    console.log(run.fromTs, run.toTs, run.streamKeys, run.anyUnsynced);
  }

  const run = runs.items[0]!;
  return xg.media.replayManifest(deviceId, { sessionId: run.sessions[0]!.id });
}

export async function healthSweep(workspaceId: string) {
  const latest = await xg.devices.latestAgentBuild();

  for await (const d of xg.devices.iterate({ workspaceId })) {
    if (latest && d.agentVersion && d.agentVersion !== latest.version) {
      report.staleAgent.push(d.id);
    }

    const cfg = await xg.devices.getConfig(d.id);
    if (cfg.pending) report.configPending.push(d.id);

    const latestReadings = await xg.telemetry.latest(d.id);
    const newest = latestReadings.reduce(
      (max, r) => Math.max(max, Date.parse(r.ts)),
      0,
    );
    if (d.status === "online" && Date.now() - newest > 3_600_000) {
      report.silent.push(d.id);
    }
  }
}

export async function updateAgentAndPoll() {
  await xg.devices.updateAgent(deviceId);
}

export async function walkthroughErrors() {
  try {
    await xg.devices.reboot(deviceId);
  } catch (e) {
    if (!isXorgateError(e)) throw e;

    switch (e.code) {
      case "CONFLICT":
        break;
      case "INSUFFICIENT_ROLE":
        break;
      case "COMMAND_PUBLISH_FAILED":
        break;
      case "NOT_FOUND":
        break;
      default:
        throw e;
    }
  }
}
