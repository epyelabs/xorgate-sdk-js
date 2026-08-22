import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_NAMESPACES } from "../src/index.js";

// The tests are compiled into `.tmp/`, so a path relative to this file would
// point inside the build output. `scripts/run-tests.mjs` runs node from the
// package root, which is the stable anchor.
const root = process.cwd();

test("the generated files match what vendor/ produces (the drift check)", () => {
  const result = spawnSync(process.execPath, ["scripts/generate.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `scripts/generate.mjs --check failed:\n${result.stdout}${result.stderr}`,
  );
});

test("the namespace list matches the vendored contract", () => {
  const contract = JSON.parse(
    readFileSync(join(root, "vendor/config-contract.json"), "utf8"),
  ) as { namespaces: Record<string, unknown> };
  assert.deepEqual([...CONFIG_NAMESPACES], Object.keys(contract.namespaces));
});

test("vendor/SOURCES.json names an upstream file and hash for every vendored input", () => {
  const sources = JSON.parse(readFileSync(join(root, "vendor/SOURCES.json"), "utf8")) as {
    vendored: Array<{ file: string; sourceFile: string; sourceSha256: string }>;
  };
  assert.ok(sources.vendored.length >= 2);
  for (const entry of sources.vendored) {
    assert.match(entry.sourceSha256, /^[0-9a-f]{64}$/, `${entry.file} has a real hash`);
    assert.ok(entry.sourceFile.length > 0);
  }
});
