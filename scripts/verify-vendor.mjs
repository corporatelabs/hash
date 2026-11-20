import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const file = "vendor/hash-wasm/index.esm.js";
const expected = "f3e4fde16c83c8e70ca77f208ebb0885c6658ce2574f51eae3a49e93d3c3ffd8";
const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
if (digest !== expected) {
  console.error(`${file} sha256 ${digest} does not match ${expected}`);
  process.exit(1);
}
console.log(`vendor ok ${file}`);
