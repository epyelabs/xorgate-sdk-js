#!/usr/bin/env node
/**
 * The package is `"type": "module"`, so every `.js` under `dist/` is an ES
 * module unless a nearer package.json says otherwise. This drops that marker
 * into the CJS output, which is the whole trick behind dual publishing without
 * a bundler.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

writeFileSync(
  join(root, "dist/cjs/package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);
writeFileSync(
  join(root, "dist/esm/package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);
console.log("wrote dist/{cjs,esm}/package.json");
