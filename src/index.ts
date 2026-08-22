/**
 * `@xorgate/sdk` — the server-side JavaScript and TypeScript client for the
 * xorgate platform API.
 *
 * ```ts
 * import { createClient } from "@xorgate/sdk"
 *
 * const xg = createClient({
 *   auth: { apiKey: process.env.XORGATE_API_KEY! },
 *   organizationId: process.env.XORGATE_ORG_ID!,
 * })
 *
 * const page = await xg.devices.list({ status: "online" })
 * ```
 *
 * Zero runtime dependencies. Node 20+, and anything with a global `fetch`.
 */

export { createClient, createBootstrapClient, DEFAULT_BASE_URL } from "./client.js";
export type { XorgateClient, BootstrapClient } from "./client.js";

export { XorgateError, isXorgateError } from "./errors.js";
export type {
  XorgateApiErrorCode,
  XorgateClientErrorCode,
  XorgateErrorCode,
} from "./errors.js";

export {
  validateIoCapabilities,
  parseIoCapabilities,
  videoStreamKeys,
  declaredMetrics,
} from "./capabilities.js";

export type { OrganizationsResource } from "./resources/organizations.js";
export type { MembershipsResource } from "./resources/memberships.js";
export type { ApiKeysResource } from "./resources/api-keys.js";
export type { AuthResource } from "./resources/auth.js";
export type { WorkspacesResource } from "./resources/workspaces.js";
export type { DeviceModelsResource } from "./resources/device-models.js";
export type { DevicesResource } from "./resources/devices.js";
export type { DeviceRegistrationsResource } from "./resources/device-registrations.js";
export type { MediaResource } from "./resources/media.js";
export type { TelemetryResource } from "./resources/telemetry.js";

export { CONFIG_NAMESPACES } from "./generated/config.js";

export type * from "./types.js";
