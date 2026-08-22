import { drain, iteratePaged } from "../pagination.js";
import { normalizeDevice, unwrap, unwrapList, unwrapPage } from "../normalize.js";
import { isXorgateError } from "../errors.js";
import type { HttpCore } from "../http.js";
import type {
  AgentBuild,
  CommandAccepted,
  CreateDeviceInput,
  Device,
  DeviceConfig,
  DeviceConfigPatch,
  DeviceConfigView,
  DeviceIdentity,
  DeviceProvisioning,
  DeviceUiPrefsPatch,
  IterateOptions,
  ListDevicesParams,
  Page,
  UpdateDeviceInput,
  VideoChannel,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class DevicesResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * PAGINATED. An out-of-organization `workspaceId` yields an EMPTY page, not
   * an error, so an empty result never distinguishes "no devices" from
   * "wrong workspace".
   */
  async list(params: ListDevicesParams = {}): Promise<Page<Device>> {
    const body = await this.http.request(
      "GET",
      "/devices",
      {
        query: {
          limit: params.limit,
          offset: params.offset,
          order: params.order,
          sort: params.sort,
          status: params.status,
        },
        ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
      },
      this.tenancy,
    );
    return unwrapPage<Device>(body, "devices", normalizeDevice);
  }

  iterate(
    params: ListDevicesParams & IterateOptions = {},
  ): AsyncIterableIterator<Device> {
    return iteratePaged<Device>(
      (limit, offset) => this.list({ ...params, limit, offset }),
      { ...params, defaultPageSize: params.limit ?? 100 },
    );
  }

  listAll(params: ListDevicesParams & IterateOptions = {}): Promise<Device[]> {
    return drain(this.iterate(params));
  }

  async get(id: string): Promise<Device> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
    return normalizeDevice(unwrap(body, "device"));
  }

  /** Creates the ROW only. No IoT identity until `provision()`. */
  async create(input: CreateDeviceInput): Promise<Device> {
    const body = await this.http.request(
      "POST",
      "/devices",
      { body: input },
      this.tenancy,
    );
    return normalizeDevice(unwrap(body, "device"));
  }

  /** Metadata only. `status` and `lastSeenAt` are machine-managed and rejected 400. */
  async update(id: string, input: UpdateDeviceInput): Promise<Device> {
    const body = await this.http.request(
      "PUT",
      `/devices/${encodeURIComponent(id)}`,
      { body: input },
      this.tenancy,
    );
    return normalizeDevice(unwrap(body, "device"));
  }

  /** Cascades. Does NOT tear down the AWS IoT thing or certificate. */
  async delete(id: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/devices/${encodeURIComponent(id)}`,
      {},
      this.tenancy,
    );
  }

  // ---- configuration -------------------------------------------------------

  /** Convenience over `get()`: there is no `GET /devices/{id}/config` route. */
  async getConfig(id: string): Promise<DeviceConfigView> {
    return configView(await this.get(id));
  }

  /**
   * Write config namespaces. **Each present namespace is replaced WHOLE.**
   *
   * This is the sharpest edge in the whole surface, and it does not look like
   * one. `patchConfig(id, { recording: { telemetry: { enabled: true } } })`
   * deletes every other key under `recording` — including per-camera enables
   * that were suppressing hardware that does not work. That exact call broke a
   * camera on the production bench device, which then start/fail looped every
   * 60 seconds until the namespace was restored.
   *
   * Use {@link mergeConfig} unless you genuinely mean to replace the namespace.
   *
   * `configRev` is bumped and the whole document is published as a retained
   * MQTT message. A 502 `CONFIG_PUBLISH_FAILED` means the write SUCCEEDED but
   * the device has not been told; it self-heals on the device's next config
   * report, so do not retry.
   *
   * Writing `null` for a namespace reverts it to the device defaults. An empty
   * object is not an erase, it is a 400.
   */
  async patchConfig(id: string, patch: DeviceConfigPatch): Promise<Device> {
    const body = await this.http.request(
      "PATCH",
      `/devices/${encodeURIComponent(id)}/config`,
      { body: patch },
      this.tenancy,
    );
    return normalizeDevice(unwrap(body, "device"));
  }

  /**
   * Read-modify-write: deep-merges `patch` into the device's current config and
   * sends each touched namespace back WHOLE.
   *
   * This is what "turn X on" should almost always mean. `patchConfig()` is the
   * raw endpoint and replaces a namespace entirely, so expressing "enable
   * telemetry recording" as the smallest possible patch silently erases every
   * other setting in that namespace. This method reads first so it does not.
   *
   * ```ts
   * await xg.devices.mergeConfig(deviceId, {
   *   recording: { telemetry: { enabled: true } },
   * })
   * ```
   *
   * Semantics worth knowing:
   *
   * - `null` at the namespace level still means "revert this namespace", and is
   *   passed through unmerged.
   * - `null` at any level BELOW a namespace deletes that key from the merged
   *   result, which is the only way to remove one key without rewriting its
   *   siblings.
   * - Arrays replace rather than concatenate.
   * - It costs one extra GET, and it is NOT atomic: the API has no `If-Match`
   *   on `configRev`, so two concurrent writers can still clobber each other.
   *   Nothing in the API can fix that today; this only removes the
   *   self-inflicted case.
   */
  async mergeConfig(id: string, patch: DeviceConfigPatch): Promise<Device> {
    const current = await this.get(id);
    const merged: DeviceConfigPatch = {};
    for (const [namespace, value] of Object.entries(patch) as Array<
      [keyof DeviceConfig, unknown]
    >) {
      if (value === null) {
        (merged as Record<string, unknown>)[namespace] = null;
        continue;
      }
      (merged as Record<string, unknown>)[namespace] = deepMerge(
        (current.config as Record<string, unknown>)[namespace],
        value,
      );
    }
    return this.patchConfig(id, merged);
  }

  /** Cloud-only. Publishes nothing and does not bump `configRev`. */
  async patchUiPrefs(id: string, patch: DeviceUiPrefsPatch): Promise<Device> {
    const body = await this.http.request(
      "PATCH",
      `/devices/${encodeURIComponent(id)}/ui-prefs`,
      { body: patch },
      this.tenancy,
    );
    return normalizeDevice(unwrap(body, "device"));
  }

  // ---- identity ------------------------------------------------------------

  /** Null (with a 200, not a 404) when the device is not provisioned. */
  async identity(id: string): Promise<DeviceIdentity | null> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(id)}/identity`,
      {},
      this.tenancy,
    );
    return unwrap<DeviceIdentity | null>(body, "identity") ?? null;
  }

  /**
   * Owner/admin. One shot: a second call for a provisioned device is a 409.
   *
   * The response carries `certificatePem` and `privateKey` exactly once and the
   * private key is never stored server-side. Never log the bundle whole.
   */
  async provision(id: string): Promise<DeviceProvisioning> {
    return await this.http.request<DeviceProvisioning>(
      "POST",
      `/devices/${encodeURIComponent(id)}/provision`,
      {},
      this.tenancy,
    );
  }

  /** Empty array when the device is not provisioned. Metadata only, no credentials. */
  async videoChannels(id: string): Promise<VideoChannel[]> {
    const body = await this.http.request(
      "GET",
      `/devices/${encodeURIComponent(id)}/video-channels`,
      {},
      this.tenancy,
    );
    return unwrapList<VideoChannel>(body, "channels");
  }

  // ---- commands ------------------------------------------------------------

  /** All four require the device to be ONLINE (409 otherwise). */
  reboot(id: string): Promise<CommandAccepted> {
    return this.command(id, "reboot");
  }

  powerOff(id: string): Promise<CommandAccepted> {
    return this.command(id, "power-off");
  }

  /** Read-only re-probe. Member access. Device rate-limits to ~1 per 30 s. */
  refreshState(id: string): Promise<CommandAccepted> {
    return this.command(id, "refresh-state");
  }

  /** Owner/admin. Observe by polling `agentVersion`; the ack cannot tell you. */
  updateAgent(id: string): Promise<CommandAccepted> {
    return this.command(id, "update");
  }

  private command(id: string, path: string): Promise<CommandAccepted> {
    return this.http.request<CommandAccepted>(
      "POST",
      `/devices/${encodeURIComponent(id)}/${path}`,
      {},
      this.tenancy,
    );
  }

  /**
   * Fleet-wide, not per device. Null means CI has published nothing for this
   * stage, which the underlying endpoint reports as a 404 rather than an empty
   * body; "latest unknown" is not an error, so it is mapped to null here.
   */
  async latestAgentBuild(): Promise<AgentBuild | null> {
    try {
      const body = await this.http.request(
        "GET",
        "/device-dist/latest",
        {},
        this.tenancy,
      );
      return unwrap<AgentBuild | null>(body, "latest") ?? null;
    } catch (e) {
      if (isXorgateError(e) && e.code === "NOT_FOUND") return null;
      throw e;
    }
  }
}

/** The config view of a device read, with `pending` computed. */
export function configView(device: Device): DeviceConfigView {
  return {
    config: device.config,
    configRev: device.configRev,
    configUpdatedAt: device.configUpdatedAt,
    reportedConfig: device.reportedConfig,
    reportedAt: device.reportedAt,
    // There is no `pending` state on the wire and every consumer derived it the
    // same way. An offline device is never pending: it is not listening, so the
    // retained message simply waits for it.
    pending:
      device.status === "online" &&
      device.configRev > (device.reportedConfig?.rev ?? 0),
  };
}

/**
 * Plain-object deep merge, with `null` meaning "delete this key". Arrays
 * replace rather than concatenate, because every array in the config contract
 * is a complete list rather than an accumulator.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    out[key] = isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
