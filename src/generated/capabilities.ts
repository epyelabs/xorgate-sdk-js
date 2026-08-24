// GENERATED FILE - DO NOT EDIT.
// Produced by scripts/generate.mjs from vendor/io-capabilities.schema.json.
// Run `npm run generate` after changing that input; `npm run check:generated`
// fails the build when this file and its input disagree.

//
// Why this exists: the API does NOT validate `ioCapabilities` on write, but
// provisioning DOES parse it, and a document that fails that parse yields zero
// video channels with no error raised anywhere. Live video then silently never
// works. Shipping zod to check it would cost this package its zero-dependency
// guarantee, so the same checks are emitted as plain code instead.

import type { IoCapabilitiesIssue } from "../types.js";

type Push = (path: string, message: string) => void;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkFieldList(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_fields = path ? `${path}.fields` : "fields";
  if (value["fields"] === undefined || value["fields"] === null) {
    push(p_fields, "Required");
  } else {
    if (!Array.isArray(value["fields"])) push(p_fields, "Expected an array");
    else {
      const arr = value["fields"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_fields}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
}

function checkVideoCapability(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_key = path ? `${path}.key` : "key";
  if (value["key"] === undefined || value["key"] === null) {
    push(p_key, "Required");
  } else {
    if (typeof value["key"] !== "string") push(p_key, "Expected a string");
  }
  const p_codec = path ? `${path}.codec` : "codec";
  if (value["codec"] === undefined || value["codec"] === null) {
    push(p_codec, "Required");
  } else {
    if (typeof value["codec"] !== "string") push(p_codec, "Expected a string");
  }
  const p_maxWidth = path ? `${path}.maxWidth` : "maxWidth";
  if (value["maxWidth"] === undefined || value["maxWidth"] === null) {
    /* optional */
  } else {
    if (typeof value["maxWidth"] !== "number" || !Number.isFinite(value["maxWidth"])) push(p_maxWidth, "Expected a number");
    else if (!Number.isInteger(value["maxWidth"])) push(p_maxWidth, "Expected an integer");
    else if ((value["maxWidth"] as number) <= 0) push(p_maxWidth, "Expected a positive number");
  }
  const p_maxHeight = path ? `${path}.maxHeight` : "maxHeight";
  if (value["maxHeight"] === undefined || value["maxHeight"] === null) {
    /* optional */
  } else {
    if (typeof value["maxHeight"] !== "number" || !Number.isFinite(value["maxHeight"])) push(p_maxHeight, "Expected a number");
    else if (!Number.isInteger(value["maxHeight"])) push(p_maxHeight, "Expected an integer");
    else if ((value["maxHeight"] as number) <= 0) push(p_maxHeight, "Expected a positive number");
  }
  const p_maxFps = path ? `${path}.maxFps` : "maxFps";
  if (value["maxFps"] === undefined || value["maxFps"] === null) {
    /* optional */
  } else {
    if (typeof value["maxFps"] !== "number" || !Number.isFinite(value["maxFps"])) push(p_maxFps, "Expected a number");
    else if ((value["maxFps"] as number) <= 0) push(p_maxFps, "Expected a positive number");
  }
  const p_label = path ? `${path}.label` : "label";
  if (value["label"] === undefined || value["label"] === null) {
    /* optional */
  } else {
    if (typeof value["label"] !== "string") push(p_label, "Expected a string");
  }
}

function checkVideoCapabilityV2(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_key = path ? `${path}.key` : "key";
  if (value["key"] === undefined || value["key"] === null) {
    push(p_key, "Required");
  } else {
    if (typeof value["key"] !== "string") push(p_key, "Expected a string");
  }
  const p_codec = path ? `${path}.codec` : "codec";
  if (value["codec"] === undefined || value["codec"] === null) {
    push(p_codec, "Required");
  } else {
    if (typeof value["codec"] !== "string") push(p_codec, "Expected a string");
  }
  const p_connector = path ? `${path}.connector` : "connector";
  if (value["connector"] === undefined || value["connector"] === null) {
    push(p_connector, "Required");
  } else {
    if (typeof value["connector"] !== "string") push(p_connector, "Expected a string");
  }
  const p_sensor = path ? `${path}.sensor` : "sensor";
  if (value["sensor"] === undefined || value["sensor"] === null) {
    push(p_sensor, "Required");
  } else {
    if (typeof value["sensor"] !== "string") push(p_sensor, "Expected a string");
  }
  const p_maxWidth = path ? `${path}.maxWidth` : "maxWidth";
  if (value["maxWidth"] === undefined || value["maxWidth"] === null) {
    /* optional */
  } else {
    if (typeof value["maxWidth"] !== "number" || !Number.isFinite(value["maxWidth"])) push(p_maxWidth, "Expected a number");
    else if (!Number.isInteger(value["maxWidth"])) push(p_maxWidth, "Expected an integer");
    else if ((value["maxWidth"] as number) <= 0) push(p_maxWidth, "Expected a positive number");
  }
  const p_maxHeight = path ? `${path}.maxHeight` : "maxHeight";
  if (value["maxHeight"] === undefined || value["maxHeight"] === null) {
    /* optional */
  } else {
    if (typeof value["maxHeight"] !== "number" || !Number.isFinite(value["maxHeight"])) push(p_maxHeight, "Expected a number");
    else if (!Number.isInteger(value["maxHeight"])) push(p_maxHeight, "Expected an integer");
    else if ((value["maxHeight"] as number) <= 0) push(p_maxHeight, "Expected a positive number");
  }
  const p_maxFps = path ? `${path}.maxFps` : "maxFps";
  if (value["maxFps"] === undefined || value["maxFps"] === null) {
    /* optional */
  } else {
    if (typeof value["maxFps"] !== "number" || !Number.isFinite(value["maxFps"])) push(p_maxFps, "Expected a number");
    else if ((value["maxFps"] as number) <= 0) push(p_maxFps, "Expected a positive number");
  }
  const p_label = path ? `${path}.label` : "label";
  if (value["label"] === undefined || value["label"] === null) {
    /* optional */
  } else {
    if (typeof value["label"] !== "string") push(p_label, "Expected a string");
  }
}

function checkAudioCapability(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_key = path ? `${path}.key` : "key";
  if (value["key"] === undefined || value["key"] === null) {
    push(p_key, "Required");
  } else {
    if (typeof value["key"] !== "string") push(p_key, "Expected a string");
  }
  const p_codec = path ? `${path}.codec` : "codec";
  if (value["codec"] === undefined || value["codec"] === null) {
    push(p_codec, "Required");
  } else {
    if (typeof value["codec"] !== "string") push(p_codec, "Expected a string");
  }
  const p_sampleRate = path ? `${path}.sampleRate` : "sampleRate";
  if (value["sampleRate"] === undefined || value["sampleRate"] === null) {
    /* optional */
  } else {
    if (typeof value["sampleRate"] !== "number" || !Number.isFinite(value["sampleRate"])) push(p_sampleRate, "Expected a number");
    else if (!Number.isInteger(value["sampleRate"])) push(p_sampleRate, "Expected an integer");
    else if ((value["sampleRate"] as number) <= 0) push(p_sampleRate, "Expected a positive number");
  }
  const p_channels = path ? `${path}.channels` : "channels";
  if (value["channels"] === undefined || value["channels"] === null) {
    /* optional */
  } else {
    if (typeof value["channels"] !== "number" || !Number.isFinite(value["channels"])) push(p_channels, "Expected a number");
    else if (!Number.isInteger(value["channels"])) push(p_channels, "Expected an integer");
    else if ((value["channels"] as number) <= 0) push(p_channels, "Expected a positive number");
  }
}

function checkImuCapability(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_axes = path ? `${path}.axes` : "axes";
  if (value["axes"] === undefined || value["axes"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["axes"])) push(p_axes, "Expected an array");
    else {
      const arr = value["axes"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_axes}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_accel = path ? `${path}.accel` : "accel";
  if (value["accel"] === undefined || value["accel"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["accel"])) push(p_accel, "Expected an array");
    else {
      const arr = value["accel"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_accel}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_quaternion = path ? `${path}.quaternion` : "quaternion";
  if (value["quaternion"] === undefined || value["quaternion"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["quaternion"])) push(p_quaternion, "Expected an array");
    else {
      const arr = value["quaternion"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_quaternion}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_euler = path ? `${path}.euler` : "euler";
  if (value["euler"] === undefined || value["euler"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["euler"])) push(p_euler, "Expected an array");
    else {
      const arr = value["euler"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_euler}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_unit = path ? `${path}.unit` : "unit";
  if (value["unit"] === undefined || value["unit"] === null) {
    /* optional */
  } else {
    if (typeof value["unit"] !== "string") push(p_unit, "Expected a string");
  }
  const p_rateHz = path ? `${path}.rateHz` : "rateHz";
  if (value["rateHz"] === undefined || value["rateHz"] === null) {
    /* optional */
  } else {
    if (typeof value["rateHz"] !== "number" || !Number.isFinite(value["rateHz"])) push(p_rateHz, "Expected a number");
    else if ((value["rateHz"] as number) <= 0) push(p_rateHz, "Expected a positive number");
  }
}

function checkImuCapabilityV2(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_model = path ? `${path}.model` : "model";
  if (value["model"] === undefined || value["model"] === null) {
    /* optional */
  } else {
    if (typeof value["model"] !== "string") push(p_model, "Expected a string");
  }
  const p_axes = path ? `${path}.axes` : "axes";
  if (value["axes"] === undefined || value["axes"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["axes"])) push(p_axes, "Expected an array");
    else {
      const arr = value["axes"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_axes}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_accel = path ? `${path}.accel` : "accel";
  if (value["accel"] === undefined || value["accel"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["accel"])) push(p_accel, "Expected an array");
    else {
      const arr = value["accel"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_accel}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_quaternion = path ? `${path}.quaternion` : "quaternion";
  if (value["quaternion"] === undefined || value["quaternion"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["quaternion"])) push(p_quaternion, "Expected an array");
    else {
      const arr = value["quaternion"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_quaternion}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_euler = path ? `${path}.euler` : "euler";
  if (value["euler"] === undefined || value["euler"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["euler"])) push(p_euler, "Expected an array");
    else {
      const arr = value["euler"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_euler}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
  const p_unit = path ? `${path}.unit` : "unit";
  if (value["unit"] === undefined || value["unit"] === null) {
    /* optional */
  } else {
    if (typeof value["unit"] !== "string") push(p_unit, "Expected a string");
  }
  const p_rateHz = path ? `${path}.rateHz` : "rateHz";
  if (value["rateHz"] === undefined || value["rateHz"] === null) {
    /* optional */
  } else {
    if (typeof value["rateHz"] !== "number" || !Number.isFinite(value["rateHz"])) push(p_rateHz, "Expected a number");
    else if ((value["rateHz"] as number) <= 0) push(p_rateHz, "Expected a positive number");
  }
}

function checkStatusLed(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_r = path ? `${path}.r` : "r";
  if (value["r"] === undefined || value["r"] === null) {
    push(p_r, "Required");
  } else {
    if (typeof value["r"] !== "number" || !Number.isFinite(value["r"])) push(p_r, "Expected a number");
    else if (!Number.isInteger(value["r"])) push(p_r, "Expected an integer");
    else if ((value["r"] as number) < 0) push(p_r, "Expected a non-negative number");
  }
  const p_g = path ? `${path}.g` : "g";
  if (value["g"] === undefined || value["g"] === null) {
    push(p_g, "Required");
  } else {
    if (typeof value["g"] !== "number" || !Number.isFinite(value["g"])) push(p_g, "Expected a number");
    else if (!Number.isInteger(value["g"])) push(p_g, "Expected an integer");
    else if ((value["g"] as number) < 0) push(p_g, "Expected a non-negative number");
  }
  const p_b = path ? `${path}.b` : "b";
  if (value["b"] === undefined || value["b"] === null) {
    push(p_b, "Required");
  } else {
    if (typeof value["b"] !== "number" || !Number.isFinite(value["b"])) push(p_b, "Expected a number");
    else if (!Number.isInteger(value["b"])) push(p_b, "Expected an integer");
    else if ((value["b"] as number) < 0) push(p_b, "Expected a non-negative number");
  }
}

function checkSystemCapabilitiesV2(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_platform = path ? `${path}.platform` : "platform";
  if (value["platform"] === undefined || value["platform"] === null) {
    push(p_platform, "Required");
  } else {
    if (!["rpi-cm5", "rpi-cm4"].includes(value["platform"] as string)) push(p_platform, "Expected one of: rpi-cm5, rpi-cm4");
  }
  const p_encoder = path ? `${path}.encoder` : "encoder";
  if (value["encoder"] === undefined || value["encoder"] === null) {
    /* optional */
  } else {
    if (!["sw-h264", "hw-h264"].includes(value["encoder"] as string)) push(p_encoder, "Expected one of: sw-h264, hw-h264");
  }
  const p_rails = path ? `${path}.rails` : "rails";
  if (value["rails"] === undefined || value["rails"] === null) {
    /* optional */
  } else {
    if (typeof value["rails"] !== "boolean") push(p_rails, "Expected a boolean");
  }
  const p_statusLed = path ? `${path}.statusLed` : "statusLed";
  if (value["statusLed"] === undefined || value["statusLed"] === null) {
    /* optional */
  } else {
    checkStatusLed(value["statusLed"], p_statusLed, push);
  }
  const p_fields = path ? `${path}.fields` : "fields";
  if (value["fields"] === undefined || value["fields"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["fields"])) push(p_fields, "Expected an array");
    else {
      const arr = value["fields"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_fields}[${i}]`;
        if (typeof arr[i] !== "string") push(itemPath, "Expected a string");
      }
    }
  }
}

function checkMediaCapabilities(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_video = path ? `${path}.video` : "video";
  if (value["video"] === undefined || value["video"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["video"])) push(p_video, "Expected an array");
    else {
      const arr = value["video"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_video}[${i}]`;
        checkVideoCapability(arr[i], itemPath, push);
      }
    }
  }
  const p_audio = path ? `${path}.audio` : "audio";
  if (value["audio"] === undefined || value["audio"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["audio"])) push(p_audio, "Expected an array");
    else {
      const arr = value["audio"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_audio}[${i}]`;
        checkAudioCapability(arr[i], itemPath, push);
      }
    }
  }
}

function checkMediaCapabilitiesV2(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_video = path ? `${path}.video` : "video";
  if (value["video"] === undefined || value["video"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["video"])) push(p_video, "Expected an array");
    else {
      const arr = value["video"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_video}[${i}]`;
        checkVideoCapabilityV2(arr[i], itemPath, push);
      }
    }
  }
  const p_audio = path ? `${path}.audio` : "audio";
  if (value["audio"] === undefined || value["audio"] === null) {
    /* optional */
  } else {
    if (!Array.isArray(value["audio"])) push(p_audio, "Expected an array");
    else {
      const arr = value["audio"] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemPath = `${p_audio}[${i}]`;
        checkAudioCapability(arr[i], itemPath, push);
      }
    }
  }
}

function checkSensorsCapabilities(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_imu = path ? `${path}.imu` : "imu";
  if (value["imu"] === undefined || value["imu"] === null) {
    /* optional */
  } else {
    checkImuCapability(value["imu"], p_imu, push);
  }
}

function checkSensorsCapabilitiesV2(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_imu = path ? `${path}.imu` : "imu";
  if (value["imu"] === undefined || value["imu"] === null) {
    /* optional */
  } else {
    checkImuCapabilityV2(value["imu"], p_imu, push);
  }
}

function checkCommCapabilities(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_module = path ? `${path}.module` : "module";
  if (value["module"] === undefined || value["module"] === null) {
    /* optional */
  } else {
    if (typeof value["module"] !== "string") push(p_module, "Expected a string");
  }
  const p_gps = path ? `${path}.gps` : "gps";
  if (value["gps"] === undefined || value["gps"] === null) {
    /* optional */
  } else {
    checkFieldList(value["gps"], p_gps, push);
  }
  const p_signal = path ? `${path}.signal` : "signal";
  if (value["signal"] === undefined || value["signal"] === null) {
    /* optional */
  } else {
    checkFieldList(value["signal"], p_signal, push);
  }
}

function checkIoCapabilitiesV1(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_schemaVersion = path ? `${path}.schemaVersion` : "schemaVersion";
  if (value["schemaVersion"] === undefined || value["schemaVersion"] === null) {
    push(p_schemaVersion, "Required");
  } else {
    if (value["schemaVersion"] !== 1) push(p_schemaVersion, "Expected 1");
  }
  const p_media = path ? `${path}.media` : "media";
  if (value["media"] === undefined || value["media"] === null) {
    /* optional */
  } else {
    checkMediaCapabilities(value["media"], p_media, push);
  }
  const p_sensors = path ? `${path}.sensors` : "sensors";
  if (value["sensors"] === undefined || value["sensors"] === null) {
    /* optional */
  } else {
    checkSensorsCapabilities(value["sensors"], p_sensors, push);
  }
  const p_comm = path ? `${path}.comm` : "comm";
  if (value["comm"] === undefined || value["comm"] === null) {
    /* optional */
  } else {
    checkCommCapabilities(value["comm"], p_comm, push);
  }
  const p_system = path ? `${path}.system` : "system";
  if (value["system"] === undefined || value["system"] === null) {
    /* optional */
  } else {
    checkFieldList(value["system"], p_system, push);
  }
}

function checkIoCapabilitiesV2(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_schemaVersion = path ? `${path}.schemaVersion` : "schemaVersion";
  if (value["schemaVersion"] === undefined || value["schemaVersion"] === null) {
    push(p_schemaVersion, "Required");
  } else {
    if (value["schemaVersion"] !== 2) push(p_schemaVersion, "Expected 2");
  }
  const p_media = path ? `${path}.media` : "media";
  if (value["media"] === undefined || value["media"] === null) {
    /* optional */
  } else {
    checkMediaCapabilitiesV2(value["media"], p_media, push);
  }
  const p_sensors = path ? `${path}.sensors` : "sensors";
  if (value["sensors"] === undefined || value["sensors"] === null) {
    /* optional */
  } else {
    checkSensorsCapabilitiesV2(value["sensors"], p_sensors, push);
  }
  const p_comm = path ? `${path}.comm` : "comm";
  if (value["comm"] === undefined || value["comm"] === null) {
    /* optional */
  } else {
    checkCommCapabilities(value["comm"], p_comm, push);
  }
  const p_system = path ? `${path}.system` : "system";
  if (value["system"] === undefined || value["system"] === null) {
    push(p_system, "Required");
  } else {
    checkSystemCapabilitiesV2(value["system"], p_system, push);
  }
}

function checkIoCapabilities(value: unknown, path: string, push: Push): void {
  if (!isRecord(value)) {
    push(path || "(root)", "Expected an object");
    return;
  }
  const p_schemaVersion = path ? `${path}.schemaVersion` : "schemaVersion";
  if (value["schemaVersion"] === 1) return checkIoCapabilitiesV1(value, path, push);
  if (value["schemaVersion"] === 2) return checkIoCapabilitiesV2(value, path, push);
  push(p_schemaVersion, "Expected schemaVersion 1 or 2");
}

/** Runs every check. Returns the issues found, in document order. */
export function collectIoCapabilitiesIssues(value: unknown): IoCapabilitiesIssue[] {
  const issues: IoCapabilitiesIssue[] = [];
  const push: Push = (path, message) => issues.push({ path, message });
  checkIoCapabilities(value, "", push);
  return issues;
}
