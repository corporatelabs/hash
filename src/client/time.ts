const absoluteFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatAbsolute(ms: number): string {
  return `${absoluteFormat.format(new Date(ms))} UTC`;
}

export function formatRelative(ms: number, now: number): string {
  const delta = ms - now;
  const abs = Math.abs(delta);
  if (abs < 60_000) return relativeFormat.format(Math.round(delta / 1000), "second");
  if (abs < 60 * 60_000) return relativeFormat.format(Math.round(delta / 60_000), "minute");
  if (abs < 48 * 60 * 60_000) return relativeFormat.format(Math.round(delta / 3_600_000), "hour");
  return relativeFormat.format(Math.round(delta / 86_400_000), "day");
}

export function waitPhrase(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(1, Math.round(seconds)) : 1;
  if (safe < 90) return safe === 1 ? "1 second" : `${safe} seconds`;
  const minutes = Math.ceil(safe / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
