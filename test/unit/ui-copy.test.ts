import { describe, expect, it } from "vitest";
import { goneNotice, noticeForCode, wrongPasswordNotice } from "../../src/client/messages.js";
import { formatAbsolute, formatRelative, waitPhrase } from "../../src/client/time.js";

describe("ui copy", () => {
  it("formats expiry in absolute UTC and relative terms", () => {
    const now = Date.UTC(2026, 10, 21, 12, 0, 0);
    expect(formatAbsolute(now)).toBe("21 Nov 2026, 12:00 UTC");
    expect(formatRelative(now + 7 * 24 * 60 * 60 * 1000, now)).toBe("in 7 days");
    expect(waitPhrase(45)).toBe("45 seconds");
    expect(waitPhrase(120)).toBe("2 minutes");
  });

  it("gives a next step and does not invent a remaining-attempt count", () => {
    const limited = noticeForCode("rate_limited", 42, "open");
    expect(limited.detail).toContain("42 seconds");
    expect(limited.next).toContain("30");
    expect(limited.detail).not.toMatch(/attempt \d+ of/i);
    const wrong = wrongPasswordNotice(false);
    expect(wrong.next).toContain("try again");
    const burned = wrongPasswordNotice(true);
    expect(burned.detail).toContain("already gone");
    expect(burned.next).toContain("new link");
    const missing = goneNotice("missing");
    expect(missing.detail).toContain("cannot tell those apart");
    const fragment = noticeForCode("network", null, "create");
    expect(fragment.next.length).toBeGreaterThan(0);
  });
});