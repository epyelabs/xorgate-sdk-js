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
  `xg.telemetry`, `xg.media`, `xg.apiKeys`, and so on, mirroring the API.
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
[`@xorgate/react`](https://github.com/epyelabs/xorgate-react). Workflows and AI
are not covered; `xg.request()` reaches them with no stability promise.

See [What this SDK does not cover](https://docs.xorgate.io/docs/backend-sdk/not-covered).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md). Note that `src/generated/` is produced from
the contracts in `vendor/` and must never be hand-edited, and that the
integration suite runs against **production** under rules written down there.

## License

MIT
