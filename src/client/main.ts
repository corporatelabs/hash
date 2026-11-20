import { newSnippetId, openInBrowser, sealInBrowser } from "./bridge.js";
import { parseFragment, parseSnippetPath, sharePath } from "../shared/link.js";
import { passwordStrength, generatePassword } from "../shared/password.js";
import {
  DEFAULT_EXPIRY,
  EXPIRY_PRESETS,
  MAX_PLAINTEXT_BYTES,
  type ExpiryPresetId,
  type GoneReason,
  type KdfParams,
} from "../shared/protocol.js";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("missing app root");
const app: HTMLElement = root;

const utf8 = new TextEncoder();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const child of children) node.append(child);
  return node;
}

function shell(readout: string, panel: HTMLElement): void {
  app.replaceChildren(
    el(
      "div",
      { className: "shell" },
      el(
        "header",
        { className: "brand" },
        el("div", { className: "meta" }, el("span", { text: "Corporate Labs" }), el("span", { text: "v1" })),
        el("h1", {}, el("span", { className: "mark", text: "#" }), document.createTextNode("hash")),
        el("p", { className: "lede", text: "A short link for a secret the server is not allowed to read." }),
      ),
      el("section", { className: "panel" }, el("div", { className: "readout", text: readout }), panel),
    ),
  );
}

function bytesOf(value: string): number {
  return utf8.encode(value).length;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function renderCreate(): void {
  const form = el("form");
  form.noValidate = true;
  const secret = el("textarea");
  secret.required = true;
  secret.maxLength = MAX_PLAINTEXT_BYTES;
  secret.spellcheck = false;
  secret.autocomplete = "off";
  secret.setAttribute("aria-label", "Secret");
  secret.placeholder = "A token, a config fragment, a note.";
  const counter = el("span", { className: "counter", text: "0 / 64 KB" });
  const secretLabel = el("label", {}, el("span", {}, el("span", { text: "Secret" }), counter), secret);

  const password = el("input");
  password.type = "password";
  password.autocomplete = "new-password";
  password.required = true;
  password.setAttribute("aria-describedby", "strength-label");
  const show = el("button", { className: "ghost", text: "Show" });
  show.type = "button";
  const generate = el("button", { className: "ghost", text: "Generate" });
  generate.type = "button";
  const passwordRow = el("div", { className: "password-row" }, password, show, generate);
  const passwordLabel = el("label", {}, el("span", { text: "Password" }), passwordRow);

  const meter = document.createElement("meter");
  meter.min = 0;
  meter.max = 4;
  meter.low = 2;
  meter.high = 3;
  meter.optimum = 4;
  meter.value = 0;
  const meterLabel = el("span", { className: "meter-label", text: "Too weak" });
  meterLabel.id = "strength-label";
  const meterRow = el("div", { className: "meter" }, meter, meterLabel);

  let expiry: ExpiryPresetId = DEFAULT_EXPIRY;
  const segment = el("div", { className: "segment" });
  segment.setAttribute("role", "radiogroup");
  segment.setAttribute("aria-label", "Expiry");
  for (const preset of EXPIRY_PRESETS) {
    const button = el("button", { text: preset.label });
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", preset.id === expiry ? "true" : "false");
    button.addEventListener("click", () => {
      expiry = preset.id;
      for (const child of segment.querySelectorAll("button")) child.setAttribute("aria-checked", "false");
      button.setAttribute("aria-checked", "true");
    });
    segment.append(button);
  }

  const burn = el("input");
  burn.type = "checkbox";
  const burnCopy = el(
    "div",
    {},
    el("strong", { text: "Burn after the first view" }),
    el(
      "p",
      {
        className: "note",
        text: "The ciphertext is deleted when it is fetched, before this page can try the password. A wrong password destroys a one-time secret. The server cannot tell those cases apart.",
      },
    ),
  );
  const burnRow = el("label", { className: "burn" }, burn, burnCopy);

  const submit = el("button", { className: "primary", text: "Create link" });
  submit.type = "submit";
  const status = el("p", { className: "status" });
  status.setAttribute("role", "status");
  const error = el("p", { className: "error" });
  error.setAttribute("role", "alert");

  form.append(
    secretLabel,
    passwordLabel,
    meterRow,
    el("div", { className: "field-label", text: "Expires" }),
    segment,
    burnRow,
    submit,
    status,
    error,
    el("p", {
      className: "footer",
      text: "No accounts. No recovery. Lose the password or the link, and the secret is gone.",
    }),
  );

  const paintStrength = () => {
    const score = passwordStrength(password.value);
    meter.value = score.score;
    meterLabel.textContent = score.label;
  };
  password.addEventListener("input", paintStrength);
  secret.addEventListener("input", () => {
    const size = bytesOf(secret.value);
    counter.textContent = `${(size / 1024).toFixed(1)} / 64 KB`;
  });
  show.addEventListener("click", () => {
    const hidden = password.type === "password";
    password.type = hidden ? "text" : "password";
    show.textContent = hidden ? "Hide" : "Show";
  });
  generate.addEventListener("click", () => {
    password.type = "text";
    show.textContent = "Hide";
    password.value = generatePassword();
    paintStrength();
    password.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.textContent = "";
    const plain = secret.value;
    if (bytesOf(plain) === 0) {
      error.textContent = "Write something to seal.";
      return;
    }
    if (bytesOf(plain) > MAX_PLAINTEXT_BYTES) {
      error.textContent = "That secret is over 64 KB.";
      return;
    }
    const strength = passwordStrength(password.value);
    if (strength.score === 0) {
      error.textContent = "Use a longer password, or generate one. Short and common passwords are refused here.";
      return;
    }
    const preset = EXPIRY_PRESETS.find((item) => item.id === expiry);
    if (!preset) return;
    const snapshot = {
      plaintext: plain,
      password: password.value,
      id: newSnippetId(),
      expiresAt: Date.now() + preset.ms,
      burnAfterRead: burn.checked,
    };
    submit.disabled = true;
    status.textContent = "Sealing in this browser…";
    void sealAndCreate(snapshot)
      .then((url) => {
        renderSealed(url, snapshot.expiresAt, snapshot.burnAfterRead);
      })
      .catch((reason: unknown) => {
        submit.disabled = false;
        status.textContent = "";
        error.textContent = reason instanceof Error ? messageFor(reason.message) : "Could not create the link.";
      });
  });

  shell("01  /  Seal", form);
}

async function sealAndCreate(input: {
  plaintext: string;
  password: string;
  id: string;
  expiresAt: number;
  burnAfterRead: boolean;
}): Promise<string> {
  const sealed = await sealInBrowser(input);
  const response = await fetch("/api/snippets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: sealed.id,
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      salt: sealed.salt,
      expiresAt: sealed.expiresAt,
      burnAfterRead: sealed.burnAfterRead,
      kdf: sealed.kdf,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(body, response.status));
  if (!isCreateResponse(body) || body.expiresAt !== sealed.expiresAt || body.burnAfterRead !== sealed.burnAfterRead) {
    throw new Error("The server stored different metadata than the one sealed in this browser.");
  }
  const fragment = parseFragment(`#k=${sealed.fragment}`);
  if (!fragment) throw new Error("invalid");
  return new URL(sharePath(sealed.id, fragment), location.origin).toString();
}

function renderSealed(url: string, expiresAt: number, burn: boolean): void {
  const field = el("input", { className: "link" });
  field.type = "text";
  field.readOnly = true;
  field.value = url;
  const copy = el("button", { className: "primary", text: "Copy link" });
  copy.type = "button";
  copy.addEventListener("click", () => {
    void copyText(url).then((ok) => {
      copy.textContent = ok ? "Copied" : "Copy the field";
    });
  });
  const again = el("button", { className: "ghost", text: "Seal another" });
  again.type = "button";
  again.addEventListener("click", () => renderCreate());
  const panel = el(
    "div",
    {},
    el("h2", { text: "Sealed" }),
    el("p", {
      className: "note",
      text: "Send the whole link. The part after # never reaches the server, and it is not stored anywhere else.",
    }),
    field,
    el("div", { className: "result-actions" }, copy, again),
    el("p", {
      className: "fine",
      text: `${burn ? "Burns on the first view. " : ""}Expires ${formatTime(expiresAt)}. A lost password cannot be reset.`,
    }),
  );
  shell("02  /  Link", panel);
  field.focus();
  field.select();
}

function renderOpen(id: string): void {
  const fragment = parseFragment(location.hash);
  if (!fragment) {
    shell(
      "00  /  Incomplete",
      el(
        "div",
        {},
        el("h2", { text: "This link is missing its key." }),
        el("p", {
          className: "note",
          text: "The part after # is required to decrypt, and this server never had it. Ask for the full link.",
        }),
      ),
    );
    return;
  }
  const form = el("form");
  const password = el("input");
  password.type = "password";
  password.autocomplete = "current-password";
  password.required = true;
  const submit = el("button", { className: "primary", text: "Open" });
  submit.type = "submit";
  const status = el("p", { className: "status" });
  status.setAttribute("role", "status");
  const error = el("p", { className: "error" });
  error.setAttribute("role", "alert");
  form.append(
    el("h2", { text: "Sealed note" }),
    el("p", {
      className: "note",
      text: "The password stays in this browser. Wrong passwords on a one-time link destroy it.",
    }),
    el("label", {}, el("span", { text: "Password" }), password),
    submit,
    status,
    error,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    status.textContent = "Opening…";
    const typed = password.value;
    void openSnippet(id, typed)
      .then((result) => {
        if (result.kind === "gone") {
          renderGone(result.reason);
          return;
        }
        if (result.kind === "bad") {
          submit.disabled = false;
          status.textContent = "";
          error.textContent = result.burned
            ? "That password did not open it. This was a one-time secret, so the ciphertext is already gone."
            : "That password did not open it.";
          return;
        }
        renderSecret(result.plaintext, result.burned, result.expiresAt);
      })
      .catch((reason: unknown) => {
        submit.disabled = false;
        status.textContent = "";
        error.textContent = reason instanceof Error ? messageFor(reason.message) : "Could not open the secret.";
      });
  });
  shell("01  /  Open", form);
  password.focus();
}

async function openSnippet(
  id: string,
  password: string,
): Promise<
  | { kind: "secret"; plaintext: string; burned: boolean; expiresAt: number }
  | { kind: "bad"; burned: boolean }
  | { kind: "gone"; reason: GoneReason }
> {
  const response = await fetch(`/api/snippets/${id}/open`, { method: "POST" });
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 404 || response.status === 410) {
    return { kind: "gone", reason: goneReason(body) };
  }
  if (!response.ok || !isEnvelope(body)) throw new Error(apiError(body, response.status));
  const fragment = parseFragment(location.hash);
  if (!fragment) return { kind: "gone", reason: "missing" };
  try {
    const plaintext = await openInBrowser({
      password,
      fragment: location.hash.replace(/^#k=/, ""),
      envelope: body,
    });
    return { kind: "secret", plaintext, burned: body.burnAfterRead, expiresAt: body.expiresAt };
  } catch (error) {
    if (error instanceof Error && error.message === "decrypt") return { kind: "bad", burned: body.burnAfterRead };
    throw error;
  }
}

function renderSecret(plaintext: string, burned: boolean, expiresAt: number): void {
  const block = el("pre", { className: "secret", text: plaintext });
  const copy = el("button", { className: "primary", text: "Copy secret" });
  copy.type = "button";
  copy.addEventListener("click", () => {
    void copyText(plaintext).then((ok) => {
      copy.textContent = ok ? "Copied" : "Select the text";
    });
  });
  const hide = el("button", { className: "ghost", text: "Hide" });
  hide.type = "button";
  hide.addEventListener("click", () => {
    block.textContent = "";
    copy.disabled = true;
    hide.disabled = true;
  });
  const panel = el(
    "div",
    {},
    el("h2", { text: "Open" }),
    burned ? el("p", { className: "ok", text: "This was a one-time secret. It is gone from the server." }) : el("p", { className: "fine", text: `Expires ${formatTime(expiresAt)}.` }),
    block,
    el("div", { className: "result-actions" }, copy, hide),
    el("p", { className: "footer", text: "Clear it from this page when you are done. The clipboard is yours to wipe." }),
  );
  shell("02  /  Plaintext", panel);
}

function renderGone(reason: GoneReason): void {
  const copy =
    reason === "expired"
      ? "This secret expired and was deleted."
      : reason === "burned"
        ? "This one-time secret was already opened."
        : "There is no secret for this link.";
  shell("00  /  Gone", el("div", {}, el("h2", { text: "Gone" }), el("p", { className: "note", text: copy })));
}

function renderMissing(): void {
  shell("00  /  Gone", el("div", {}, el("h2", { text: "Gone" }), el("p", { className: "note", text: "This page does not exist." })));
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(ms)) + " UTC";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCreateResponse(value: unknown): value is { id: string; expiresAt: number; burnAfterRead: boolean } {
  return isRecord(value) && typeof value.expiresAt === "number" && typeof value.burnAfterRead === "boolean" && typeof value.id === "string";
}

function isEnvelope(value: unknown): value is {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.ciphertext === "string" &&
    typeof value.nonce === "string" &&
    typeof value.salt === "string" &&
    typeof value.expiresAt === "number" &&
    typeof value.burnAfterRead === "boolean" &&
    isRecord(value.kdf)
  );
}

function goneReason(value: unknown): GoneReason {
  if (isRecord(value) && (value.reason === "expired" || value.reason === "burned" || value.reason === "missing")) {
    return value.reason;
  }
  return "missing";
}

function apiError(value: unknown, status: number): string {
  if (isRecord(value) && value.error === "clock_skew") return "Your clock is more than a couple of minutes off. Check the time and try again.";
  if (isRecord(value) && value.error === "rate_limited") return "Too many attempts from this network. Wait and try again.";
  if (isRecord(value) && value.error === "misconfigured") return "This server is refusing new secrets until its rate-limit pepper is set.";
  if (isRecord(value) && value.error === "unavailable") return "Storage is unavailable.";
  if (status === 413) return "That secret is too large.";
  return "The server rejected the request.";
}

function messageFor(code: string): string {
  if (code === "empty") return "Write something to seal.";
  if (code === "too_large") return "That secret is over 64 KB.";
  if (code === "password") return "That password cannot be used.";
  if (code === "timeout" || code === "worker") return "Encryption did not finish. Try again.";
  if (code === "kdf") return "This note uses an unsupported encryption version.";
  return code;
}

const pathId = parseSnippetPath(location.pathname);
if (location.pathname === "/") renderCreate();
else if (pathId) renderOpen(pathId);
else if (location.pathname.startsWith("/s/")) renderGone("missing");
else renderMissing();
