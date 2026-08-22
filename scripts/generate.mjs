#!/usr/bin/env node
/**
 * Generates the two files under `src/generated/` that must never be hand-written:
 *
 *   config.ts        device config namespace types, from vendor/config-contract.json
 *   capabilities.ts  the ioCapabilities validator, from vendor/io-capabilities.schema.json
 *
 * Both inputs are vendored copies of contracts that live in xorgate-core-service;
 * vendor/SOURCES.json records what each was taken from. The validator is generated
 * rather than delegated to zod because this package ships ZERO runtime dependencies
 * (it has to run on edge runtimes), and the config types are generated because
 * hand-writing them would make the SDK a fourth copy of a contract that drifts.
 *
 *   node scripts/generate.mjs          write the files
 *   node scripts/generate.mjs --check  fail if what is on disk differs (the CI drift check)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const BANNER = (source) =>
  `// GENERATED FILE - DO NOT EDIT.\n` +
  `// Produced by scripts/generate.mjs from ${source}.\n` +
  `// Run \`npm run generate\` after changing that input; \`npm run check:generated\`\n` +
  `// fails the build when this file and its input disagree.\n`;

// ---------------------------------------------------------------------------
// config.ts: namespace types from config-contract.json
// ---------------------------------------------------------------------------

/** Interface name per namespace. Scalars have none; they inline their type. */
const NAMESPACE_TYPES = {
  imuMount: "ImuMountConfig",
  recording: "RecordingConfig",
  lteRecovery: "LteRecoveryConfig",
  timeSync: "TimeSyncConfig",
  cellular: "CellularConfig",
};

function wrapComment(text, indent) {
  if (!text) return "";
  const width = 80 - indent.length - 3;
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
}

function tsType(schema, indent) {
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  switch (schema.type) {
    case "boolean":
      return "boolean";
    case "integer":
    case "number":
      return "number";
    case "string":
      return "string";
    case "array":
      return `${tsType(schema.items ?? { type: "unknown" }, indent)}[]`;
    case "object": {
      if (!schema.properties) {
        // Open map, e.g. recording.video.cameras: {"cam1": false}.
        const value = schema.additionalProperties &&
          typeof schema.additionalProperties === "object"
          ? tsType(schema.additionalProperties, indent)
          : "unknown";
        return `Record<string, ${value}>`;
      }
      return objectBody(schema, indent);
    }
    default:
      return "unknown";
  }
}

function objectBody(schema, indent) {
  const inner = `${indent}  `;
  const required = new Set(schema.required ?? []);
  const members = Object.entries(schema.properties).map(([key, value]) => {
    const optional = required.has(key) ? "" : "?";
    const doc = wrapComment(value.description, inner);
    return `${doc}${inner}${key}${optional}: ${tsType(value, inner)};`;
  });
  return `{\n${members.join("\n")}\n${indent}}`;
}

function generateConfig() {
  const contract = JSON.parse(
    readFileSync(join(root, "vendor/config-contract.json"), "utf8"),
  );
  const out = [];
  out.push(BANNER("vendor/config-contract.json"));
  out.push(`//`);
  out.push(
    `// Contract version ${contract.version}, wire version ${contract.wireVersion}.`,
  );
  out.push("");

  const namespaceMembers = [];
  for (const [key, ns] of Object.entries(contract.namespaces)) {
    const named = NAMESPACE_TYPES[key];
    if (named) {
      const doc = wrapComment(ns.description, "");
      out.push(`${doc}export interface ${named} ${objectBody(ns.jsonSchema, "")}`);
      out.push("");
      namespaceMembers.push({ key, type: named, description: ns.description });
    } else {
      namespaceMembers.push({
        key,
        type: tsType(ns.jsonSchema, "  "),
        description: ns.description,
      });
    }
  }

  out.push(`/**`);
  out.push(` * One key per config namespace, all optional. A namespace is either configured`);
  out.push(` * or absent: the API strips cleared namespaces, so nothing is ever`);
  out.push(` * present-but-null on read. Writing \`null\` is what clears one.`);
  out.push(` */`);
  out.push(`export interface DeviceConfig {`);
  for (const m of namespaceMembers) {
    out.push(wrapComment(m.description, "  ").replace(/\n$/, ""));
    out.push(`  ${m.key}?: ${m.type};`);
  }
  out.push(`}`);
  out.push("");
  out.push(`/** Every namespace replaced WHOLE. \`null\` reverts it to the device defaults. */`);
  out.push(`export type DeviceConfigPatch = {`);
  out.push(`  [K in keyof DeviceConfig]?: DeviceConfig[K] | null;`);
  out.push(`};`);
  out.push("");
  out.push(`/** The namespace keys, in contract order. */`);
  out.push(
    `export const CONFIG_NAMESPACES = [${Object.keys(contract.namespaces)
      .map((k) => JSON.stringify(k))
      .join(", ")}] as const;`,
  );
  out.push("");
  out.push(
    `/** Cloud-only presentation preferences. Never delivered to the device. */`,
  );
  out.push(`export interface DeviceUiPrefs ${objectBody(contract.uiPrefs.jsonSchema, "")}`);
  out.push("");
  out.push(`export type DeviceUiPrefsPatch = {`);
  out.push(`  [K in keyof DeviceUiPrefs]?: DeviceUiPrefs[K] | null;`);
  out.push(`};`);
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// capabilities.ts: a dependency-free validator from io-capabilities.schema.json
// ---------------------------------------------------------------------------

function generateCapabilities() {
  const schema = JSON.parse(
    readFileSync(join(root, "vendor/io-capabilities.schema.json"), "utf8"),
  );
  const defs = schema.definitions;
  const out = [];
  out.push(BANNER("vendor/io-capabilities.schema.json"));
  out.push(`//`);
  out.push(`// Why this exists: the API does NOT validate \`ioCapabilities\` on write, but`);
  out.push(`// provisioning DOES parse it, and a document that fails that parse yields zero`);
  out.push(`// video channels with no error raised anywhere. Live video then silently never`);
  out.push(`// works. Shipping zod to check it would cost this package its zero-dependency`);
  out.push(`// guarantee, so the same checks are emitted as plain code instead.`);
  out.push("");
  out.push(`import type { IoCapabilitiesIssue } from "../types.js";`);
  out.push("");
  out.push(`type Push = (path: string, message: string) => void;`);
  out.push("");
  out.push(`function isRecord(v: unknown): v is Record<string, unknown> {`);
  out.push(`  return typeof v === "object" && v !== null && !Array.isArray(v);`);
  out.push(`}`);
  out.push("");

  for (const [name, def] of Object.entries(defs)) {
    out.push(...checkerFor(name, def));
    out.push("");
  }

  out.push(`/** Runs every check. Returns the issues found, in document order. */`);
  out.push(`export function collectIoCapabilitiesIssues(value: unknown): IoCapabilitiesIssue[] {`);
  out.push(`  const issues: IoCapabilitiesIssue[] = [];`);
  out.push(`  const push: Push = (path, message) => issues.push({ path, message });`);
  out.push(`  check${schema.root}(value, "", push);`);
  out.push(`  return issues;`);
  out.push(`}`);
  out.push("");
  return out.join("\n");
}

/** `a` + `.b`, or `b` at the root, so the top level reads `media.video[0].codec`. */
const PATH = (base, key) => `${base} ? \`\${${base}}.${key}\` : "${key}"`;

function checkerFor(name, def) {
  const lines = [];
  lines.push(`function check${name}(value: unknown, path: string, push: Push): void {`);
  lines.push(`  if (!isRecord(value)) {`);
  lines.push(`    push(path || "(root)", "Expected an object");`);
  lines.push(`    return;`);
  lines.push(`  }`);
  for (const [key, prop] of Object.entries(def.properties)) {
    const p = `p_${key}`;
    lines.push(`  const ${p} = ${PATH("path", key)};`);
    lines.push(`  if (value[${JSON.stringify(key)}] === undefined || value[${JSON.stringify(key)}] === null) {`);
    if (prop.required) {
      lines.push(`    push(${p}, "Required");`);
    } else {
      lines.push(`    /* optional */`);
    }
    lines.push(`  } else {`);
    lines.push(...propertyChecks(prop, `value[${JSON.stringify(key)}]`, p, "    "));
    lines.push(`  }`);
  }
  lines.push(`}`);
  return lines;
}

function propertyChecks(prop, expr, pathVar, indent) {
  const lines = [];
  switch (prop.kind) {
    case "string":
      lines.push(`${indent}if (typeof ${expr} !== "string") push(${pathVar}, "Expected a string");`);
      break;
    case "number": {
      const conds = [`typeof ${expr} !== "number"`, `!Number.isFinite(${expr})`];
      lines.push(`${indent}if (${conds.join(" || ")}) push(${pathVar}, "Expected a number");`);
      if (prop.int) {
        lines.push(
          `${indent}else if (!Number.isInteger(${expr})) push(${pathVar}, "Expected an integer");`,
        );
      }
      if (prop.positive) {
        lines.push(
          `${indent}else if ((${expr} as number) <= 0) push(${pathVar}, "Expected a positive number");`,
        );
      }
      break;
    }
    case "literal":
      lines.push(
        `${indent}if (${expr} !== ${JSON.stringify(prop.value)}) push(${pathVar}, "Expected ${JSON.stringify(prop.value)}");`,
      );
      break;
    case "array":
      lines.push(`${indent}if (!Array.isArray(${expr})) push(${pathVar}, "Expected an array");`);
      lines.push(`${indent}else {`);
      lines.push(`${indent}  const arr = ${expr} as unknown[];`);
      lines.push(`${indent}  for (let i = 0; i < arr.length; i++) {`);
      lines.push(`${indent}    const itemPath = \`\${${pathVar}}[\${i}]\`;`);
      lines.push(...propertyChecks(prop.items, `arr[i]`, "itemPath", `${indent}    `));
      lines.push(`${indent}  }`);
      lines.push(`${indent}}`);
      break;
    case "ref":
      lines.push(`${indent}check${prop.ref}(${expr}, ${pathVar}, push);`);
      break;
    default:
      break;
  }
  return lines;
}

// ---------------------------------------------------------------------------

const targets = [
  { file: "src/generated/config.ts", body: generateConfig() },
  { file: "src/generated/capabilities.ts", body: generateCapabilities() },
];

let drifted = false;
for (const { file, body } of targets) {
  const path = join(root, file);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === body) {
    if (!check) console.log(`unchanged  ${file}`);
    continue;
  }
  if (check) {
    drifted = true;
    console.error(
      `DRIFT      ${file} does not match what scripts/generate.mjs produces from vendor/.\n` +
        `           Run \`npm run generate\` and commit the result.`,
    );
  } else {
    writeFileSync(path, body);
    console.log(`written    ${file}`);
  }
}

if (drifted) process.exit(1);
if (check) console.log("generated files are in sync with vendor/");
