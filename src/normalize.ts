/**
 * The wire-to-SDK translation layer.
 *
 * The API's rule is "responses are always a named object, never a bare array",
 * and its casing is per-entity rather than global: Workspace, ApiKey,
 * Membership and every device sub-resource are camelCase, while Organization
 * and User rows serialize straight out of Postgres and carry `created_at` /
 * `updated_at`. Three envelope KEYS are snake_case too (`api_keys`,
 * `api_key`/`plaintext_key`, `device_model`/`device_models`), mirroring their
 * table names.
 *
 * Everything here is deliberately tolerant of BOTH spellings. Normalizing the
 * two outliers is on the platform's own backlog; when it happens, this layer
 * keeps working rather than starting to return `undefined` timestamps.
 */
import { XorgateError } from "./errors.js";
import type {
  Device,
  DeviceConfig,
  DeviceUiPrefs,
  HttpMethod,
  Organization,
  Page,
  PageMeta,
  User,
} from "./types.js";

function pick(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined) return row[name];
  }
  return undefined;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new XorgateError({
      code: "INVALID_RESPONSE",
      message: `Expected ${what} to be an object.`,
    });
  }
  return value as Record<string, unknown>;
}

/**
 * Unwrap `{ key: value }`. Throws `INVALID_RESPONSE` rather than returning
 * undefined, because a missing envelope means the response was not what the
 * endpoint promised and the caller should hear about it here, not three frames
 * later on a property access.
 */
export function unwrap<T>(body: unknown, ...keys: string[]): T {
  const row = asRecord(body, "the response body");
  for (const key of keys) {
    if (row[key] !== undefined) return row[key] as T;
  }
  throw new XorgateError({
    code: "INVALID_RESPONSE",
    message: `The response carried no "${keys[0]}" key. Got: ${Object.keys(row).join(", ") || "(empty object)"}.`,
    details: { expected: keys, received: Object.keys(row) },
  });
}

/** Unwrap a list envelope, tolerating a null/absent list as empty. */
export function unwrapList<T>(body: unknown, ...keys: string[]): T[] {
  const value = unwrap<unknown>(body, ...keys);
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new XorgateError({
      code: "INVALID_RESPONSE",
      message: `Expected "${keys[0]}" to be an array.`,
    });
  }
  return value as T[];
}

/** Unwrap `{ items, page }` into a `Page<T>`. Accepts alternate envelope keys. */
export function unwrapPage<T>(
  body: unknown,
  itemsKeys: string | readonly string[],
  map: (item: unknown) => T = (item) => item as T,
): Page<T> {
  const keys = typeof itemsKeys === "string" ? [itemsKeys] : itemsKeys;
  const items = unwrapList<unknown>(body, ...keys).map(map);
  const row = asRecord(body, "the response body");
  return { items, page: normalizePageMeta(row["page"], items.length) };
}

/**
 * A `page` block, or a synthesized one.
 *
 * Five list endpoints still return bare collections with no `page` block at
 * all, and making that consistent belongs to a later platform phase. Until
 * then, `iterate()` over an unpaginated endpoint needs a page block that says
 * "this was everything", which is what the synthesized one says.
 */
export function normalizePageMeta(value: unknown, itemCount: number): PageMeta {
  if (typeof value !== "object" || value === null) {
    return { limit: itemCount, offset: 0, order: "desc", total: itemCount };
  }
  const row = value as Record<string, unknown>;
  const meta: PageMeta = {
    limit: typeof row["limit"] === "number" ? row["limit"] : itemCount,
    offset: typeof row["offset"] === "number" ? row["offset"] : 0,
    order: row["order"] === "asc" ? "asc" : "desc",
    total: typeof row["total"] === "number" ? row["total"] : itemCount,
  };
  if (typeof row["totalIsCapped"] === "boolean") {
    meta.totalIsCapped = row["totalIsCapped"];
  }
  if (typeof row["coveredFrom"] === "string") meta.coveredFrom = row["coveredFrom"];
  if (typeof row["coveredTo"] === "string") meta.coveredTo = row["coveredTo"];
  return meta;
}

/** `created_at` / `updated_at` on the wire. One of the two casing outliers. */
export function normalizeOrganization(value: unknown): Organization {
  const row = asRecord(value, "an organization");
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    slug: String(row["slug"]),
    createdAt: String(pick(row, "createdAt", "created_at") ?? ""),
    updatedAt: String(pick(row, "updatedAt", "updated_at") ?? ""),
  };
}

/**
 * The other casing outlier. `createdAt` is null through `GET /me`, which builds
 * its `user` block from the request's auth context instead of serializing the
 * row, so no timestamp is on the wire at all.
 */
export function normalizeUser(value: unknown): User {
  const row = asRecord(value, "a user");
  const createdAt = pick(row, "createdAt", "created_at");
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    name: (row["name"] as string | null) ?? null,
    tier: (row["tier"] as User["tier"]) ?? "free",
    role: (row["role"] as User["role"]) ?? "user",
    createdAt: typeof createdAt === "string" ? createdAt : null,
  };
}

/**
 * The device row, minus the deprecated top-level duplicates.
 *
 * The API still returns `firmwareVersion`, `gnssAntBias`,
 * `activeStreamsViewType`, `imuMount`, `imuView`, `recordingConfig`,
 * `lteRecoveryConfig` and `timeSyncConfig` beside `config` and `uiPrefs`, all
 * carrying the same values under older names. Dropping them here means there is
 * exactly one place to read each value; `request()` still reaches them during a
 * migration.
 */
export function normalizeDevice(value: unknown): Device {
  const row = asRecord(value, "a device");
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspaceId"]),
    deviceModelId: String(row["deviceModelId"]),
    serial: String(row["serial"]),
    name: (row["name"] as string | null) ?? null,
    agentVersion: (row["agentVersion"] as string | null) ?? null,
    status: row["status"] as Device["status"],
    // Absent on a pre-cm4-support backend; false is the right read there
    // (probe-at-claim did not exist, so no device is awaiting a model).
    needsModel: row["needsModel"] === true,
    lastSeenAt: (row["lastSeenAt"] as string | null) ?? null,
    config: (row["config"] as DeviceConfig | null) ?? {},
    configRev: typeof row["configRev"] === "number" ? row["configRev"] : 0,
    configUpdatedAt: (row["configUpdatedAt"] as string | null) ?? null,
    uiPrefs: (row["uiPrefs"] as DeviceUiPrefs | null) ?? {},
    reportedConfig: (row["reportedConfig"] as Device["reportedConfig"]) ?? null,
    reportedAt: (row["reportedAt"] as string | null) ?? null,
    createdAt: String(row["createdAt"]),
    updatedAt: String(row["updatedAt"]),
  };
}

/** Query values the API understands: ISO-8601 for a time, omitted for undefined. */
export function isoOrUndefined(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

export function commaList(values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  return values.join(",");
}

export type { HttpMethod };
