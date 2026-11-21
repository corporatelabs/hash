import { readFileSync } from "node:fs";
import path from "node:path";

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "OFL-1.1",
  "MPL-2.0",
  "Python-2.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "Unicode-DFS-2016",
  "Artistic-2.0",
]);

const FORBIDDEN = /\b(AGPL|GPL|LGPL|SSPL|EUPL|OSL-3|CPAL|BUSL)\b/i;
const root = process.cwd();

function readPackage(dir) {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

function licenseText(license) {
  if (!license) return "";
  if (typeof license === "string") return license;
  if (typeof license === "object" && typeof license.type === "string") return license.type;
  return JSON.stringify(license);
}

function allowedExpression(expression) {
  if (FORBIDDEN.test(expression)) return false;
  const normalized = expression.replace(/[()]/g, " ");
  const parts = normalized.split(/\bOR\b/i).map((part) => part.trim()).filter(Boolean);
  return parts.some((part) => part.split(/\bAND\b/i).every((atom) => ALLOWED.has(atom.trim())));
}

function resolvePackage(name, fromDir) {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", name);
    try {
      readPackage(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

const seen = new Set();
const bad = [];
let count = 0;

function visit(name, fromDir) {
  const dir = resolvePackage(name, fromDir);
  if (!dir || seen.has(dir)) return;
  seen.add(dir);
  const pkg = readPackage(dir);
  count += 1;
  const license = licenseText(pkg.license);
  if (!license || !allowedExpression(license)) {
    bad.push({ name: pkg.name || name, license: license || "(none)", path: dir });
  }
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  for (const dep of Object.keys(deps)) visit(dep, dir);
}

const rootPkg = readPackage(root);
for (const dep of Object.keys(rootPkg.dependencies ?? {})) visit(dep, root);

if (bad.length > 0) {
  console.error("Copyleft or unclassified production licenses:");
  for (const pkg of bad) console.error(`- ${pkg.name}: ${pkg.license} (${pkg.path})`);
  process.exit(1);
}
console.log(`license scan ok (${count} production packages)`);
