# Changelog

All notable changes to `@xorgate/sdk`. This project follows
[semantic versioning](https://semver.org/).

## 0.8.0

Recorded telemetry as session artifacts (API 0.9.0). Purely additive: an older
server never sends the new field, and nothing that worked before behaves
differently.

### Added

- **`ReplayManifest.telemetry?: ReplayTelemetry`** — the recorded-telemetry
  sessions overlapping the replay window, each with a presigned `overview.v1`
  artifact (route line and scrub preview for every metric, gzipped columnar
  JSON, typically 15 to 40 KB), its raw 60 s segments clipped to the window,
  and the session's `insights`. Every URL shares `urlExpiresAt` with the video
  URLs. `overview` is `null` while the session is `open`; build one from
  `segments` and refetch the manifest about every 60 s until it closes. The
  block has its own cap of 1,500 segments, reported through `truncated`
  rather than a 400. It is **optional on the type** because a server older
  than API 0.9.0 never sends it: fall back to `telemetry.history()` when it
  is absent.
- **`replayManifest(id, { ..., telemetry: false })`** — asks the server to omit
  the block (sent as `telemetry=0`; nothing is sent otherwise).
- **`telemetry.sessions.list(deviceId, { from, to, status, limit, offset })`**,
  plus `iterate()` and `listAll()` — the recorded-telemetry session index with
  counters and `insights`, paginated (`limit` 1 to 200, default 25), no URLs.
  `from`/`to` match sessions OVERLAPPING the range, like
  `media.sessions.list()`, so a recording run's distance is the sum over the
  sessions returned for the run's window. `insights` is `null` until the
  session's overview has been built.
- Types: `ReplayTelemetry`, `ReplayTelemetrySession`, `ReplayTelemetryOverview`,
  `ReplayTelemetrySegment`, `TelemetryInsights` (known v1 summaries typed,
  index signature for insights added later, `{ value: null, reason }` where
  one could not be computed), `TelemetryInsightEvent`,
  `TelemetryInsightNotComputable`, `TelemetrySession`,
  `ListTelemetrySessionsParams`.

## 0.7.0

Device transfer: moving a device to another workspace, and handing one to
another organization. Purely additive — nothing that worked before behaves
differently.

The operation this models was performed by hand four times in production on
2026-09-18 and the first attempt caused a ~50-minute outage, so the doc comments
on these methods carry more warning than usual. They are worth reading before
calling them.

### Added

- **`devices.transfer(id, { workspaceId, organizationId? })`** — move a device.
  `organizationId` opens the both-membership fast path: the caller must hold
  `owner` or `admin` in the destination organization *as a user*, so an API key
  is refused with 403 and should mint an offer instead.

  Two things the return value says that a bare 200 does not.
  `transfer.scopeAttributes === "failed"` is a **degraded success** — the device
  moved and was told its new telemetry topic, but the broker was not told to
  allow it, so it falls back to the still-ingested legacy plane and any
  workspace-scoped vended credential sees nothing until a settings save
  re-asserts the attributes. And `transfer.adoption` has **three** values:
  `"confirmed"`, `"pending"` and `"unknown"`, the last meaning the device has
  never reported a telemetry scope at all (its agent predates `v0.0.6`). Do not
  collapse it into either of the others, and note that `"pending"` immediately
  after a transfer is normal rather than a failure.

  **A transfer does not touch the device**, so it does not have to be online:
  certificates and identity never change and the tenancy is never persisted on
  the box. Never gate a transfer on `device.status`.

- **`devices.previewTransfer(id, { workspaceId, organizationId? })`** — the dry
  run behind a confirmation dialog. Blockers (`SAME_WORKSPACE`,
  `SERIAL_COLLISION`, `TRANSFER_IN_PROGRESS`) are **returned rather than
  thrown**, so the dialog can explain a refusal without provoking it.
  `carriesHistory` is always literally `true` and is meant to be rendered: all
  historical telemetry and all recorded footage travel with the device, which
  across organizations is a data-disclosure event.

- **`devices.transferMany(ids, input)`** — a **client-side loop**, not a batch
  endpoint. The platform has no bulk transfer route. It runs sequentially on
  purpose (each transfer writes AWS IoT thing attributes), does not stop at the
  first failure, and reports per device.

- **`xg.transferOffers`** — the cross-organization handshake:
  `create(deviceId)`, `list({ status })`, `listForDevice(deviceId)`,
  `get(code)`, `accept(code, { workspaceId })`, `decline(code)`,
  `cancel(code)`.

  Two shapes worth knowing. `get(code)` returns a **`TransferOfferPreview`,
  which is a different and much smaller type than `TransferOffer`** — an
  allowlist with no device id, no serial and no tenancy ids, because the code is
  a bearer token held by an organization not yet entitled to the device.
  And `create()` reports `reused`, because the API answers 201 for a fresh code
  and 200 when it hands back the device's already-open one, with byte-identical
  bodies; `reused` is the only way to tell them apart.

  **There is no inbox of incoming offers, by design.** An offer names no
  destination — not knowing the destination's organization id is the entire
  point of the code — so a pending offer is discoverable only by its code.
  `list()` shows what your organization sent plus what it has accepted. Build a
  "paste a code" entry point, not a notification list.

- **`RawRequestInit.onStatus`** — observe the HTTP status of a successful
  response through `client.request()`. Added for the 201-vs-200 case above and
  useful for the escape hatch generally.

- **Error codes.** `SAME_WORKSPACE` (400), `SERIAL_COLLISION`,
  `TRANSFER_IN_PROGRESS`, `CONCURRENT_MODIFICATION` (409) and `TRANSFER_FAILED`
  (502) join `XorgateApiErrorCode`. `TRANSFER_FAILED` means the sequence was
  **rolled back and nothing changed**, so it is safe to retry.
  `DEVICE_OUT_OF_SCOPE` joins `XorgateClientErrorCode`; it is raised by
  `@xorgate/react` and declared here so both packages name it identically.

## 0.6.1

Search knows about the Models section. Additive; an older API deployment
simply never returns the two new types.

### Changed

- **`SearchResult["type"]`** gains `"dataset"` (a labeling dataset) and
  `"model"` (a trained network in the organization's registry, listed by its
  label with `family/name@version` as the subtitle). Code that switches
  exhaustively over the union needs the two new cases; everything else is
  unaffected.

## 0.6.0

Workflow templates become discoverable. Additive; against an older API
deployment `tags` comes back as an empty array rather than undefined, and the
three routes answer `404`.

### Added

- **`xg.workflowTemplates`**, the first piece of the platform's workflow
  surface in this package. `list()` (paginated, with `iterate()` and
  `listAll()`), `get()` and `tags()`. READS ONLY: authoring a template,
  publishing a version, attaching one to a device and reading its runs are
  still moving, are undocumented, and stay out.

  The reason it exists is discovery by tag. An integration tags the templates
  it owns in the web editor, then finds them without hard-coding an id someone
  can delete:

  ```ts
  const page = await xg.workflowTemplates.list({ tags: ["geofence"] })
  ```

  `tags` is **ANY-of**: `["geofence", "speeding"]` returns templates carrying
  either. There is no ALL-of mode. Values are normalized platform-side
  (lowercase, deduplicated, at most 20 of at most 32 characters each,
  `^[a-z0-9][a-z0-9._-]*$`), so `"Geofence"` matches the template stored as
  `geofence`, and a value that could never be a tag is a `400` rather than a
  silently empty result.

- **`tags()`** returns the organization's distinct tags with counts, most used
  first. One request instead of walking every template to learn what is
  taggable.

- **The types behind them**: `WorkflowTemplate`, `WorkflowTemplateDetail`,
  `WorkflowTemplateVersion`, `WorkflowTemplateDeployment`,
  `WorkflowTemplateAuthor`, `WorkflowTemplateStatus`, `WorkflowTemplateTagCount`,
  `WorkflowDefinition` and `ListWorkflowTemplatesParams`. `WorkflowDefinition`
  is deliberately loose (`{ schemaVersion?, nodes, edges }`): this package does
  not model the node catalog, and a definition read through it is meant to be
  handed to `@xorgate/workflow-engine` or written back verbatim.

`tags` and `requiredCapabilities` are normalized to `[]` when a response omits
them, so a consumer mapping over `template.tags` need not know which API
deployment it is talking to.

## 0.5.0

Session poster frames. Additive; against an older API deployment the field is
simply absent, which the type already models.

### Added

- **`MediaSession.thumbnailUrl`** — presigned GET for a poster frame JPEG the
  platform extracts from the session's first segment. Present on the list
  endpoints only (like the rollups), short-lived like segment playback URLs,
  and `null`/absent when the session has no thumbnail, so consumers must keep
  a fallback rendering.

## 0.4.0

Mirrors the platform's camera sensor-level rotation release: a device mounted
upside down can be told so, and every consumer — live video, recordings,
replays, workflow frames — sees an upright image. Additive; it degrades
gracefully against an older API deployment, which simply never returns the
namespace.

### Added

- **`cameraMount` config namespace** (`CameraMountConfig`), on `DeviceConfig`
  and `DeviceConfigPatch`: `{ cameras: { cam0: { rotationDeg: 0 | 180 } } }`,
  keyed by stream key. The device applies it at the image SENSOR, by way of the
  camera overlay in its boot config, so nothing downstream has to know rotation
  exists and it costs no CPU. Two consequences worth knowing when you write a
  client against it:
  - it takes effect on the device's **next boot**. Until then the device
    reports the namespace as `adjusted` with a "REBOOT REQUIRED" detail, and
    `reportedConfig.effective.cameraMount` carries what is actually in force
    (`cameras`) alongside what is waiting (`pending`, `rebootRequired`);
  - an **absent** camera key is unmanaged — the device leaves that camera's
    boot config exactly as it found it. Send an explicit `{rotationDeg: 0}` to
    take a camera over and force it upright.
- **Closed numeric sets in the generated config types.** The generator now
  reads a JSON-Schema `anyOf` of literals (and a bare `const`), so
  `rotationDeg` types as `0 | 180` rather than `unknown`. String sets already
  came through as unions; this closes the number case.

## 0.3.0

Mirrors the platform's cm4-support release: device models became the single
hardware variation point (`io_capabilities` schemaVersion 2), and devices can
now be registered with — or reassigned to — a specific model. Everything is
additive and degrades gracefully against older API deployments.

### Added

- **`ioCapabilities` schemaVersion 2.** `validateIoCapabilities` /
  `parseIoCapabilities` accept both versions, dispatching on the
  discriminator exactly like the platform's provisioning parser. v2 adds the
  platform facts the device agent turns into mechanism:
  `system.platform` (`"rpi-cm5" | "rpi-cm4"`), `system.encoder`
  (`"sw-h264" | "hw-h264"`), `system.rails`, a nullable `system.statusLed`
  pin map, `sensors.imu.model`, and required `connector` + `sensor` on each
  `media.video[]` entry. `IoCapabilities` in the types is now the
  `IoCapabilitiesV1 | IoCapabilitiesV2` union — V1 is unchanged, so existing
  v1 documents and consumers keep typechecking. `videoStreamKeys()` and
  `declaredMetrics()` read both versions.
- **`Device.needsModel`**: probe-at-claim could not pick a model
  unambiguously; the device carries its registration's fallback model until
  one is confirmed. Reads `false` against an older backend (the field is
  simply absent there).
- **`devices.update({ deviceModelId })`**: reassign the device model. The
  platform clears `needsModel` and republishes the device's config with the
  new model's hardware block, so a fielded device re-renders its pipelines
  with no re-provision. KVS channels are not re-minted.
- **`deviceRegistrations.create({ deviceModelId })`**: pin the model at
  registration; the claim then honors the pick and skips probe-at-claim.
  Calling it again while a code is pending re-pins that code in place.

## 0.2.0

Mirrors the platform's API-productization release (pagination consistency,
`requestId` in error bodies, membership role updates). Works against older
API deployments too: every addition degrades gracefully.

### Added

- **`memberships.updateRole(membershipId, role)`**, for the new
  `PATCH /v1/memberships/{id}`. Changes a role in place; the API gates
  owner-level changes to owners and refuses to demote the last owner (403),
  so an organization cannot lock itself out.
- **The five formerly-unpaginated collections now speak the list dialect.**
  `organizations`, `memberships`, `workspaces`, `deviceModels` and `apiKeys`
  `list()` all take optional `{ limit, offset, order, sort, signal }` (same
  shape as `devices.list()`), and their `iterate()` / `listAll()` now walk
  the server's new `page` blocks instead of assuming one response holds
  everything. Code written against `iterate()`/`listAll()` keeps working
  unchanged, which is exactly what those methods existed for; `list()` still
  returns a plain array (one request, up to `limit` rows, default 100).
- **`XorgateError.serverRequestId`**: the API's own request id, read from
  `error.requestId` in the body. This is the id the platform's access log
  records, so it is the one to quote in a support ticket. The existing
  `requestId` field (the client-generated `X-Request-ID`) is unchanged.

### Changed

- **A `limit` above an endpoint's maximum is now a 400 from the API**, where
  the paginated endpoints used to clamp silently. Nothing changes in the SDK
  itself, but an `iterate({ pageSize })` above 500 that used to be clamped
  will now surface a `BAD_REQUEST` error.
- The API now answers its own unhandled failures with a
  `SERVER_ERROR`-coded envelope (previously a bare gateway 500). The SDK
  already named envelope-less 5xxs `SERVER_ERROR`, so consumers see the same
  code either way, now with `serverRequestId` attached.

## 0.1.2

### Fixed

- **The default `fetch` threw "Illegal invocation" in browsers.** The core
  stored a detached reference to `globalThis.fetch` and invoked it as a method
  of its own instance. Browsers implement `fetch` as a Window method and refuse
  any other receiver, so every request from a browser client that did not pass
  its own `fetch` failed with
  `NETWORK ...: Failed to execute 'fetch' on 'Window': Illegal invocation`.
  Node's `fetch` does not care about its receiver, which is why 93 unit tests
  and the production integration suite never saw it — the first real browser
  consumer (xorgate-web's Phase 4 dogfood) did, on its first request. The
  global is now bound before being stored; a caller-supplied `fetch` is used
  exactly as given.

## 0.1.1

### Fixed

- **The client could serialize its own API key.** TypeScript's `private` is a
  compile-time fiction, so `auth` was an ordinary enumerable property at runtime,
  reachable from the client and from every resource module hanging off it.
  `JSON.stringify(client)` printed the credential, and so would any structured
  logger or error reporter handed the client. The credential-bearing fields are
  now non-enumerable, and `XorgateClient` gains a `toJSON()` that returns
  `{ baseUrl, organizationId, workspaceId }` and nothing else.

  Nothing about the API surface changes and no behaviour depends on it, but
  **0.1.0 should not be used**: it can leak a production credential into a log
  line without anyone doing anything wrong.

## 0.1.0

The first implementation of the surface designed in
`plans/done/xorgate-sdk-and-api/interface.d.ts`. Nothing before this existed as
code.

### Added

- `createClient()` and `createBootstrapClient()`, derived clients through
  `forOrganization()` and `forWorkspace()`, and a raw `request()` escape hatch.
- Resource modules for `/me`, search, organizations, memberships, API keys,
  session tokens, workspaces, device models, devices (CRUD, config, commands,
  provisioning, identity, video channels), device registrations, media
  (sessions, runs, segments, playback URLs, replay manifests) and telemetry
  (history, latest, recent, and the paginated readings table).
- One error type, `XorgateError`, covering HTTP failures, timeouts, aborts,
  network failures and client-side validation alike, with `isXorgateError()` as
  the whole error-handling contract.
- `iterate()` and `listAll()` on every collection, whether or not the endpoint
  paginates today, so code written against them survives the platform gaining
  pagination.
- Client-side `ioCapabilities` validation before every device-model write:
  `validateIoCapabilities()`, `parseIoCapabilities()`, and the two derivation
  helpers `videoStreamKeys()` and `declaredMetrics()`.
- `devices.mergeConfig()`, a read-modify-write over `patchConfig()`.
- Dual ESM and CJS output with bundled types, and **zero runtime dependencies**,
  verified against the packed tarball rather than against `package.json`.

### Decisions worth knowing, if you read the design first

These are the four places the shipped package deliberately differs from the
2026-08-10 design sketch. Each is recorded with its reasoning in
`plans/sdk-packages-and-alocate-pilot/PROGRESS.md`.

- **`baseUrl` is optional**, defaulting to `https://api.xorgate.io`. The design
  said to do this "on the day prod is deployed"; prod is deployed. It stays a
  bare origin, because the SDK owns the `/v1` segment.
- **`devices.mergeConfig()` is new.** `PATCH /devices/{id}/config` replaces a
  namespace whole rather than merging it, and expressing "turn X on" as the
  smallest possible patch erases the rest of that namespace. That mistake broke
  a camera on the production bench device while prod was being brought up, and
  it is aimed squarely at customer hardware.
- **429 is handled now**, before rate limiting exists. `RATE_LIMITED` is
  retryable, `Retry-After` raises the backoff floor (still capped by
  `maxDelayMs`), and `SERVER_ERROR` names a 5xx that carried no error envelope.
  Shipping this after throttling would mean already-deployed clients retrying
  blindly into the thing trying to slow them down.
- **`User.createdAt` is `string | null`.** `GET /me` builds its `user` block
  from the request's credential and carries no timestamp, and that endpoint is
  the only place the type is observable.

Retry remains **off by default and GET-only**. The API has no idempotency keys,
so a timed-out write is genuinely ambiguous and the honest response is to read
the resource back rather than to retry it.
