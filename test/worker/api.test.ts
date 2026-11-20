import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBody, sampleRecord } from "../helpers/record.js";

function headers(ip = "203.0.113.10"): HeadersInit {
  return {
    "content-type": "application/json",
    "cf-connecting-ip": ip,
  };
}

describe("worker api", () => {
  it("sets strict headers and does not cache the api", async () => {
    const response = await SELF.fetch("https://hash.example/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("wasm-unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("stores ciphertext, burns it once, and leaves the page view alone", async () => {
    const now = Date.now();
    const record = sampleRecord(now, { burnAfterRead: true });
    const created = await SELF.fetch("https://hash.example/api/snippets", {
      method: "POST",
      headers: headers("203.0.113.20"),
      body: JSON.stringify(createBody(record)),
    });
    expect(created.status).toBe(201);
    const page = await SELF.fetch(`https://hash.example/s/${record.id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const first = await SELF.fetch(`https://hash.example/api/snippets/${record.id}/open`, {
      method: "POST",
      headers: headers("203.0.113.21"),
    });
    expect(first.status).toBe(200);
    const payload = (await first.json()) as { ciphertext: string; burnAfterRead: boolean };
    expect(payload.ciphertext).toBe(record.ciphertext);
    expect(payload.burnAfterRead).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("fragment");
    const second = await SELF.fetch(`https://hash.example/api/snippets/${record.id}/open`, {
      method: "POST",
      headers: headers("203.0.113.22"),
    });
    expect(second.status).toBe(410);
    expect(await second.json()).toEqual({ error: "gone", reason: "burned" });
  });

  it("returns one success when two opens race a burn", async () => {
    const record = sampleRecord(Date.now(), { burnAfterRead: true });
    const created = await SELF.fetch("https://hash.example/api/snippets", {
      method: "POST",
      headers: headers("203.0.113.30"),
      body: JSON.stringify(createBody(record)),
    });
    expect(created.status).toBe(201);
    const [left, right] = await Promise.all([
      SELF.fetch(`https://hash.example/api/snippets/${record.id}/open`, { method: "POST", headers: headers("203.0.113.31") }),
      SELF.fetch(`https://hash.example/api/snippets/${record.id}/open`, { method: "POST", headers: headers("203.0.113.32") }),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([200, 410]);
  });

  it("deletes expired ciphertext from the alarm and from a read", async () => {
    const record = sampleRecord(Date.now(), { burnAfterRead: false });
    expect(
      (
        await SELF.fetch("https://hash.example/api/snippets", {
          method: "POST",
          headers: headers("203.0.113.40"),
          body: JSON.stringify(createBody(record)),
        })
      ).status,
    ).toBe(201);
    const stub = env.SNIPPETS.getByName(record.id);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE snippets SET expires_at = ? WHERE id = ?", Date.now() - 1_000, record.id);
    });
    const opened = await SELF.fetch(`https://hash.example/api/snippets/${record.id}/open`, {
      method: "POST",
      headers: headers("203.0.113.41"),
    });
    expect(opened.status).toBe(410);
    expect(await opened.json()).toEqual({ error: "gone", reason: "expired" });

    const kept = sampleRecord(Date.now());
    expect(
      (
        await SELF.fetch("https://hash.example/api/snippets", {
          method: "POST",
          headers: headers("203.0.113.42"),
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
      headers: headers("203.0.113.43"),
    });
    expect(afterAlarm.status).toBe(410);
    expect(await afterAlarm.json()).toEqual({ error: "gone", reason: "expired" });
  });

  it("rejects a cross-origin create and a weak kdf", async () => {
    const record = sampleRecord(Date.now());
    const cross = await SELF.fetch("https://hash.example/api/snippets", {
      method: "POST",
      headers: { ...headers("203.0.113.50"), origin: "https://evil.example" },
      body: JSON.stringify(createBody(record)),
    });
    expect(cross.status).toBe(403);
    const weak = createBody(record);
    (weak.kdf as { m: number }).m = 8;
    const bad = await SELF.fetch("https://hash.example/api/snippets", {
      method: "POST",
      headers: headers("203.0.113.51"),
      body: JSON.stringify(weak),
    });
    expect(bad.status).toBe(400);
  });

  it("rate limits creates", async () => {
    const ip = "203.0.113.60";
    let limited = 0;
    for (let i = 0; i < 12; i += 1) {
      const response = await SELF.fetch("https://hash.example/api/snippets", {
        method: "POST",
        headers: headers(ip),
        body: JSON.stringify(createBody(sampleRecord(Date.now()))),
      });
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
