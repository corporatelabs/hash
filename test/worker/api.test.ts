import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { exerciseHashApi, type ApiCall } from "../../scripts/api-parity.js";
import { createBody, sampleRecord } from "../helpers/record.js";

function request(path: string, init: ApiCall): Promise<Response> {
  const headers = new Headers({ "cf-connecting-ip": init.ip });
  if (init.body) headers.set("content-type", "application/json");
  if (init.origin) headers.set("origin", init.origin);
  const requestInit: RequestInit = { method: init.method, headers };
  if (init.body !== undefined) requestInit.body = init.body;
  return SELF.fetch(`https://hash.example${path}`, requestInit);
}

describe("worker api", () => {
  it("matches the node API", async () => {
    await exerciseHashApi({ request, allowPastExpiry: true });
  });

  it("deletes expired ciphertext from the alarm", async () => {
    const kept = sampleRecord(Date.now());
    expect(
      (
        await SELF.fetch("https://hash.example/api/snippets", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.42" },
          body: JSON.stringify(createBody(kept)),
        })
      ).status,
    ).toBe(201);
    const keptStub = env.SNIPPETS.getByName(kept.id);
    await runInDurableObject(keptStub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE snippets SET expires_at = ? WHERE id = ?", Date.now() - 1_000, kept.id);
    });
    expect(await runDurableObjectAlarm(keptStub)).toBe(true);
    const afterAlarm = await SELF.fetch(`https://hash.example/api/snippets/${kept.id}/open`, {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.43" },
    });
    expect(afterAlarm.status).toBe(410);
    expect(await afterAlarm.json()).toEqual({ error: "gone", reason: "expired" });
  });
});
