import { test } from "node:test";
import assert from "node:assert/strict";
import {
  declaredMetrics,
  isXorgateError,
  parseIoCapabilities,
  validateIoCapabilities,
  videoStreamKeys,
} from "../src/index.js";
import type { DeviceModel, IoCapabilities } from "../src/index.js";

/** The production bench Pi's model, near enough. */
const PI: IoCapabilities = {
  schemaVersion: 1,
  media: {
    video: [
      { key: "cam0", codec: "h264", maxWidth: 1920, maxHeight: 1080, maxFps: 30 },
      { key: "cam1", codec: "h264", maxWidth: 1920, maxHeight: 1080, maxFps: 30 },
    ],
  },
  sensors: {
    imu: { accel: ["x", "y", "z"], euler: ["roll", "pitch", "yaw"], unit: "m/s^2", rateHz: 10 },
  },
  comm: {
    module: "4g-lte",
    gps: { fields: ["lat", "lon", "alt", "speed", "course"] },
    signal: { fields: ["rssi", "rsrp", "rsrq"] },
  },
  system: { fields: ["cpu_temp", "cpu_usage", "ram_usage"] },
};

function model(caps: unknown): DeviceModel {
  return {
    id: "dm-1",
    name: "Pi",
    sku: "XG-CM5-DUAL",
    ioCapabilities: caps as IoCapabilities | null,
    firmwareChannel: null,
    createdAt: "t",
    updatedAt: "t",
  };
}

test("a complete document validates", () => {
  const result = validateIoCapabilities(PI);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("every section is optional, so partial hardware validates too", () => {
  assert.equal(validateIoCapabilities({ schemaVersion: 1 }).valid, true);
  assert.equal(
    validateIoCapabilities({ schemaVersion: 1, comm: { gps: { fields: [] } } }).valid,
    true,
  );
});

test("the failure that costs you every camera: a video entry with no codec", () => {
  const result = validateIoCapabilities({
    schemaVersion: 1,
    media: { video: [{ key: "cam0" }] },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [{ path: "media.video[0].codec", message: "Required" }]);
});

test("schemaVersion is a literal 1, not any number", () => {
  assert.equal(validateIoCapabilities({ schemaVersion: 2 }).valid, false);
  assert.equal(validateIoCapabilities({}).valid, false);
  assert.equal(validateIoCapabilities(null).valid, false);
  assert.equal(validateIoCapabilities("nonsense").valid, false);
});

test("issue paths point at the exact element, so a form can highlight it", () => {
  const result = validateIoCapabilities({
    schemaVersion: 1,
    media: {
      video: [
        { key: "cam0", codec: "h264" },
        { key: "cam1", codec: 42, maxFps: -1 },
      ],
      audio: [{ key: "audio0" }],
    },
    sensors: { imu: { accel: ["x", 7] } },
  });
  assert.equal(result.valid, false);
  const paths = result.issues.map((i) => i.path);
  assert.ok(paths.includes("media.video[1].codec"));
  assert.ok(paths.includes("media.video[1].maxFps"));
  assert.ok(paths.includes("media.audio[0].codec"));
  assert.ok(paths.includes("sensors.imu.accel[1]"));
});

test("numeric bounds are checked: maxWidth must be a positive integer", () => {
  const fractional = validateIoCapabilities({
    schemaVersion: 1,
    media: { video: [{ key: "cam0", codec: "h264", maxWidth: 1920.5 }] },
  });
  assert.equal(fractional.valid, false);
  assert.equal(fractional.issues[0]!.message, "Expected an integer");

  const zero = validateIoCapabilities({
    schemaVersion: 1,
    media: { video: [{ key: "cam0", codec: "h264", maxHeight: 0 }] },
  });
  assert.equal(zero.valid, false);
  assert.equal(zero.issues[0]!.message, "Expected a positive number");
});

test("parseIoCapabilities throws INVALID_INPUT with the issue list attached", () => {
  assert.throws(
    () => parseIoCapabilities({ schemaVersion: 1, media: { video: [{ key: "cam0" }] } }),
    (e: unknown) => {
      assert.ok(isXorgateError(e));
      assert.equal(e.code, "INVALID_INPUT");
      assert.equal(e.status, undefined);
      assert.equal((e.details!["issues"] as unknown[]).length, 1);
      return true;
    },
  );
  assert.equal(parseIoCapabilities(PI).schemaVersion, 1);
});

test("videoStreamKeys returns declaration order", () => {
  assert.deepEqual(videoStreamKeys(model(PI)), ["cam0", "cam1"]);
  assert.deepEqual(videoStreamKeys(model(null)), []);
  assert.deepEqual(videoStreamKeys(model({ schemaVersion: 1 })), []);
});

test("declaredMetrics uses the platform's prefixes, including lte for comm.signal", () => {
  const metrics = declaredMetrics(model(PI));
  assert.ok(metrics.includes("gps.lat"));
  assert.ok(metrics.includes("imu.accel_x"));
  assert.ok(metrics.includes("imu.euler_roll"));
  assert.ok(metrics.includes("system.cpu_temp"));
  // comm.signal.fields produce `lte.*`, not `signal.*`: the device publishes
  // modem statistics under the lte group, and both the backend's
  // producibleMetricKeys() and the web frontend's signalMetrics() agree.
  assert.ok(metrics.includes("lte.rssi"));
  assert.ok(!metrics.includes("signal.rssi"));
});

test("declaredMetrics honours the legacy `axes` alias for accel", () => {
  const legacy = declaredMetrics(model({ schemaVersion: 1, sensors: { imu: { axes: ["x", "y"] } } }));
  assert.deepEqual(legacy, ["imu.accel_x", "imu.accel_y"]);
});

test("declaredMetrics is empty for a model that declares nothing", () => {
  assert.deepEqual(declaredMetrics(model(null)), []);
  assert.deepEqual(declaredMetrics(model({ schemaVersion: 1 })), []);
});
