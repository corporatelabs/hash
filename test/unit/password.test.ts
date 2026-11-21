import { describe, expect, it } from "vitest";
import { generatePassword, passwordAlphabet, passwordStrength } from "../../src/shared/password.js";

describe("passwords", () => {
  it("generates a grouped password from the unambiguous alphabet", () => {
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){4}$/);
    const alphabet = passwordAlphabet();
    for (const char of password.replaceAll("-", "")) expect(alphabet.includes(char)).toBe(true);
    expect(passwordStrength(password).score).toBe(4);
  });

  it("rejects common and tiny passwords", () => {
    expect(passwordStrength("password").score).toBe(0);
    expect(passwordStrength("short").label).toBe("Too weak");
  });
});
