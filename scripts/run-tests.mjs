#!/usr/bin/env node
/**
 * Compiles the TypeScript tests and their source under `.tmp/test`, then runs
 * them with `node --test`. Keeping the runner this thin is deliberate: a test
 * framework would be a dev dependency whose transitive tree nobody audits, and
 * `node:test` is in the runtime this package already requires.
 *
 *   node scripts/run-tests.mjs               unit tests only
 *   node scripts/run-tests.mjs --integration integration suite only (needs .env)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const integration = process.argv.includes("--integration");

const tsc = spawnSync(
  "npx",
  ["tsc", "-p", integration ? "tsconfig.test-integration.json" : "tsconfig.test.json"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// A gitignored .env is the documented way to hold the production integration
// key on a developer machine. Nothing here reads a secret from argv.
const env = { ...process.env };
const dotenv = join(root, ".env");
if (integration && existsSync(dotenv)) {
  for (const line of readFileSync(dotenv, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (env[match[1]] === undefined) env[match[1]] = value;
  }
}

const dir = integration ? ".tmp/test/integration" : ".tmp/test/test";
const files = readdirSync(join(root, dir))
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => join(dir, f));
if (files.length === 0) {
  console.error(`No compiled tests under ${dir}.`);
  process.exit(1);
}
const run = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
  env,
});
process.exit(run.status ?? 1);
