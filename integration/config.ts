/**
 * Credentials for the integration suites, and the guard that stops a missing
 * one from looking like a pass.
 *
 * The suites SKIP themselves when unconfigured, which is right on a developer's
 * machine: someone running `npm test` should not need a production key. It is
 * wrong in CI. `node --test` exits 0 for a skipped suite, so a job whose secrets
 * were never set goes green having asserted nothing, and a green tick that
 * tested nothing is worse than a red one. That is not hypothetical: the first
 * CI run on `main` reported `# tests 0`, `# pass 0` and `success`.
 *
 * So CI sets `XORGATE_REQUIRE_INTEGRATION=1`, and under it "unconfigured" is a
 * hard failure instead of a skip. The check lives here rather than in the
 * workflow because it belongs to the suite: a shell step that greps for secret
 * names would only catch the one cause it was written for, while this catches
 * anything that would silently reduce the run to nothing.
 */

export const apiKey = process.env["XORGATE_API_KEY"];
export const organizationId = process.env["XORGATE_ORG_ID"];
export const baseUrl = process.env["XORGATE_API_URL"];
export const testDeviceId = process.env["XORGATE_TEST_DEVICE_ID"];

const required = process.env["XORGATE_REQUIRE_INTEGRATION"] === "1";
const configured = Boolean(apiKey && organizationId);

const WHERE =
  "See .env.example. The key lives in AWS Secrets Manager at " +
  "xorgate/integration-test-api-key (account 865609249890); in CI it is the " +
  "XORGATE_API_KEY repository secret.";

if (required && !configured) {
  const missing = [
    !apiKey && "XORGATE_API_KEY",
    !organizationId && "XORGATE_ORG_ID",
  ].filter(Boolean);
  throw new Error(
    `XORGATE_REQUIRE_INTEGRATION=1 but ${missing.join(" and ")} ` +
      `${missing.length === 1 ? "is" : "are"} unset, so this suite would have ` +
      `skipped itself and reported success without testing anything. ${WHERE}`,
  );
}

/** The reason to skip the whole suite, or `false` to run it. */
export function skipReason(): string | false {
  if (configured) return false;
  return `XORGATE_API_KEY and XORGATE_ORG_ID are unset. ${WHERE}`;
}

/**
 * The reason to skip the read-only tests against the shared production device.
 *
 * Under `XORGATE_REQUIRE_INTEGRATION` this is a failure too: the device tests
 * are most of the suite's real coverage, and losing them to an unset variable
 * would quietly halve what CI proves.
 */
export function deviceSkipReason(): string | false {
  if (!configured) return "not configured";
  if (testDeviceId) return false;
  if (required) {
    throw new Error(
      "XORGATE_REQUIRE_INTEGRATION=1 but XORGATE_TEST_DEVICE_ID is unset, so " +
        `the read-only device tests would have been skipped. ${WHERE}`,
    );
  }
  return "XORGATE_TEST_DEVICE_ID is unset, so the read-only device tests are skipped.";
}
