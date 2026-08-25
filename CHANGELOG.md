# Changelog

All notable changes to `@xorgate/sdk`. This project follows
[semantic versioning](https://semver.org/).

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
