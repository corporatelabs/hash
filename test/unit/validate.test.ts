import { describe, expect, it } from "vitest";
import { expiryAllowed, parseCreateBody } from "../../src/core/validate.js";
import { createBody, sampleRecord } from "../helpers/record.js";
import { KDF_V1 } from "../../src/shared/protocol.js";

const now = 1_700_000_000_000;

describe("create validation", () => {
  it("accepts a v1 envelope inside a preset window", () => {
    const record = sampleRecord(now);
    const parsed = parseCreateBody(createBody(record), now, "production");
    expect(parsed.ok).toBe(true);
  });

  it("rejects unknown fields, weak kdf params, and a skewed clock", () => {
    const record = sampleRecord(now);
    const extra = { ...createBody(record), fragment: "nope" };
    expect(parseCreateBody(extra, now, "production").ok).toBe(false);
    const weak = createBody(record);
    (weak.kdf as { m: number }).m = 64;
    const weakParsed = parseCreateBody(weak, now, "production");
    expect(weakParsed.ok).toBe(false);
    if (!weakParsed.ok) expect(weakParsed.field).toBe("kdf");
    expect(expiryAllowed(now + 60_000, now, "production")).toBe(false);
    expect(expiryAllowed(now - 5_000, now, "test")).toBe(true);
    expect(KDF_V1.m).toBe(65_536);
  });
});
