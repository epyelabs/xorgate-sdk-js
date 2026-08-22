# Contributing

## Layout

```
src/
  http.ts            the ONE request path: auth, tenancy headers, X-Request-ID,
                     AbortSignal merging, error mapping, GET-only retry
  client.ts          createClient / createBootstrapClient, derived clients
  errors.ts          XorgateError and the code unions
  normalize.ts       envelope unwrapping and the two snake_case outliers
  pagination.ts      iterate() over paginated AND unpaginated collections
  capabilities.ts    ioCapabilities validation and the two derivation helpers
  types.ts           the domain vocabulary
  generated/         DO NOT EDIT. See below.
  resources/         one module per API resource; each is a thin call into http
vendor/              copies of contracts owned by xorgate-core-service
examples/            every example from the docs site, compiled for real
```

Every resource method goes through `HttpCore.request()`. If a method needs
behaviour the core does not have, add it to the core rather than to the method.

## The generated files

`src/generated/config.ts` and `src/generated/capabilities.ts` are produced by
`scripts/generate.mjs` from the contracts in `vendor/`. Never edit them by hand:
`npm run check:generated` fails the build if you do, and CI runs it.

Both contracts are owned by `xorgate-core-service`
(`src/config-registry/config-contract.json` and `src/schemas/capabilities.ts`).
`vendor/SOURCES.json` records which upstream file each copy came from and its
sha256 at the time. When either changes upstream, that repo's
`test/sdk-vendor-drift.test.ts` fails and points here.

To take an upstream change:

```bash
cp ../../backend/xorgate-core-service/src/config-registry/config-contract.json vendor/
# for capabilities.ts, mirror the zod change into vendor/io-capabilities.schema.json by hand
npm run generate
# update the hashes in vendor/SOURCES.json, and the pins in the upstream test
npm test
```

The generators exist because this package ships **zero runtime dependencies**:
it has to run on edge runtimes, so it cannot depend on zod to validate a
document, and it must not become a fourth hand-maintained copy of a config
contract that drifts.

## Tests

```bash
npm test                  unit tests, against a fetch stub. No network.
npm run test:integration  the real thing. Needs a credential; see below.
npm run check:examples    every docs example, compiled against this package
npm run verify:tarball    zero runtime deps, checked on the packed artifact
npm run ci                all of the above, in the order CI runs them
```

`npm run test:integration` runs against **production**, which is an environment
real consumers use. Three rules, in order of how much damage breaking them does:

1. The suite creates and destroys its **own** workspace every run, and never
   writes to one it did not create. Deleting a workspace cascades to its
   devices, their recorded media and their telemetry.
2. Reads against the shared device named by `XORGATE_TEST_DEVICE_ID` are
   read-only. No config writes, no commands.
3. No test may assume a fast first request. The production database auto-pauses
   when idle, so the first call of a run waits for it to resume. Never set
   `timeoutMs` below about 3000 anywhere in the suite.

Credentials come from a gitignored `.env`; copy `.env.example` and fill it in.
Without them the suite **skips itself**, which is right locally: `npm test`
should not need a production key.

In CI that same skip is a trap, because `node --test` exits 0 for a skipped
suite and the job goes green having asserted nothing. So CI sets
`XORGATE_REQUIRE_INTEGRATION=1`, under which "unconfigured" is a hard failure
instead. `integration/config.ts` owns both behaviours.
The key is the suite's own, stored in AWS Secrets Manager as
`xorgate/integration-test-api-key`. Do not use a consumer's runtime key, and
never commit either.

## Adding a method

1. Check it against the real handler in `xorgate-core-service`, not only against
   the OpenAPI document. The checked-in `openapi.json` at that repo's root has
   been stale before now.
2. Mirror the API, do not improve it. Where the platform paginates, paginate;
   where it does not, return an array. The one deliberate exception is casing.
3. Add a unit test against the fetch stub, and an integration test if the
   behaviour is something only the real API can demonstrate.
4. Document it on the docs site under `content/docs/backend-sdk/`, and add the
   example to `examples/docs-examples.ts` so a compiler reads it.
