# @xorgate/sdk

The server-side JavaScript and TypeScript client for the
[xorgate](https://xorgate.io) platform API: devices, configuration, telemetry
history, recorded media, workspaces and members.

Zero runtime dependencies. Node 20+, and anything with a global `fetch`, which
covers Cloudflare Workers, Vercel Edge, Deno and Bun. Ships ESM and CJS with
bundled types.

**Full reference: [docs.xorgate.io/docs/backend-sdk](https://docs.xorgate.io/docs/backend-sdk)**

## Install

```bash
npm install @xorgate/sdk
```

## Use

```ts
import { createClient, isXorgateError } from "@xorgate/sdk"

const xg = createClient({
  auth: { apiKey: process.env.XORGATE_API_KEY! },
  organizationId: process.env.XORGATE_ORG_ID!,
})

const page = await xg.devices.list({ status: "online" })
console.log(page.items.length, "of", page.page.total, "online")

for await (const device of xg.devices.iterate({ workspaceId })) {
  const latest = await xg.telemetry.latestByMetric(device.id)
  console.log(device.serial, latest["gps.lat"]?.value, latest["gps.lon"]?.value)
}
```

`baseUrl` defaults to `https://api.xorgate.io`. It is a bare **origin**: the SDK
appends the `/v1` version segment itself, so pointing it elsewhere cannot
silently drop the version.

## What you get

- **One client, resource modules.** `xg.devices`, `xg.workspaces`,
  `xg.telemetry`, `xg.media`, `xg.apiKeys`, `xg.workflowTemplates`,
  `xg.transferOffers`, `xg.webhooks`, and so on, mirroring the API.
- **Tenancy is configuration, not per-call boilerplate.** `organizationId` is
  required at construction and travels on every request.
- **One error type.** Everything thrown is a `XorgateError` carrying
  `{ code, status, details, requestId, retryable }`, including client-side
  validation failures, so one `catch` covers the surface.
- **One iteration convention.** `iterate()` and `listAll()` exist on every
  collection, whether or not that endpoint paginates today, so your code
  survives the platform paginating the rest.
- **Work the API cannot do.** `ioCapabilities` is validated before a
  device-model write, because the API accepts any JSON there while provisioning
  parses it strictly, and a document that fails that parse gives the device zero
  video channels with no error raised anywhere.

## Three things that will bite you

**`patchConfig()` replaces a namespace whole.** It is not a deep merge, and the
natural way to write "turn X on" is to send only X, which erases everything else
in that namespace. This has broken real hardware. Use `mergeConfig()`:

```ts
// Safe: reads, deep-merges, writes the whole namespace back.
await xg.devices.mergeConfig(deviceId, {
  recording: { telemetry: { enabled: true } },
})
```

**`telemetry.latest()` is stale, not empty, on an offline device.** It returns
the last reading ingested, forever. Always check `ts` against the clock before
showing a value as current, or you ship a dashboard that says a stolen excavator
is exactly where it was last seen.

**`telemetry.history()` does not paginate, and `truncated` is the only signal.**
A truncated result is a complete-looking array. Check it on every call.

## Recorded telemetry as artifacts

A replay manifest carries the recorded telemetry for its window as presigned S3
objects, so a player fetches them straight from storage with no API call per
metric group:

```ts
const replay = await xg.media.replayManifest(deviceId, { sessionId })

for (const t of replay.telemetry?.sessions ?? []) {
  if (t.overview) {
    // route line, scrub preview, every metric: one gzipped JSON object
    const overview = await fetch(t.overview.url).then((r) => r.json())
  } else {
    // still recording: build it from t.segments, refetch the manifest ~60 s
  }
  console.log(t.insights?.distance?.meters, t.insights?.speed?.maxKph)
}
```

`replay.telemetry` is optional on the type because a server older than API
0.9.0 never sends it. Telemetry sessions are a **different id space** from video
sessions (both are minted on the device); the manifest joins them by time.

For a table or a roll-up, list the sessions with their insights instead, with
no URLs and no object storage involved:

```ts
const page = await xg.telemetry.sessions.list(deviceId, {
  from: monthStart,
  to: monthEnd,
})
const km = page.items.reduce(
  (sum, s) =>
    sum +
    (typeof s.insights?.distance?.meters === "number"
      ? s.insights.distance.meters
      : 0),
  0,
) / 1000
```

## Transferring a device

Moving a device to another workspace — or handing it to another organization
entirely — is `xg.devices.transfer()`, with `xg.devices.previewTransfer()` as the
dry run behind the confirmation dialog. Three things are worth knowing before
the first call.

**The device is never touched, so it does not have to be online.** A transfer
re-tenants a device by editing the AWS IoT registry and the retained
configuration message, not the box: certificates and identity do not change and
the tenancy is never persisted on disk. An offline device stages the new tenancy
in the cloud and adopts it the moment it next connects. Never gate a transfer on
`device.status`.

**All of its history goes with it.** Every telemetry row and every recorded
segment is device-keyed and moves. Across organizations that is a
data-disclosure event; `preview.carriesHistory` is always `true` and exists to
be rendered, not branched on.

**A 200 is not uniformly clean.** Read the summary:

```ts
const preview = await xg.devices.previewTransfer(deviceId, { workspaceId })
if (preview.blockers.length > 0) return preview.blockers   // returned, not thrown

const { device, transfer } = await xg.devices.transfer(deviceId, { workspaceId })

// The device moved and was told its new telemetry topic, but the BROKER was not
// told to allow it: it falls back to the legacy (still ingested) plane until any
// settings save re-asserts the attributes.
if (transfer.scopeAttributes === "failed") warn(transfer.warnings)

// "pending" right after a transfer is NORMAL — the change is already complete in
// the cloud. "unknown" means the device has never reported a telemetry scope at
// all, which is an agent older than v0.0.6, not a failure to converge.
console.log(transfer.adoption) // "confirmed" | "pending" | "unknown"
```

Handing a device to an organization you have no membership in goes through a
code instead, because one request cannot be authorized in two tenancies:

```ts
const { offer } = await source.transferOffers.create(deviceId)   // send offer.code
const preview = await destination.transferOffers.get(offer.code) // a thin allowlist
await destination.transferOffers.accept(offer.code, { workspaceId })
```

**There is no inbox of incoming offers, by design.** An offer names no
destination — not knowing the destination's organization id is the whole point
of the code — so a pending offer is discoverable only by its code.
`transferOffers.list()` shows what your organization sent plus what it accepted.
Build a "paste a code" entry point, not a notification list.

## Finding templates by tag

A workflow template carries free-form tags, and they are how an integration
finds the templates it owns without hard-coding an id someone can delete:

```ts
const page = await xg.workflowTemplates.list({ tags: ["geofence"] })
for (const template of page.items) {
  console.log(template.name, template.status, template.tags)
}

// Every distinct tag in the organization, with counts.
const vocabulary = await xg.workflowTemplates.tags()
```

`tags` is ANY-of: `["geofence", "speeding"]` returns templates carrying either.
Tags are normalized platform-side (lowercase, deduplicated, at most 20 of at
most 32 characters each, `^[a-z0-9][a-z0-9._-]*$`), so `"Geofence"` matches
`geofence` and a value that could never be a tag is a `400` rather than an empty
result. Tags are SET in the web editor; this package reads them.

## Webhooks

xorgate POSTs signed JSON to your HTTPS endpoint when a device comes online or
goes offline, when a media or telemetry session starts, ends or completes, and
when a workflow's `output.event` node fires in a production run. Delivery is
at-least-once with retries (8 attempts over about 44 hours); dedupe on the
event `id`.

### Endpoints

Endpoints are organization resources: any role reads, owner or admin writes.

```ts
const { webhook, secret } = await xg.webhooks.create({
  name: "dispatch", // what a workflow node's `webhook` field names
  url: "https://example.com/hooks/xorgate",
})
// `secret` (whsec_...) is shown exactly once. Store it now; the SDK keeps no
// copy. Lost it? rotateSecret() issues a new one.

await xg.webhooks.test(webhook.id) // sends a `ping`, one attempt
const page = await xg.webhooks.deliveries.list(webhook.id, { status: "failed" })
const detail = await xg.webhooks.deliveries.get(webhook.id, page.items[0]!.id)
console.log(detail.responseStatus, detail.responseExcerpt, detail.event?.type)
await xg.webhooks.deliveries.redeliver(webhook.id, detail.id)

const { secret: next } = await xg.webhooks.rotateSecret(webhook.id)
// For 24 h deliveries carry two signatures (old and new), so switch at your pace.
```

Also `list()` / `iterate()` / `listAll()`, `get()` (with 24 h `deliveryStats`),
`update()` (`name`, `url`, `description`, `enabled`), `delete()`,
`deliveries.iterate()` / `deliveries.listAll()` and `eventTypes()` (the catalog
with a sample `data` per type). `test()` and `redeliver()` on a disabled
endpoint are `409 CONFLICT`.

### Routing

An endpoint receives nothing until something routes to it.

- **Device events** (`device.online`, `device.offline`, `media_session.*`,
  `telemetry_session.*`) are routed per device. `set()` REPLACES the whole set:

  ```ts
  await xg.devices.webhooks.set(deviceId, [
    { endpointId: webhook.id, eventTypes: ["device.offline", "telemetry_session.completed"] },
  ])
  const routes = await xg.devices.webhooks.get(deviceId) // [{ endpointId, endpointName, eventTypes }]
  ```

  To add one route, `get()` first and send the union. `DEVICE_WEBHOOK_EVENT_TYPES`
  lists the seven routable types.
- **`workflow.event`** is routed by the emitting `output.event` node's `webhook`
  field, which names an endpoint. It is set in the template, not here.

### Verifying signatures

Deliveries follow [Standard Webhooks](https://www.standardwebhooks.com):
`webhook-id`, `webhook-timestamp` and `webhook-signature` headers.
`verifyWebhookSignature()` checks them with no dependency (WebCrypto), so it
runs on Node 20+, edge runtimes and Deno/Bun. **It is async; `await` it.** It
returns the parsed event, typed as a union discriminated on `type`, and throws
`WebhookVerificationError` (a `XorgateError`, code
`WEBHOOK_VERIFICATION_FAILED`, with a `reason`) on any failure.

Verify the body **exactly as received**. Parsing and re-serializing JSON changes
the bytes, so take the raw body. With Express:

```ts
import express from "express"
import { verifyWebhookSignature, WebhookVerificationError } from "@xorgate/sdk"

const app = express()

// express.raw, on this route only, so req.body is the untouched Buffer.
app.post("/hooks/xorgate", express.raw({ type: "application/json" }), async (req, res) => {
  let event
  try {
    event = await verifyWebhookSignature({
      headers: req.headers,
      rawBody: req.body,
      secret: process.env.XORGATE_WEBHOOK_SECRET!,
    })
  } catch (e) {
    if (e instanceof WebhookVerificationError) return res.status(400).end()
    throw e
  }

  // Ack fast (within 10 s), then work. Dedupe on event.id: delivery is at-least-once.
  res.status(204).end()

  switch (event.type) {
    case "device.offline":
      console.log(event.data.deviceId, event.data.source) // "graceful" | "lwt" | "sweeper"
      break
    case "telemetry_session.completed":
      console.log(event.data.sessionId, event.data.distanceM, event.data.overview.apiPath)
      break
    case "workflow.event":
      console.log(event.data.kind, event.data.nodeId, event.data.run.templateId)
      break
  }
})
```

With a Fetch-style handler (Next.js route handlers, Workers, Hono) pass
`request.headers` and `await request.text()`. Options: `toleranceSeconds`
(default 300, applied in both directions) and `now` (a `Date`, for tests).
`reason` is one of `missing_headers`, `invalid_timestamp`, `timestamp_too_old`,
`timestamp_too_new`, `invalid_secret`, `invalid_body` (you passed a parsed
object), `no_matching_signature`, `invalid_payload` or `crypto_unavailable`.
Any `v1` signature in the header may match, which is what makes rotation
seamless. The error never carries the secret, the body or a signature.

## Errors

```ts
try {
  await xg.devices.reboot(deviceId)
} catch (e) {
  if (!isXorgateError(e)) throw e

  if (e.code === "CONFLICT") {
    // Offline. Commands are not retained; there is nothing to queue.
  } else if (e.code === "INSUFFICIENT_ROLE") {
    // Reboot needs owner or admin. Checked BEFORE the device's state, so a
    // `member` key sees this whatever the device is doing.
  } else {
    throw e
  }
}
```

`XorgateError` is safe to log whole: the credential never appears in `message`,
`url` or `details`.

Retry is **off by default** and, when enabled, applies to `GET` only. The API has
no idempotency keys, so a timed-out write is genuinely ambiguous and reading the
resource back beats retrying it.

## Not in this package

Live telemetry (MQTT over WebSocket) and live video (WebRTC) are a separate
plane that a client speaks directly. Your backend vends credentials for it with
`POST /auth/live-credentials`, and the browser side is
[`@xorgate/react`](https://github.com/epyelabs/xorgate-react).

Of the workflows and AI surface, only the template READS are covered:
`xg.workflowTemplates.list()`, `.get()` and `.tags()`. Authoring a template,
publishing a version, attaching one to a device and reading its runs are still
moving and are undocumented; `xg.request()` reaches them with no stability
promise.

See [What this SDK does not cover](https://docs.xorgate.io/docs/backend-sdk/not-covered).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md). Note that `src/generated/` is produced from
the contracts in `vendor/` and must never be hand-edited, and that the
integration suite runs against **production** under rules written down there.

## License

MIT
