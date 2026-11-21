import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = ["src/core", "src/shared"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file, out);
    else if (file.endsWith(".ts") || file.endsWith(".mjs") || file.endsWith(".js")) out.push(file);
  }
  return out;
}

function specifiers(source) {
  const found = [];
  const patterns = [
    /^\s*import\s[\s\S]*?\sfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /^\s*export\s[\s\S]*?\sfrom\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

function reason(fromFile, specifier) {
  if (specifier.startsWith("cloudflare:") || specifier.includes("/cloudflare:")) return "cloudflare: import";
  if (specifier === "@cloudflare" || specifier.startsWith("@cloudflare/")) return "@cloudflare import";
  if (specifier === "wrangler" || specifier.startsWith("wrangler/")) return "wrangler import";
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const rel = path.relative(root, resolved);
  if (rel === "src/adapters" || rel.startsWith(`src${path.sep}adapters${path.sep}`)) return "adapter import";
  if (rel === "src/storage" || rel.startsWith(`src${path.sep}storage${path.sep}`)) return "storage backend import";
  return null;
}

const problems = [];
for (const file of roots.flatMap((dir) => walk(path.join(root, dir)))) {
  const source = readFileSync(file, "utf8");
  for (const specifier of specifiers(source)) {
    const why = reason(file, specifier);
    if (why) problems.push(`${path.relative(root, file)} imports ${specifier} (${why})`);
  }
}

if (problems.length > 0) {
  console.error("Core must not import Cloudflare, Wrangler, adapters, or storage backends.");
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

console.log("core boundary ok");
