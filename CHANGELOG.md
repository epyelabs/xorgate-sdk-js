# Changelog

All notable changes to `@xorgate/sdk`. This project follows
[semantic versioning](https://semver.org/).

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
