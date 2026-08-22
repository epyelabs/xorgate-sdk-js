import { collectIoCapabilitiesIssues } from "./generated/capabilities.js";
import { XorgateError } from "./errors.js";
import type {
  DeviceModel,
  IoCapabilities,
  IoCapabilitiesResult,
  MetricName,
  StreamKey,
} from "./types.js";

/**
 * Validate an `ioCapabilities` document against the schema provisioning parses
 * with.
 *
 * The reason this exists: the API does NOT validate `ioCapabilities` on write,
 * but provisioning DOES parse it, and a document that fails that parse yields
 * zero video channels with no error raised anywhere. Live video then silently
 * never works, and the first symptom is a camera that never appears, days
 * later. The SDK runs this before every device-model write.
 */
export function validateIoCapabilities(value: unknown): IoCapabilitiesResult {
  const issues = collectIoCapabilitiesIssues(value);
  if (issues.length > 0) return { valid: false, value: null, issues };
  return { valid: true, value: value as IoCapabilities, issues: [] };
}

/** Same check, throwing `XorgateError` with code `INVALID_INPUT`. */
export function parseIoCapabilities(value: unknown): IoCapabilities {
  const result = validateIoCapabilities(value);
  if (result.valid) return result.value;
  throw new XorgateError({
    code: "INVALID_INPUT",
    message:
      `ioCapabilities is not valid (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}). ` +
      "Provisioning parses this document strictly and a failed parse yields zero video channels.",
    details: { issues: result.issues },
  });
}

/** Every stream key the model declares, in declaration order. */
export function videoStreamKeys(model: DeviceModel): StreamKey[] {
  const video = model.ioCapabilities?.media?.video;
  if (!Array.isArray(video)) return [];
  return video
    .map((v) => v?.key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
}

/**
 * Every metric name the model implies, e.g. `imu.accel_x`, `gps.lat`.
 *
 * The prefixes are the platform's, not this SDK's, and one of them is not what
 * you would guess: `comm.signal.fields` produces `lte.*` metrics, because the
 * device publishes modem statistics under the `lte` group. Both the backend's
 * `producibleMetricKeys()` and the web frontend's `signalMetrics()` agree on
 * that, and this function reproduces their composition rather than inventing a
 * third one.
 */
export function declaredMetrics(model: DeviceModel): MetricName[] {
  const caps = model.ioCapabilities;
  if (!caps) return [];
  const out: MetricName[] = [];
  const push = (name: string) => out.push(name as MetricName);

  for (const f of strings(caps.comm?.gps?.fields)) push(`gps.${f}`);
  const imu = caps.sensors?.imu;
  for (const a of strings(imu?.accel ?? imu?.axes)) push(`imu.accel_${a}`);
  for (const q of strings(imu?.quaternion)) push(`imu.quat_${q}`);
  for (const e of strings(imu?.euler)) push(`imu.euler_${e}`);
  for (const f of strings(caps.comm?.signal?.fields)) push(`lte.${f}`);
  for (const f of strings(caps.system?.fields)) push(`system.${f}`);

  return [...new Set(out)];
}

function strings(value: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
