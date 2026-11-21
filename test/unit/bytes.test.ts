import { describe, expect, it } from "vitest";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, randomBytes } from "../../src/shared/bytes.js";
import { isValidId, parseFragment, sharePath } from "../../src/shared/link.js";
import { FRAGMENT_BYTES, ID_BYTES } from "../../src/shared/protocol.js";

describe("encoding", () => {
  it("round-trips base64 and base64url", () => {
    const bytes = randomBytes(32);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64UrlToBytes(bytesToBase64Url(bytes), 32)).toEqual(bytes);
  });

  it("rejects malformed base64", () => {
    expect(base64ToBytes("@@@")).toBeNull();
    expect(base64ToBytes("YQ===")).toBeNull();
    expect(base64UrlToBytes("aa=a", 2)).toBeNull();
  });

  it("keeps the fragment out of the path", () => {
    const id = bytesToBase64Url(randomBytes(ID_BYTES));
    const fragment = randomBytes(FRAGMENT_BYTES);
    const link = sharePath(id, fragment);
    expect(link.startsWith(`/s/${id}#k=`)).toBe(true);
    expect(link.split("#")[0]).not.toContain(bytesToBase64Url(fragment));
    expect(parseFragment(`#${link.split("#")[1]}`)).toEqual(fragment);
    expect(isValidId(id)).toBe(true);
  });
});
