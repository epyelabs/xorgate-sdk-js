/**
 * The shared domain vocabulary. Every type here is exported from the package
 * root, and `@xorgate/react` re-exports these rather than declaring its own, so
 * a value read on the server and a value held in a hook are the same type.
 *
 * Three rules cover every difference between these types and the raw wire:
 *
 * 1. Envelopes are unwrapped. `{devices, page}` becomes `Page<Device>`,
 *    `{device}` becomes `Device`, `{api_keys}` becomes `ApiKey[]`.
 * 2. Everything is camelCase. The snake_case envelope keys (`api_keys`,
 *    `api_key`/`plaintext_key`, `device_model`/`device_models`) and the
 *    snake_case timestamps on `User` and `Organization` are normalized.
 * 3. Timestamps stay ISO-8601 strings, not `Date`. The one exception is the
 *    replay manifest, whose timestamps are epoch milliseconds upstream and stay
 *    numbers, because converting them would break the arithmetic every replay
 *    player does.
 */

import type { DeviceConfig, DeviceUiPrefs } from "./generated/config.js";

export type {
  DeviceConfig,
  DeviceConfigPatch,
  DeviceUiPrefs,
  DeviceUiPrefsPatch,
  ImuMountConfig,
  RecordingConfig,
  LteRecoveryConfig,
  TimeSyncConfig,
  CellularConfig,
} from "./generated/config.js";
export { CONFIG_NAMESPACES } from "./generated/config.js";

// ---------------------------------------------------------------------------
// Client construction
// ---------------------------------------------------------------------------

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Two auth modes, mutually exclusive.
 *
 * `apiKey` is the primary mode for server-to-server callers: send one as
 * `Authorization: Bearer xg_...` and it authenticates any organization-scoped
 * operation at the role it was minted with. There is no `X-Api-Key` header and
 * there never was.
 *
 * `getToken` returns a Cognito **ID** token (not an access token). It is called
 * once per request; the SDK does not cache it, because the caller's Cognito
 * library already does and only the caller knows when it expires.
 */
export type XorgateAuth =
  | { apiKey: string; getToken?: never }
  | { getToken: () => string | Promise<string>; apiKey?: never };

export interface RetryOptions {
  /** Retry attempts after the first try. Default 2. */
  attempts?: number;
  /** First backoff delay in ms; doubles with full jitter. Default 250. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 4000. */
  maxDelayMs?: number;
}

export interface ClientOptions {
  /**
   * A BARE ORIGIN. Defaults to `https://api.xorgate.io`, the production
   * deployment. The SDK appends the `/v1` version segment itself, so pointing
   * this at another deployment or a proxy cannot silently drop the version and
   * land on a deprecated unversioned alias.
   */
  baseUrl?: string;
  auth: XorgateAuth;
  /**
   * REQUIRED. Sent as `X-Organization-Id` on every request. A caller in more
   * than one organization who omits the header gets `400 ORGANIZATION_REQUIRED`
   * from most endpoints, so the SDK refuses to make the header optional.
   */
  organizationId: string;
  /**
   * Default `X-Workspace-Id`. It is a FILTER on `devices.list()` and a REQUIRED
   * field on `deviceRegistrations.create()`; it is sent on nothing else.
   */
  workspaceId?: string;
  /** Injected for edge runtimes and tests. Defaults to global `fetch`. */
  fetch?: FetchLike;
  /**
   * Per-request deadline. Default 30000. Do not set this below ~3000: the
   * production Aurora cluster auto-pauses at 0 ACU after 30 idle minutes, and
   * the first call after a quiet period waits for it to resume.
   */
  timeoutMs?: number;
  /** Off by default. When enabled, applies to GET only. See `RetryOptions`. */
  retry?: RetryOptions | false;
  /** Merged into every request. Cannot override the auth or tenancy headers. */
  headers?: Record<string, string>;
  /** Appended to the SDK's own User-Agent. Ignored in browsers. */
  userAgent?: string;
}

/**
 * The chicken-and-egg client. `GET /me`, `GET /organizations` and
 * `POST /organizations` are the three operations that do not need an active
 * organization, and a brand-new user has none, so they cannot be reached
 * through a client that requires `organizationId`.
 */
export interface BootstrapClientOptions {
  baseUrl?: string;
  auth: XorgateAuth;
  fetch?: FetchLike;
  timeoutMs?: number;
  headers?: Record<string, string>;
  userAgent?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RawRequestInit {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Overrides the client default for this call only. */
  workspaceId?: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Echoed by the endpoints that paginate. `limit`/`offset` are the request
 * values AFTER clamping, so read them back rather than assuming.
 */
export interface PageMeta {
  limit: number;
  offset: number;
  order: SortOrder;
  total: number;
  /** Only `telemetry.readings()` sets these three. */
  totalIsCapped?: boolean;
  coveredFrom?: string;
  coveredTo?: string;
}

export interface Page<T> {
  items: T[];
  page: PageMeta;
}

export type SortOrder = "asc" | "desc";

export interface ListParams {
  limit?: number;
  offset?: number;
  order?: SortOrder;
}

/**
 * The list dialect on the five collections that gained a `page` block with API
 * productization (organizations, memberships, workspaces, device models, API
 * keys). Same `limit`/`offset`/`order`/`sort` params as `devices.list()`; a
 * `limit` above 500 is a 400, never a silent clamp.
 */
export interface ListOrganizationsParams extends ListParams {
  sort?: "createdAt" | "name";
  signal?: AbortSignal;
}

export interface ListMembershipsParams extends ListParams {
  /** Default order is ASCENDING by join date, unlike every other list. */
  sort?: "createdAt" | "role";
  signal?: AbortSignal;
}

export interface ListWorkspacesParams extends ListParams {
  sort?: "updatedAt" | "createdAt" | "name";
  signal?: AbortSignal;
}

export interface ListDeviceModelsParams extends ListParams {
  sort?: "createdAt" | "name";
  signal?: AbortSignal;
}

export interface ListApiKeysParams extends ListParams {
  sort?: "createdAt" | "name";
  signal?: AbortSignal;
}

export interface IterateOptions {
  /**
   * Called once per underlying HTTP page, before its items are yielded. The
   * only way to observe `totalIsCapped` from inside an iteration.
   */
  onPage?: (page: PageMeta) => void;
  /** Page size for the underlying requests. Defaults to the endpoint default. */
  pageSize?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

/**
 * `group.field`. The metric naming contract across the whole platform: live
 * MQTT telemetry, the history endpoints and replayed telemetry all use it, and
 * `@xorgate/react` re-exports this exact type.
 */
export type MetricName = `${string}.${string}`;

export type UserTier = "free" | "pro" | "team";
/** PLATFORM role, unrelated to the per-organization membership role. */
export type PlatformRole = "user" | "admin";
export type MembershipRole = "owner" | "admin" | "member" | "viewer";
export type DeviceStatus =
  | "provisioned"
  | "online"
  | "offline"
  | "decommissioned";
export type ApiKeyScope = "edge" | "cloud" | "client";
export type StreamKey = string;

/** `created_at` on the wire; normalized here, like every snake_case outlier. */
export interface User {
  id: string;
  email: string;
  name: string | null;
  tier: UserTier;
  role: PlatformRole;
  /**
   * Null through `GET /me`, which builds its `user` block from the request's
   * auth context rather than serializing the row, and so never carries a
   * timestamp. The field is on the wire format; that one endpoint omits it.
   */
  createdAt: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  createdAt: string;
}

/** `memberships.list()` enriches each row with its member's identity. */
export interface MembershipWithUser extends Membership {
  user: Pick<User, "id" | "email" | "name"> | null;
}

export interface Me {
  user: User;
  memberships: Membership[];
  /** Empty for a brand-new user. Create one before doing anything org-scoped. */
  organizations: Organization[];
}

export interface ApiKey {
  id: string;
  organizationId: string;
  name: string;
  /** Recorded on the key. Nothing enforces it: every key behaves as `cloud`. */
  scope: ApiKeyScope;
  /**
   * The role the key acts with, using the same gates a membership role does.
   * A key is never a PLATFORM admin, so device-model writes are closed to it
   * regardless of this value.
   */
  role: MembershipRole;
  /**
   * First 8 characters of the plaintext, for identifying a key someone holds.
   * Null on keys minted before the column existed, and unrecoverable for them:
   * only the hash was ever stored. Render it as unknown, never as a guess.
   */
  keyPrefix: string | null;
  /** Null means never. Past it, requests get `API_KEY_EXPIRED`. */
  expiresAt: string | null;
  /**
   * Roughly when the key last authenticated a request; null until it does.
   * The write is throttled and fire-and-forget, so this is a liveness hint for
   * finding unused keys, not an audit trail.
   */
  lastUsedAt: string | null;
  /** Set means dead (`API_KEY_REVOKED`). No endpoint sets it; delete instead. */
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey {
  apiKey: ApiKey;
  /** Shown exactly once. Only its SHA-256 is stored. */
  plaintextKey: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceModel {
  id: string;
  name: string;
  sku: string;
  ioCapabilities: IoCapabilities | null;
  firmwareChannel: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- io_capabilities -------------------------------------------------------

export interface VideoCapability {
  /** Becomes a video signaling channel named `${deviceId}-${key}` at provisioning. */
  key: string;
  codec: string;
  maxWidth?: number;
  maxHeight?: number;
  maxFps?: number;
  label?: string;
}

export interface AudioCapability {
  key: string;
  codec: string;
  sampleRate?: number;
  channels?: number;
}

export interface ImuCapability {
  /** Legacy alias for `accel`. */
  axes?: string[];
  accel?: string[];
  quaternion?: string[];
  euler?: string[];
  unit?: string;
  rateHz?: number;
}

export interface FieldList {
  fields: string[];
}

export interface IoCapabilities {
  schemaVersion: 1;
  media?: { video?: VideoCapability[]; audio?: AudioCapability[] };
  sensors?: { imu?: ImuCapability };
  comm?: { module?: string; gps?: FieldList; signal?: FieldList };
  system?: FieldList;
}

export interface IoCapabilitiesIssue {
  /** JSON-pointer-ish path, e.g. `media.video[0].codec`. */
  path: string;
  message: string;
}

export type IoCapabilitiesResult =
  | { valid: true; value: IoCapabilities; issues: [] }
  | { valid: false; value: null; issues: IoCapabilitiesIssue[] };

// ---- devices ---------------------------------------------------------------

export interface Device {
  id: string;
  workspaceId: string;
  deviceModelId: string;
  serial: string;
  name: string | null;
  /** Compare against `AgentBuild.version` by STRING EQUALITY. Shas do not order. */
  agentVersion: string | null;
  /** Machine-managed. Writing it through `update()` is a 400. */
  status: DeviceStatus;
  lastSeenAt: string | null;
  config: DeviceConfig;
  /** Bumped on every config write; carried on the retained MQTT message as `rev`. */
  configRev: number;
  configUpdatedAt: string | null;
  uiPrefs: DeviceUiPrefs;
  reportedConfig: DeviceReportedConfig | null;
  reportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConfigApplyState = "applied" | "adjusted" | "rejected";

/**
 * Mirrored off `xorgate/devices/{id}/config/reported`. Null until the device
 * has reported at least once. There is no `pending` state on the wire: it is
 * computed as `configRev > reportedConfig.rev` on an online device.
 */
export interface DeviceReportedConfig {
  v: number;
  deviceId: string;
  ts: string;
  /** Last desired revision the device applied. 0 means it never received one. */
  rev: number;
  origin: "cloud" | "local" | "boot";
  /** Post-clamp values actually in force, plus the reported-only namespaces. */
  effective: Record<string, unknown>;
  status: Record<
    string,
    { state: ConfigApplyState; at: string; detail?: string; reason?: string }
  >;
  /** Only on an `origin: "local"` report. */
  changed?: string[] | null;
}

export interface DeviceIdentity {
  /** Equals the device id, and is also the MQTT client id. */
  iotThingName: string;
  certificateId: string;
  policyName: string;
  roleAlias: string;
  /** Read from the database, not from AWS IoT: an out-of-band revoke still reads `active`. */
  status: "active" | "revoked";
  createdAt: string;
}

export interface DeviceProvisioning {
  device: { id: string; thingName: string };
  iot: {
    dataEndpoint: string;
    credentialEndpoint: string;
    roleAlias: string;
    /** Shown once. */
    certificatePem: string;
    /** Shown once, never stored server-side. */
    privateKey: string | null;
    caUrl: string;
  };
  mqtt: { telemetryTopic: string; statusTopic: string };
  /**
   * Operator path, so the AWS names stay: this bundle is consumed by the device
   * installer and by whoever debugs a provisioning failure, and `channelArn` is
   * the field the wire actually carries. `VideoChannel` below is the same value
   * under a generic name, because a third party never interprets it.
   */
  kvs: {
    region: string;
    channels: Array<{
      streamKey: StreamKey;
      channelName: string;
      channelArn: string;
    }>;
  };
}

/**
 * One live-video channel of a device. Returned by `devices.videoChannels()`.
 *
 * Metadata only, never credentials. `channelRef` is an OPAQUE handle: pass it
 * back to the SDK and never parse it.
 */
export interface VideoChannel {
  streamKey: StreamKey;
  channelName: string;
  channelRef: string;
  region: string;
}

export type DeviceCommand = "reboot" | "power_off" | "refresh" | "update";

export interface CommandAccepted {
  /** Replay key. The device refuses to execute the same one twice. */
  requestId: string;
  command: DeviceCommand;
  /** Epoch ms after which the device refuses the command. */
  expiresAt: number;
}

export interface AgentBuild {
  version: string;
  channel: string | null;
  builtAt: string | null;
  packageVersion: string | null;
  tarball: string | null;
}

export type RegistrationStatus = "pending" | "claimed" | "expired";

export interface DeviceRegistration {
  code: string;
  status: RegistrationStatus;
  /** The device created by the claim; null until then. */
  deviceId: string | null;
  /** 15 minutes after the code was minted. */
  expiresAt: string;
  /** `<api base>/get/{code}`. Run it on the device. */
  installUrl: string;
}

export interface SearchResult {
  type: "device" | "workflow-template" | "workflow-instance";
  id: string;
  title: string;
  subtitle: string | null;
}

// ---- media -----------------------------------------------------------------

export type SessionStatus = "open" | "closed";
export type TimeSource = "ntp" | "gps" | "nitz" | "rtc" | "unsynced";

export interface MediaSession {
  /** Device-minted UUIDv7, so it sorts by start time. */
  id: string;
  deviceId: string;
  streamKey: StreamKey;
  startedAt: string;
  endedAt: string | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  source: string | null;
  /** Advisory: a session closes ~10 min after segments stop and reopens on a straggler. */
  status: SessionStatus;
  timeSource: TimeSource | null;
  lastSegmentAt: string | null;
  createdAt: string;
  /** Rollups, present on the list endpoint only. */
  segmentCount?: number;
  totalBytes?: number;
  totalDurationMs?: number;
}

/** One drive: the sessions whose intervals are within 60 s of each other. */
export interface RecordingRun {
  /** The earliest member session's id. There is no run row in the database. */
  key: string;
  fromTs: string;
  toTs: string;
  streamKeys: StreamKey[];
  sessionCount: number;
  segmentCount?: number;
  totalBytes?: number;
  anyOpen?: boolean;
  anyUnsynced?: boolean;
  sessions: MediaSession[];
}

export interface MediaSegment {
  id: string;
  deviceId: string;
  sessionId: string;
  streamKey: StreamKey;
  s3Key: string;
  seq: number;
  startTs: string;
  durationMs: number;
  keyframe?: boolean;
  sizeBytes: number | null;
  /** False means a crash-cut partial, playable up to the cut. */
  finalized: boolean;
  meta: Record<string, unknown> | null;
  uploadedAt: string;
}

export interface SessionSegments {
  session: MediaSession;
  segments: MediaSegment[];
}

export interface SegmentPlayback {
  url: string;
  /** URL TTL in seconds. */
  expiresIn: number;
  segment: MediaSegment;
}

/** Every timestamp in the manifest is epoch MILLISECONDS, unlike the rest of the API. */
export interface ReplayManifest {
  deviceId: string;
  from: number;
  to: number;
  /** Real URL TTL minus a 5-minute margin. Refetch before this. */
  urlExpiresAt: number;
  sessions: ReplaySession[];
}

export interface ReplaySession {
  id: string;
  streamKey: StreamKey;
  status: SessionStatus;
  timeSource: TimeSource | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  segments: ReplaySegment[];
  gaps: ReplayGap[];
}

export interface ReplaySegment {
  seq: number;
  startTs: number;
  /** Next-segment delta when contiguous, else the recorded duration. Deltas beat durations. */
  effectiveDurationMs: number;
  finalized: boolean;
  /** `fstat` seq-0 rows include ~2 s of pipeline startup. */
  anchor: "fstat" | "computed" | "boundary" | null;
  sizeBytes: number | null;
  url: string;
}

export interface ReplayGap {
  fromTs: number;
  toTs: number;
  reason: "missing-segments" | "evicted-head";
}

// ---- telemetry -------------------------------------------------------------

export interface TelemetryReading {
  ts: string;
  metric: MetricName;
  value: number | null;
  unit: string | null;
}

/** The most recent reading for one (device, metric) pair. */
export interface LatestReading {
  metric: MetricName;
  value: number | null;
  unit: string | null;
  ts: string;
}

/**
 * The interop shape shared with `@xorgate/react`: live MQTT telemetry and
 * replayed telemetry both emit this, so one renderer handles all three sources.
 */
export type LatestByMetric = Record<MetricName, LatestReading>;

export interface TelemetryHistory {
  readings: TelemetryReading[];
  /** Echo of `interval`; null when raw rows were returned. */
  bucketSeconds: number | null;
  /** True means the row cap was hit and the result is INCOMPLETE. */
  truncated: boolean;
}

export interface TelemetryTableColumn {
  key: MetricName;
  /** Read from the device's latest readings, so it is stable across pages. */
  unit: string | null;
}

export interface TelemetryTableRow {
  ts: string;
  /** POSITIONAL against `columns`. Length always equals `columns.length`. */
  v: Array<number | null>;
}

export type TelemetryColumnSource = "request" | "model" | "data";

export interface TelemetryTablePage {
  columns: TelemetryTableColumn[];
  rows: TelemetryTableRow[];
  columnSource: TelemetryColumnSource;
  page: PageMeta;
}

// ---------------------------------------------------------------------------
// Resource inputs
// ---------------------------------------------------------------------------

export interface CreateOrganizationInput {
  name: string;
  /** Unique across all organizations. */
  slug: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
}

export type AddMembershipInput =
  | { userId: string; role?: MembershipRole; email?: never }
  | { email: string; role?: MembershipRole; userId?: never };

export interface AddMembershipResult {
  membership: Membership;
  /** True when a new Cognito account was created and emailed an invitation. */
  invited: boolean;
}

export interface CreateApiKeyInput {
  name: string;
  scope: ApiKeyScope;
  /** Defaults to `member`. Cannot exceed the minting caller's own role. */
  role?: MembershipRole;
  /** ISO-8601, must be in the future. Omit or null for a key that never expires. */
  expiresAt?: string | null;
}

export interface CreateSessionTokenInput {
  /**
   * Confine the token to one workspace. Omit for the whole organization.
   *
   * This is where a consumer's own authorization decision is expressed in terms
   * xorgate can enforce: map your customers onto workspaces and pass the one
   * this end user belongs to. Unlike `X-Workspace-Id` everywhere else, it is a
   * BOUNDARY rather than a filter. A workspace outside the key's organization
   * is a 403, and so is one that does not exist.
   */
  workspaceId?: string | null;
  /** 60 to 3600, default 900. Out of range is REJECTED, not clamped. */
  ttlSeconds?: number;
}

/**
 * A minted session token. Flat rather than an envelope, matching the wire: it
 * is a credential rather than a resource, and there is nothing to read back.
 */
export interface SessionToken {
  /** Identifies the token in your own logs. NOT a credential. */
  id: string;
  /** The credential. Returned once; only its hash is stored. */
  token: string;
  expiresAt: string;
  /** Echo of the requested scope. Null means organization-wide. */
  workspaceId: string | null;
  /** Inherited from the key. The role in force is the lower of this and the key's. */
  role: MembershipRole;
  /**
   * Live-plane coordinates, so a client's config is `{ baseUrl }` and nothing
   * else. `@xorgate/react` reads these off the token; a consumer passes the
   * whole object through to its client and never picks it apart.
   */
  live: { region: string; realtimeEndpoint: string };
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description?: string | null;
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  description?: string | null;
}

export interface CreateDeviceModelInput {
  name: string;
  sku: string;
  ioCapabilities?: IoCapabilities | null;
  firmwareChannel?: string | null;
}

export interface UpdateDeviceModelInput {
  name?: string;
  sku?: string;
  ioCapabilities?: IoCapabilities | null;
  firmwareChannel?: string | null;
}

export interface DeviceModelWriteOptions {
  /**
   * Skip the client-side `ioCapabilities` check. Default true (the check runs).
   * Only pass false to write a document the SDK's schema rejects but the
   * platform accepts, which today means a document that will provision zero
   * video channels.
   */
  validate?: boolean;
}

export type DeviceSortKey =
  | "updatedAt"
  | "createdAt"
  | "lastSeenAt"
  | "serial"
  | "name";

export interface ListDevicesParams extends ListParams {
  /** Sent as `X-Workspace-Id`. Overrides the client default for this call. */
  workspaceId?: string;
  status?: DeviceStatus | "any";
  sort?: DeviceSortKey;
  signal?: AbortSignal;
}

export interface CreateDeviceInput {
  workspaceId: string;
  deviceModelId: string;
  /** Unique within the workspace. */
  serial: string;
  name?: string | null;
  status?: DeviceStatus;
}

export interface UpdateDeviceInput {
  name?: string | null;
}

/** What `devices.getConfig()` returns: the config view of a device read. */
export interface DeviceConfigView {
  config: DeviceConfig;
  configRev: number;
  configUpdatedAt: string | null;
  reportedConfig: DeviceReportedConfig | null;
  reportedAt: string | null;
  /** Computed: `configRev > reportedConfig.rev` on an online device. */
  pending: boolean;
}

export interface CreateDeviceRegistrationInput {
  /** Sent as `X-Workspace-Id`, REQUIRED here. Falls back to the client default. */
  workspaceId?: string;
}

export interface WaitForClaimOptions {
  /** Default 900000, matching the 15-minute code lifetime. */
  timeoutMs?: number;
  /** Default 3000. */
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export interface ListSessionsParams extends ListParams {
  streamKey?: StreamKey;
  status?: SessionStatus | "any";
  /** Matches sessions OVERLAPPING the range, not just those started inside it. */
  from?: string | Date;
  to?: string | Date;
  sort?: "startedAt" | "createdAt";
  signal?: AbortSignal;
}

/** `group=runs` needs `sort=startedAt`, so it is a separate method, not a flag. */
export type ListRunsParams = Omit<ListSessionsParams, "sort">;

export type ReplayManifestParams =
  | { sessionId: string; from?: never; to?: never; streamKey?: never }
  | {
      sessionId?: never;
      from: string | Date;
      to: string | Date;
      streamKey?: StreamKey;
    };

export interface TelemetryHistoryParams {
  /** REQUIRED. The range may not exceed 31 days. */
  from: string | Date;
  to: string | Date;
  /** At most 20 metrics. Sent as a comma-separated list. */
  metric?: MetricName[];
  /** Bucket width in seconds. Bucket-averages server-side, up to 10,000 buckets. */
  interval?: number;
  signal?: AbortSignal;
}

export interface TelemetryRecentParams {
  metric?: MetricName[];
  /** 1 to 5000, default 500. Out of range is a 400 here, NOT clamped. */
  limit?: number;
  signal?: AbortSignal;
}

export interface TelemetryReadingsParams extends ListParams {
  from?: string | Date;
  to?: string | Date;
  /** Under the table shape this also fixes the column set. */
  metric?: MetricName[];
  signal?: AbortSignal;
}
