import { XorgateError } from "../errors.js";
import type { HttpCore } from "../http.js";
import type {
  CreateDeviceRegistrationInput,
  DeviceRegistration,
  WaitForClaimOptions,
} from "../types.js";
import type { Tenancy } from "./tenancy.js";

export class DeviceRegistrationsResource {
  constructor(
    private readonly http: HttpCore,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Idempotent per workspace: an existing pending, un-expired code is returned
   * instead of a new one, so a page reload or a retried timeout costs nothing.
   * Note the API answers 200, not 201, and its body is a bare object rather
   * than a named envelope: it is the one response in the API that does that.
   */
  async create(
    input: CreateDeviceRegistrationInput = {},
  ): Promise<DeviceRegistration> {
    const workspaceId = input.workspaceId ?? this.tenancy.workspaceId;
    if (!workspaceId) {
      throw new XorgateError({
        code: "INVALID_CONFIG",
        message:
          "deviceRegistrations.create() needs a workspace. Pass { workspaceId } " +
          "or configure one with forWorkspace() / the client's workspaceId option.",
      });
    }
    return await this.http.request<DeviceRegistration>(
      "POST",
      "/device-registrations",
      { workspaceId },
      this.tenancy,
    );
  }

  /** Reading lazily expires a stale pending code. */
  async get(code: string): Promise<DeviceRegistration> {
    return await this.http.request<DeviceRegistration>(
      "GET",
      `/device-registrations/${encodeURIComponent(code)}`,
      {},
      this.tenancy,
    );
  }

  /**
   * Polls `get()` until `status` leaves `pending`. Resolves on `claimed`,
   * throws `CONFLICT` on `expired`, throws `TIMEOUT` on the deadline. There are
   * no webhooks, so polling is the only option; this is the loop you would
   * otherwise write.
   */
  async waitForClaim(
    code: string,
    options: WaitForClaimOptions = {},
  ): Promise<DeviceRegistration> {
    const timeoutMs = options.timeoutMs ?? 900_000;
    const pollIntervalMs = options.pollIntervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      throwIfAborted(options.signal);
      const registration = await this.get(code);
      if (registration.status === "claimed") return registration;
      if (registration.status === "expired") {
        throw new XorgateError({
          code: "CONFLICT",
          message: `Registration code "${code}" expired before it was claimed.`,
          details: { code, expiresAt: registration.expiresAt },
        });
      }
      if (Date.now() + pollIntervalMs > deadline) {
        throw new XorgateError({
          code: "TIMEOUT",
          message:
            `Registration code "${code}" was still pending after ${timeoutMs} ms. ` +
            "The device never ran the installer, or it failed before claiming.",
          details: { code },
        });
      }
      await delay(pollIntervalMs, options.signal);
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new XorgateError({
    code: "ABORTED",
    message: "The wait was aborted by its AbortSignal.",
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(
        new XorgateError({
          code: "ABORTED",
          message: "The wait was aborted by its AbortSignal.",
        }),
      );
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
