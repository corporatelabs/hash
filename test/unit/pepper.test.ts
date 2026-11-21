import { describe, expect, it } from "vitest";
import { pepperProblem } from "../../src/core/rate-key.js";
import { DEV_PEPPER } from "../../src/shared/protocol.js";

describe("rate-limit pepper", () => {
  it("allows the placeholder only outside production", () => {
    expect(pepperProblem("development", DEV_PEPPER)).toBeNull();
    expect(pepperProblem("test", DEV_PEPPER)).toBeNull();
    expect(pepperProblem("production", DEV_PEPPER)).toBe("dev_pepper");
    expect(pepperProblem("production", "")).toBe("short_pepper");
    expect(pepperProblem("production", "a-real-pepper-value")).toBeNull();
  });
});
