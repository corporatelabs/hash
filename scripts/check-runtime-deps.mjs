import { readFileSync } from "node:fs";

const allow = JSON.parse(readFileSync("runtime-deps.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const actual = Object.keys(pkg.dependencies ?? {}).sort();
const expected = [...(allow.dependencies ?? [])].sort();

function same(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

if (!same(actual, expected)) {
  console.error("Runtime dependencies do not match runtime-deps.json.");
  console.error(`package.json dependencies: ${actual.join(", ") || "(none)"}`);
  console.error(`allowlist: ${expected.join(", ") || "(none)"}`);
  console.error("Add a dependency only with an allowlist entry and a reason in DEPENDENCIES.md.");
  process.exit(1);
}
console.log(`runtime deps ok (${actual.length})`);
