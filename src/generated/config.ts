// GENERATED FILE - DO NOT EDIT.
// Produced by scripts/generate.mjs from vendor/config-contract.json.
// Run `npm run generate` after changing that input; `npm run check:generated`
// fails the build when this file and its input disagree.

//
// Contract version 1, wire version 1.

/**
 * IMU mounting correction (`imuMount` namespace): how the sensor is physically
 * rotated relative to the vehicle (ZYX euler, degrees). All four fields are
 * required. Applied live by the IMU collector; absent = no correction.
 */
export interface ImuMountConfig {
  /** Apply the correction. false publishes sensor-frame euler angles as-is. */
  enabled: boolean;
  /** Roll rotation of the sensor relative to the vehicle, degrees. */
  rollDeg: number;
  /** Pitch rotation of the sensor relative to the vehicle, degrees. */
  pitchDeg: number;
  /** Yaw rotation of the sensor relative to the vehicle, degrees. */
  yawDeg: number;
}

/**
 * On-device recording settings (`recording` namespace). All fields optional —
 * omitted fields fall back to device defaults. Unknown keys and out-of-range
 * values are rejected. Applied live by the agent (5 s settings poll, and forced
 * on every cloud config message); toggling video recording or changing its
 * preset briefly restarts the live stream.
 */
export interface RecordingConfig {
  telemetry?: {
    /** Record telemetry locally (default false). */
    enabled?: boolean;
    /**
     * Target sample rate. Each sensor group is additionally capped by its
     * native cadence (IMU 20 Hz, GPS 1 Hz, system 1 Hz). Default 10.
     */
    rateHz?: number;
  };
  video?: {
    /** Record camera video locally (default false). */
    enabled?: boolean;
    /** Closed quality preset table (bounded CPU cost). Default 1080p15-2mbps. */
    preset?: "1080p30-4mbps" | "1080p15-2mbps" | "720p30-2mbps" | "720p15-2mbps" | "720p15-1mbps";
    /** Segment length — the unit of upload, retry and eviction. Default 60. */
    segmentSeconds?: number;
    /**
     * Boot power staging: auto (default) defers heavy encoders at boot only
     * when the negotiated PSU budget is below bootDeferMinBudgetMa; always
     * defers every boot; off starts everything immediately.
     */
    bootDefer?: "auto" | "always" | "off";
    /** Hard cap on the boot defer in seconds. Default 90; 0 = feature off. */
    bootDeferMaxSecs?: number;
    /**
     * auto mode skips the defer when the negotiated supply budget (mA) is at or
     * above this. Default 5000 (a true 5 V/5 A PD supply).
     */
    bootDeferMinBudgetMa?: number;
    /**
     * GPS/LTE video gate: hold video (recording AND live) until the modem stops
     * converting power into value — LTE connected with a GPS fix, a declared
     * dead zone, a sustained no-signal sky, or gpsGateMaxSecs. auto (default)
     * applies it only below bootDeferMinBudgetMa; always gates every boot; off
     * disables it. Telemetry recording is never gated.
     */
    gpsGate?: "auto" | "always" | "off";
    /**
     * Give-up cap on the GPS/LTE gate in seconds. Default 600; 0 = no time cap
     * (the other release conditions still apply).
     */
    gpsGateMaxSecs?: number;
    /**
     * No-progress escape hatch for the GPS/LTE gate, in seconds. Releases the
     * gate once NEITHER a GPS fix NOR an LTE connection has arrived for this
     * long — the underground-garage case, where every other release condition
     * is blind. Cannot fire while LTE is connected (that is the
     * genuinely-acquiring case). Default 120; 0 = off, leaving only
     * gpsGateMaxSecs.
     */
    gpsGateNoProgressSecs?: number;
    /**
     * Delay between camera encoder spawns in seconds (flattens the start-up
     * power transient). Default 4; 0 = simultaneous.
     */
    spawnStaggerSecs?: number;
    /**
     * Per-camera enable keyed by stream key (e.g. {"cam1": false}). A disabled
     * camera gets no pipeline at all — no recording, no shm bridge, no live
     * stream. An absent key means enabled, so {} is every detected camera (the
     * default). Use it to match camera count to the supply (one camera on a 3 A
     * install, two on 5 A).
     */
    cameras?: Record<string, boolean>;
  };
  upload?: {
    /**
     * auto (default): drain segments to S3 whenever connected; off: keep local
     * only.
     */
    mode?: "auto" | "off";
  };
  /**
   * Runtime undervoltage + thermal load shedding: when the 5 V rail measurably
   * fails (or the SoC runs hot), the device sheds live streaming first, then
   * video recording (bridge-only), and restores in reverse with hysteresis.
   * Telemetry recording is never shed.
   */
  powerShedding?: {
    /** Master switch. Default true. */
    enabled?: boolean;
    /**
     * Shed when this many ~1 Hz samples with the CURRENT undervoltage bit land
     * within uvWindowSecs. Default 3.
     */
    uvSamples?: number;
    /** Undervoltage counting window in seconds. Default 30. */
    uvWindowSecs?: number;
    /**
     * Alternative trigger: 5 V rail below this, sustained railLowSecs. Default
     * 4.85.
     */
    railLowVolts?: number;
    /** How long the rail must stay below railLowVolts to trigger. Default 15. */
    railLowSecs?: number;
    /**
     * Trailing window (seconds) evaluated for escalation to the next rung
     * (no-live → bridge-only). Default 60.
     */
    escalateDwellSecs?: number;
    /**
     * Escalate when the supply was bad (shed trigger, or an individual
     * undervoltage/low-rail sample) for at least this percentage of the
     * trailing escalateDwellSecs window. Default 70; 100 requires a
     * continuously bad supply, which a noisy rail never provides.
     */
    escalateDutyPct?: number;
    /**
     * Thermal arm trigger: shed live streaming once the SoC has been at/above
     * this for cpuTempSecs. Default 80 (5 °C below the Pi hard throttle).
     */
    cpuTempC?: number;
    /**
     * Thermal restore threshold: the SoC must be below this for the restore
     * timer to run. Default 70 (a 10 °C anti-flap margin).
     */
    cpuTempRestoreC?: number;
    /** How long the SoC must hold at/above cpuTempC to arm the shed. Default 15. */
    cpuTempSecs?: number;
    /**
     * Clean interval (zero undervoltage samples, rail at/above
     * railRestoreVolts) required to restore one rung. Default 120.
     */
    restoreSecs?: number;
    /** Rail must be at/above this for a sample to count as clean. Default 4.95. */
    railRestoreVolts?: number;
    /**
     * Shed cycles per rolling hour before the device parks at its shed level
     * (no auto-restore until reboot or a settings change). Default 4.
     */
    maxShedsPerHour?: number;
  };
  retention?: {
    /**
     * Local recordings quota in bytes (oldest segments evicted first). Default
     * 10 GiB.
     */
    maxBytes?: number;
    /**
     * Free-disk floor in bytes; recording evicts/stops before crossing it.
     * Default 2 GiB.
     */
    minFreeBytes?: number;
  };
}

/**
 * LTE recovery policy (`lteRecovery` namespace): how aggressively the device
 * connection manager may use the GNSS-destructive full modem reset. Both fields
 * optional; omitted fields fall back to the device defaults. Read live by the
 * modem daemon at its next recovery decision — no device restart.
 */
export interface LteRecoveryConfig {
  /**
   * With a live GPS fix: "defer" (default) allows a modem reset only after 30+
   * min of unusable LTE; "veto-deadzone" additionally never resets while parked
   * in a dead zone.
   */
  gpsFixResetPolicy?: "defer" | "veto-deadzone";
  /**
   * Dead-zone recovery pacing: conservative (nudge every 15-120 min, never
   * resets), balanced (default; 10-60 min, reset only after 3 failed radio
   * cycles), aggressive (10-20 min, reset after 1 failed cycle).
   */
  deadZoneProfile?: "conservative" | "balanced" | "aggressive";
}

/**
 * Offline time sources (`timeSync` namespace): while NTP is unsynced this boot,
 * the agent may step the system clock from GPS (valid GNSS fix) or the modem
 * NITZ clock, then stand down for the boot once NTP synchronizes. All fields
 * optional; omitted fields fall back to the device defaults.
 */
export interface TimeSyncConfig {
  /**
   * Kill switch: false disables GPS/NITZ clock stepping entirely (device
   * default: true).
   */
  offlineSources?: boolean;
  /**
   * Step only when the measured clock offset exceeds this many seconds (device
   * default 10). A battery-backed RTC boots inside the threshold, making the
   * feature a natural no-op.
   */
  stepThresholdSecs?: number;
  /**
   * Hard cap on clock steps per boot (device default 4; bounds a flapping
   * source).
   */
  maxStepsPerBoot?: number;
}

/**
 * Cellular data-context settings (`cellular` namespace). `apn` empty or absent
 * leaves the modem's stored APN untouched (the safe default). A non-empty APN
 * is applied by the modem daemon with apply-and-confirm rollback: real traffic
 * must flow over the modem interface within a bounded window or the previous
 * APN is restored automatically. Read live from settings.json by the modem
 * daemon — never restart it to apply a setting.
 */
export interface CellularConfig {
  /**
   * Access Point Name for the cellular data context. EMPTY or ABSENT leaves the
   * modem's stored APN untouched — the safe default for every existing device.
   * A change is applied with confirm-and-rollback: the device proves real data
   * flows over the new APN within a bounded window, or restores the previous
   * one by itself.
   */
  apn?: string;
}

/**
 * Camera mounting rotation (`cameraMount` namespace): per-camera 0/180 applied
 * at the image sensor via the camera overlay in /boot/firmware/config.txt, so
 * live video, recordings, replays and workflow frames are all corrected at zero
 * CPU cost. ⚠️ Applies on the NEXT BOOT: the agent edits the boot config and
 * reports the namespace with a `rebootRequired` detail; it never reboots the
 * device itself. An absent camera key is unmanaged (the boot config is left as
 * found); an explicit `rotationDeg: 0` forces that camera upright.
 */
export interface CameraMountConfig {
  /**
   * Per-camera mounting rotation keyed by stream key, e.g. {"cam0":
   * {"rotationDeg": 180}}. An ABSENT key is UNMANAGED: the device leaves that
   * camera's boot config exactly as it found it. Send an explicit
   * {"rotationDeg": 0} to take a camera over and force it upright. Takes effect
   * on the next boot — the device reports `rebootRequired` and never reboots
   * itself.
   */
  cameras: Record<string, {
    /**
     * Rotation applied at the sensor, degrees. 180 = the camera is mounted
     * upside down, so the sensor flips H+V and every consumer (live WebRTC,
     * recorded MP4s, replays, workflow frames) sees an upright image with no
     * added CPU. Only 0 and 180 exist — the camera overlay parameter has no
     * 90/270.
     */
    rotationDeg: 0 | 180;
  }>;
}

/**
 * One key per config namespace, all optional. A namespace is either configured
 * or absent: the API strips cleared namespaces, so nothing is ever
 * present-but-null on read. Writing `null` is what clears one.
 */
export interface DeviceConfig {
  /**
   * GPS antenna bias (`gnssAntBias`): true powers an active antenna over the
   * coax, false (default) is the passive/bias-off hardware-safe state.
   */
  gnssAntBias?: boolean;
  /**
   * IMU mounting correction (`imuMount` namespace): how the sensor is
   * physically rotated relative to the vehicle (ZYX euler, degrees). All four
   * fields are required. Applied live by the IMU collector; absent = no
   * correction.
   */
  imuMount?: ImuMountConfig;
  /**
   * On-device recording settings (`recording` namespace). All fields optional —
   * omitted fields fall back to device defaults. Unknown keys and out-of-range
   * values are rejected. Applied live by the agent (5 s settings poll, and
   * forced on every cloud config message); toggling video recording or changing
   * its preset briefly restarts the live stream.
   */
  recording?: RecordingConfig;
  /**
   * LTE recovery policy (`lteRecovery` namespace): how aggressively the device
   * connection manager may use the GNSS-destructive full modem reset. Both
   * fields optional; omitted fields fall back to the device defaults. Read live
   * by the modem daemon at its next recovery decision — no device restart.
   */
  lteRecovery?: LteRecoveryConfig;
  /**
   * Offline time sources (`timeSync` namespace): while NTP is unsynced this
   * boot, the agent may step the system clock from GPS (valid GNSS fix) or the
   * modem NITZ clock, then stand down for the boot once NTP synchronizes. All
   * fields optional; omitted fields fall back to the device defaults.
   */
  timeSync?: TimeSyncConfig;
  /**
   * Cellular data-context settings (`cellular` namespace). `apn` empty or
   * absent leaves the modem's stored APN untouched (the safe default). A
   * non-empty APN is applied by the modem daemon with apply-and-confirm
   * rollback: real traffic must flow over the modem interface within a bounded
   * window or the previous APN is restored automatically. Read live from
   * settings.json by the modem daemon — never restart it to apply a setting.
   */
  cellular?: CellularConfig;
  /**
   * Camera mounting rotation (`cameraMount` namespace): per-camera 0/180
   * applied at the image sensor via the camera overlay in
   * /boot/firmware/config.txt, so live video, recordings, replays and workflow
   * frames are all corrected at zero CPU cost. ⚠️ Applies on the NEXT BOOT: the
   * agent edits the boot config and reports the namespace with a
   * `rebootRequired` detail; it never reboots the device itself. An absent
   * camera key is unmanaged (the boot config is left as found); an explicit
   * `rotationDeg: 0` forces that camera upright.
   */
  cameraMount?: CameraMountConfig;
}

/** Every namespace replaced WHOLE. `null` reverts it to the device defaults. */
export type DeviceConfigPatch = {
  [K in keyof DeviceConfig]?: DeviceConfig[K] | null;
};

/** The namespace keys, in contract order. */
export const CONFIG_NAMESPACES = ["gnssAntBias", "imuMount", "recording", "lteRecovery", "timeSync", "cellular", "cameraMount"] as const;

/** Cloud-only presentation preferences. Never delivered to the device. */
export interface DeviceUiPrefs {
  /**
   * Layout for the Active Streams tab: card grid (default) or location-first
   * map view.
   */
  activeStreamsViewType?: "card" | "map";
  imuView?: {
    /** Camera azimuth for the 3D orientation view, degrees. */
    azimuthDeg: number;
    /**
     * Camera elevation for the 3D orientation view, degrees. Bounded to ±85: at
     * the poles the look-at up-vector degenerates and the view flips.
     */
    elevationDeg: number;
  };
}

export type DeviceUiPrefsPatch = {
  [K in keyof DeviceUiPrefs]?: DeviceUiPrefs[K] | null;
};
