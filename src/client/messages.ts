import { copy } from "./copy.js";
import { RATE_LIMITS } from "../shared/protocol.js";
import { waitPhrase } from "./time.js";

export interface Notice {
  title: string;
  detail: string;
  next: string;
}

export class UiError extends Error {
  readonly code: string;
  readonly retryAfterSec: number | null;

  constructor(code: string, retryAfterSec: number | null = null) {
    super(code);
    this.name = "UiError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function failureFromResponse(status: number, body: unknown, retryAfterHeader: string | null): UiError {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : status >= 500 ? "internal" : "rejected";
  let retryAfterSec: number | null = null;
  if (isRecord(body) && typeof body.retryAfter === "number" && Number.isFinite(body.retryAfter)) {
    retryAfterSec = Math.max(1, Math.ceil(body.retryAfter));
  } else if (retryAfterHeader && /^\d+$/.test(retryAfterHeader)) {
    retryAfterSec = Number(retryAfterHeader);
  }
  return new UiError(code, retryAfterSec);
}

function windowPhrase(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function noticeFor(error: unknown, action: "create" | "open"): Notice {
  const code = error instanceof UiError ? error.code : error instanceof Error ? error.message : "rejected";
  const retry = error instanceof UiError ? error.retryAfterSec : null;
  return noticeForCode(code, retry, action);
}

export function noticeForCode(code: string, retryAfterSec: number | null, action: "create" | "open"): Notice {
  if (code === "rate_limited") {
    const rule = RATE_LIMITS[action];
    const wait = waitPhrase(retryAfterSec ?? Math.ceil(rule.windowMs / 1000));
    return {
      title: copy.rateTitle,
      detail: copy.rateDetail(wait),
      next: action === "create" ? copy.rateNextCreate(rule.limit, windowPhrase(rule.windowMs)) : copy.rateNextOpen(rule.limit, windowPhrase(rule.windowMs)),
    };
  }
  if (code === "network") return { title: copy.networkTitle, detail: copy.networkDetail, next: copy.networkNext };
  if (code === "internal") return { title: copy.internalTitle, detail: copy.internalDetail, next: copy.internalNext };
  if (code === "unavailable") return { title: copy.unavailableTitle, detail: copy.unavailableDetail, next: copy.unavailableNext };
  if (code === "misconfigured") return { title: copy.misconfiguredTitle, detail: copy.misconfiguredDetail, next: copy.misconfiguredNext };
  if (code === "clock_skew") return { title: copy.clockTitle, detail: copy.clockDetail, next: copy.clockNext };
  if (code === "origin") return { title: copy.originTitle, detail: copy.originDetail, next: copy.originNext };
  if (code === "conflict") return { title: copy.conflictTitle, detail: copy.conflictDetail, next: copy.conflictNext };
  if (code === "too_large") return { title: copy.largeTitle, detail: copy.largeDetail, next: copy.largeNext };
  if (code === "empty") return { title: copy.emptyTitle, detail: "", next: copy.emptyNext };
  if (code === "password") return { title: copy.passwordBadTitle, detail: "", next: copy.passwordBadNext };
  if (code === "timeout" || code === "worker") return { title: copy.encryptTitle, detail: "", next: copy.encryptNext };
  if (code === "kdf") return { title: copy.versionTitle, detail: "", next: copy.versionNext };
  if (code === "metadata") return { title: copy.metadataTitle, detail: "", next: copy.metadataNext };
  return { title: copy.rejectedTitle, detail: "", next: copy.rejectedNext };
}

export function goneNotice(reason: "expired" | "burned" | "missing"): Notice {
  if (reason === "expired") return { title: copy.expiredTitle, detail: copy.expiredDetail, next: copy.expiredNext };
  if (reason === "burned") return { title: copy.burnedTitle, detail: copy.burnedDetail, next: copy.burnedNext };
  return { title: copy.missingTitle, detail: copy.missingDetail, next: copy.missingNext };
}

export function wrongPasswordNotice(burned: boolean): Notice {
  if (burned) return { title: copy.wrongTitle, detail: copy.wrongBurned, next: copy.wrongBurnedNext };
  const rule = RATE_LIMITS.open;
  return {
    title: copy.wrongTitle,
    detail: copy.wrongStill,
    next: copy.wrongNext(rule.limit, windowPhrase(rule.windowMs)),
  };
}
