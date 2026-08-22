#!/usr/bin/env node
/**
 * Zero runtime dependencies is a hard constraint (the package has to run on
 * edge runtimes), and the honest way to check it is to look at what would
 * actually be PUBLISHED rather than at package.json. A `dependencies` block can
 * be empty while a bundler has inlined something, or while a file that should
 * not ship carries an import of its own.
 *
 * So: pack, unpack, and assert three things about the artifact itself.
 *
 *   npm run verify:tarball
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "xorgate-sdk-pack-"));
let failures = 0;

function fail(message) {
  console.error(`FAIL  ${message}`);
  failures++;
}
function pass(message) {
  console.log(`ok    ${message}`);
}

try {
  // `npm pack` runs `prepack`, whose own stdout lands ahead of the JSON, so
  // parse from the first `[` rather than trusting the whole stream.
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", work],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const jsonStart = packOutput.indexOf("[");
  if (jsonStart === -1) throw new Error(`npm pack printed no JSON:\n${packOutput}`);
  const packed = JSON.parse(packOutput.slice(jsonStart))[0];
  const tarball = join(work, packed.filename);
  execFileSync("tar", ["-xzf", tarball, "-C", work]);
  const pkgDir = join(work, "package");
  const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

  // 1. No runtime dependencies of any kind, declared.
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const entries = Object.keys(manifest[field] ?? {});
    if (entries.length > 0) fail(`${field} is not empty: ${entries.join(", ")}`);
    else pass(`${field} is empty`);
  }
  // devDependencies stay in a published manifest by design and are never
  // installed for a consumer, so they are reported rather than failed.
  const dev = Object.keys(manifest.devDependencies ?? {});
  console.log(`info  devDependencies (never installed for a consumer): ${dev.join(", ") || "none"}`);

  // 2. No bare import specifiers in the shipped JavaScript. `node:` builtins are
  //    allowed; the package uses none today, and a relative import is fine.
  const offenders = [];
  for (const file of walk(pkgDir)) {
    if (!file.endsWith(".js")) continue;
    // Comments carry example imports (`import { createClient } from
    // "@xorgate/sdk"`), which are documentation rather than a dependency.
    const source = stripComments(readFileSync(file, "utf8"));
    const specifiers = [
      ...source.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      offenders.push(`${relative(pkgDir, file)} imports "${specifier}"`);
    }
  }
  if (offenders.length > 0) offenders.forEach(fail);
  else pass("no bare imports in the shipped JavaScript");

  // 3. The entry points the manifest advertises actually exist, and both
  //    module systems can load them.
  for (const entry of ["dist/esm/index.js", "dist/cjs/index.js", "dist/esm/index.d.ts"]) {
    try {
      statSync(join(pkgDir, entry));
      pass(`${entry} is in the tarball`);
    } catch {
      fail(`${entry} is advertised but not in the tarball`);
    }
  }
  execFileSync(process.execPath, ["-e", `require(${JSON.stringify(join(pkgDir, "dist/cjs/index.js"))})`]);
  pass("the CJS entry point loads");
  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `await import(${JSON.stringify(join(pkgDir, "dist/esm/index.js"))})`,
  ]);
  pass("the ESM entry point loads");

  const bytes = statSync(tarball).size;
  console.log(`\n${packed.filename}  ${(bytes / 1024).toFixed(1)} kB packed, ${packed.entryCount} files`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

/** Good enough for emitted JavaScript, which has no regex-vs-division tricks. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
