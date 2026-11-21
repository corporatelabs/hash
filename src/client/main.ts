import { newSnippetId, openInBrowser, sealInBrowser, type CryptoProgress } from "./bridge.js";
import { copy } from "./copy.js";
import { failureFromResponse, goneNotice, noticeFor, wrongPasswordNotice, type Notice, UiError } from "./messages.js";
import { formatAbsolute, formatRelative } from "./time.js";
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

function anchor(href: string, text: string): HTMLAnchorElement {
  const node = document.createElement("a");
  node.href = href;
  node.textContent = text;
  node.rel = "noreferrer";
  return node;
}

function howItWorks(): HTMLElement {
  const details = el("details", { className: "how" });
  const list = el("ul", { className: "facts" });
  for (const point of copy.howPoints) list.append(el("li", { text: point }));
  details.append(el("summary", { text: copy.howSummary }), list, anchor(copy.threatModelHref, copy.threatModel));
  return details;
}

function shell(readout: string, panel: HTMLElement, title: string): void {
  document.title = title;
  const main = el("main", { className: "panel" }, el("div", { className: "readout", text: readout }), panel, howItWorks());
  main.id = "main";
  main.tabIndex = -1;
  const skip = anchor("#main", copy.skip);
  skip.className = "skip";
  app.replaceChildren(
    el(
      "div",
      { className: "shell" },
      skip,
      el(
        "header",
        { className: "brand" },
        el("div", { className: "meta" }, el("span", { text: copy.brand }), el("span", { text: copy.version })),
        el("h1", {}, el("span", { className: "mark", text: "#" }), document.createTextNode(copy.product)),
        el("p", { className: "lede", text: copy.lede }),
      ),
      main,
    ),
  );
}

function fillNotice(box: HTMLElement, notice: Notice): void {
  box.replaceChildren();
  box.append(el("p", { className: "notice-title", text: notice.title }));
  if (notice.detail) box.append(el("p", { text: notice.detail }));
  if (notice.next) box.append(el("p", { className: "next", text: notice.next }));
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

function flashCopy(button: HTMLButtonElement, live: HTMLElement, value: string): void {
  window.clearTimeout(Number(button.dataset.timer ?? "0"));
  void copyText(value).then((ok) => {
    live.textContent = ok ? copy.copied : copy.copyFailed;
    const timer = window.setTimeout(() => {
      live.textContent = "";
    }, 2500);
    button.dataset.timer = String(timer);
  });
}

function setBusy(form: HTMLFormElement, busy: boolean): void {
  form.setAttribute("aria-busy", busy ? "true" : "false");
  for (const control of form.querySelectorAll("button, input, textarea")) {
    if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      control.disabled = busy;
    }
  }
}

function focusNotice(node: HTMLElement): void {
  node.focus();
}

function strengthHint(password: string): string {
  if (password.length === 0) return copy.strengthEmpty;
  const score = passwordStrength(password).score;
  if (score === 0) return copy.strengthTooWeak;
  if (score === 1) return copy.strengthWeak;
  if (score === 2) return copy.strengthOkay;
  if (score === 3) return copy.strengthStrong;
  return copy.strengthVery;
}

function renderCreate(): void {
  const form = el("form");
  form.noValidate = true;
  form.setAttribute("aria-describedby", "guarantees");

  const facts = el(
    "ul",
    { className: "facts" },
    el("li", { text: copy.factPassword }),
    el("li", { text: copy.factCiphertext }),
    el("li", { text: copy.factRecovery }),
    el("li", { text: copy.factBoth }),
  );
  facts.id = "guarantees";

  const secret = el("textarea");
  secret.id = "secret";
  secret.required = true;
  secret.maxLength = MAX_PLAINTEXT_BYTES;
  secret.spellcheck = false;
  secret.autocomplete = "off";
  secret.placeholder = copy.secretPlaceholder;
  const counter = el("span", { className: "counter", text: copy.byteCount("0.0") });
  const secretLabel = el("label", {}, el("span", {}, el("span", { text: copy.secretLabel }), counter), secret);
  secretLabel.htmlFor = secret.id;

  const password = el("input");
  password.id = "password";
  password.type = "password";
  password.autocomplete = "new-password";
  password.required = true;
  password.setAttribute("aria-describedby", "strength-label strength-hint");
  const show = el("button", { className: "ghost", text: copy.show });
  show.type = "button";
  show.setAttribute("aria-pressed", "false");
  show.setAttribute("aria-controls", password.id);
  const generate = el("button", { className: "ghost", text: copy.generate });
  generate.type = "button";
  generate.setAttribute("aria-label", copy.generateName);
  const passwordRow = el("div", { className: "password-row" }, password, show, generate);
  const passwordLabel = el("label", {}, el("span", { text: copy.passwordLabel }), passwordRow);
  passwordLabel.htmlFor = password.id;

  const meter = document.createElement("meter");
  meter.min = 0;
  meter.max = 4;
  meter.low = 2;
  meter.high = 3;
  meter.optimum = 4;
  meter.value = 0;
  meter.setAttribute("aria-labelledby", "strength-label");
  const meterLabel = el("span", { className: "meter-label", text: passwordStrength("").label });
  meterLabel.id = "strength-label";
  const meterRow = el("div", { className: "meter" }, meter, meterLabel);
  const hint = el("p", { className: "hint", text: copy.strengthEmpty });
  hint.id = "strength-hint";

  let expiry: ExpiryPresetId = DEFAULT_EXPIRY;
  const segment = el("div", { className: "segment" });
  segment.setAttribute("role", "radiogroup");
  segment.setAttribute("aria-labelledby", "expiry-legend");
  segment.setAttribute("aria-describedby", "expiry-hint");
  const expiryButtons: HTMLButtonElement[] = [];
  const selectExpiry = (index: number) => {
    const preset = EXPIRY_PRESETS[index];
    if (!preset) return;
    expiry = preset.id;
    expiryButtons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === index;
      button.setAttribute("aria-checked", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
  };
  EXPIRY_PRESETS.forEach((preset, index) => {
    const button = el("button", { text: preset.label });
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", preset.id === expiry ? "true" : "false");
    button.tabIndex = preset.id === expiry ? 0 : -1;
    button.addEventListener("click", () => selectExpiry(index));
    expiryButtons.push(button);
    segment.append(button);
  });
  segment.addEventListener("keydown", (event) => {
    const index = expiryButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const key = event.key;
    if (key !== "ArrowRight" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowUp" && key !== "Home" && key !== "End") {
      return;
    }
    event.preventDefault();
    let next = index;
    if (key === "ArrowRight" || key === "ArrowDown") next = (index + 1) % expiryButtons.length;
    if (key === "ArrowLeft" || key === "ArrowUp") next = (index - 1 + expiryButtons.length) % expiryButtons.length;
    if (key === "Home") next = 0;
    if (key === "End") next = expiryButtons.length - 1;
    selectExpiry(next);
    expiryButtons[next]?.focus();
  });

  const expiryHint = el("p", { className: "hint", text: copy.expiresHint });
  expiryHint.id = "expiry-hint";
  const legend = el("legend", { text: copy.expiresLegend });
  legend.id = "expiry-legend";
  const expiryField = el("fieldset", {}, legend, expiryHint, segment);

  const burn = el("input");
  burn.id = "burn";
  burn.type = "checkbox";
  const burnCopy = el("div", {}, el("strong", { text: copy.burnTitle }), el("p", { className: "hint", text: copy.burnHint }));
  const burnRow = el("label", { className: "burn" }, burn, burnCopy);
  burnRow.htmlFor = burn.id;

  const submit = el("button", { className: "primary", text: copy.create });
  submit.type = "submit";
  const status = el("p", { className: "status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.tabIndex = -1;
  const error = el("div", { className: "notice error-notice" });
  error.setAttribute("role", "alert");
  error.tabIndex = -1;
  error.hidden = true;

  form.append(facts, secretLabel, passwordLabel, meterRow, hint, expiryField, burnRow, submit, status, error);

  const paintStrength = () => {
    const score = passwordStrength(password.value);
    meter.value = score.score;
    meterLabel.textContent = score.label;
    meter.setAttribute("aria-valuetext", score.label);
    hint.textContent = strengthHint(password.value);
  };
  password.addEventListener("input", paintStrength);
  secret.addEventListener("input", () => {
    counter.textContent = copy.byteCount((bytesOf(secret.value) / 1024).toFixed(1));
    secret.setAttribute("aria-invalid", "false");
  });
  show.addEventListener("click", () => {
    const hidden = password.type === "password";
    password.type = hidden ? "text" : "password";
    show.textContent = hidden ? copy.hide : copy.show;
    show.setAttribute("aria-pressed", hidden ? "true" : "false");
  });
  generate.addEventListener("click", () => {
    password.type = "text";
    show.textContent = copy.hide;
    show.setAttribute("aria-pressed", "true");
    password.value = generatePassword();
    paintStrength();
    password.focus();
  });

  let busy = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    error.hidden = true;
    secret.setAttribute("aria-invalid", "false");
    password.setAttribute("aria-invalid", "false");
    const plain = secret.value;
    if (bytesOf(plain) === 0) {
      secret.setAttribute("aria-invalid", "true");
      error.hidden = false;
      fillNotice(error, { title: copy.emptyTitle, detail: "", next: copy.emptyNext });
      secret.focus();
      return;
    }
    if (bytesOf(plain) > MAX_PLAINTEXT_BYTES) {
      secret.setAttribute("aria-invalid", "true");
      error.hidden = false;
      fillNotice(error, { title: copy.largeTitle, detail: copy.largeDetail, next: copy.largeNext });
      focusNotice(error);
      return;
    }
    if (passwordStrength(password.value).score === 0) {
      password.setAttribute("aria-invalid", "true");
      error.hidden = false;
      fillNotice(error, { title: copy.weakTitle, detail: copy.weakDetail, next: copy.weakNext });
      password.focus();
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
    busy = true;
    setBusy(form, true);
    status.textContent = copy.progressKdf;
    focusNotice(status);
    void sealAndCreate(snapshot, (stage) => {
      if (stage === "kdf") status.textContent = copy.progressKdf;
      if (stage === "encrypt") status.textContent = copy.progressEncrypt;
      if (stage === "upload") status.textContent = copy.progressUpload;
    })
      .then((url) => {
        renderSealed(url, snapshot.expiresAt, snapshot.burnAfterRead);
      })
      .catch((reason: unknown) => {
        busy = false;
        setBusy(form, false);
        status.textContent = "";
        error.hidden = false;
        fillNotice(error, noticeFor(reason, "create"));
        focusNotice(error);
      });
  });

  shell(copy.readoutCreate, form, copy.titleCreate);
  secret.focus();
}

async function sealAndCreate(
  input: {
    plaintext: string;
    password: string;
    id: string;
    expiresAt: number;
    burnAfterRead: boolean;
  },
  onProgress: (stage: CryptoProgress | "upload") => void,
): Promise<string> {
  const sealed = await sealInBrowser(input, onProgress);
  onProgress("upload");
  let response: Response;
  try {
    response = await fetch("/api/snippets", {
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
  } catch {
    throw new UiError("network");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw failureFromResponse(response.status, body, response.headers.get("retry-after"));
  if (!isCreateResponse(body) || body.expiresAt !== sealed.expiresAt || body.burnAfterRead !== sealed.burnAfterRead) {
    throw new UiError("metadata");
  }
  const fragment = parseFragment(`#k=${sealed.fragment}`);
  if (!fragment) throw new UiError("rejected");
  return new URL(sharePath(sealed.id, fragment), location.origin).toString();
}

function summaryList(expiresAt: number, burn: boolean): HTMLDListElement {
  const list = el("dl", { className: "summary" });
  const when = formatAbsolute(expiresAt);
  const relative = formatRelative(expiresAt, Date.now());
  list.append(
    term(copy.summaryExpires, copy.expiryLine(when, relative)),
    term(copy.summaryViews, burn ? copy.viewsOnce : copy.viewsAgain),
    term(copy.summaryPassword, copy.differentChannel),
  );
  return list;
}

function term(name: string, value: string): HTMLDivElement {
  return el("div", {}, el("dt", { text: name }), el("dd", { text: value }));
}

function renderSealed(url: string, expiresAt: number, burn: boolean): void {
  const field = el("input", { className: "link" });
  field.id = "share-link";
  field.type = "text";
  field.readOnly = true;
  field.value = url;
  const linkLabel = el("label", { className: "field-label", text: copy.linkLabel });
  linkLabel.htmlFor = field.id;
  const copied = el("p", { className: "copied" });
  copied.setAttribute("role", "status");
  copied.setAttribute("aria-live", "polite");
  const copyButton = el("button", { className: "primary", text: copy.copyLink });
  copyButton.type = "button";
  copyButton.addEventListener("click", () => flashCopy(copyButton, copied, url));
  const again = el("button", { className: "ghost", text: copy.sealAnother });
  again.type = "button";
  again.addEventListener("click", () => renderCreate());
  const heading = el("h2", { text: copy.sealedTitle });
  heading.tabIndex = -1;
  const panel = el(
    "div",
    {},
    heading,
    el("p", { className: "note", text: copy.sealedNote }),
    linkLabel,
    field,
    el("div", { className: "result-actions" }, copyButton, again),
    copied,
    summaryList(expiresAt, burn),
  );
  shell(copy.readoutLink, panel, copy.titleLink);
  heading.focus();
  field.select();
}

function renderOpen(id: string): void {
  const fragment = parseFragment(location.hash);
  if (!fragment) {
    renderStopped(fragmentNotice());
    return;
  }
  const form = el("form");
  const password = el("input");
  password.id = "open-password";
  password.type = "password";
  password.autocomplete = "current-password";
  password.required = true;
  const submit = el("button", { className: "primary", text: copy.openSubmit });
  submit.type = "submit";
  const preview = el("div", { className: "preview" });
  preview.hidden = true;
  preview.setAttribute("aria-live", "polite");
  const status = el("p", { className: "status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.tabIndex = -1;
  const error = el("div", { className: "notice error-notice" });
  error.setAttribute("role", "alert");
  error.tabIndex = -1;
  error.hidden = true;
  const heading = el("h2", { text: copy.openTitle });
  heading.tabIndex = -1;
  form.append(
    heading,
    el("p", { className: "note", text: copy.openStay }),
    el("p", { className: "warn", text: copy.openBurnWarning }),
    el("p", { className: "hint", text: copy.openExpiryUnknown }),
    preview,
    el("label", {}, el("span", { text: copy.passwordLabel }), password),
    submit,
    status,
    error,
  );
  let busy = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    error.hidden = true;
    busy = true;
    setBusy(form, true);
    status.textContent = copy.progressFetch;
    focusNotice(status);
    const typed = password.value;
    void openSnippet(id, typed, (stage) => {
      if (stage === "kdf" || stage === "decrypt") status.textContent = stage === "kdf" ? copy.progressKdf : copy.progressDecrypt;
    }, (envelope) => {
      preview.hidden = false;
      const when = formatAbsolute(envelope.expiresAt);
      const relative = formatRelative(envelope.expiresAt, Date.now());
      preview.replaceChildren(
        envelope.burnAfterRead
          ? el("div", {}, el("strong", { text: copy.previewOnceTitle }), el("p", { text: copy.previewOnce }), el("p", { className: "fine", text: copy.expiryLine(when, relative) }))
          : el("p", { text: copy.previewAgain(when, relative) }),
      );
    })
      .then((result) => {
        if (result.kind === "gone") {
          renderStopped(goneNotice(result.reason));
          return;
        }
        if (result.kind === "bad") {
          if (result.burned) {
            renderStopped(wrongPasswordNotice(true));
            return;
          }
          busy = false;
          setBusy(form, false);
          status.textContent = "";
          error.hidden = false;
          fillNotice(error, wrongPasswordNotice(false));
          focusNotice(error);
          password.focus();
          return;
        }
        renderSecret(result.plaintext, result.burned, result.expiresAt);
      })
      .catch((reason: unknown) => {
        busy = false;
        setBusy(form, false);
        status.textContent = "";
        error.hidden = false;
        fillNotice(error, noticeFor(reason, "open"));
        focusNotice(error);
      });
  });
  shell(copy.readoutOpen, form, copy.titleOpen);
  password.focus();
}

async function openSnippet(
  id: string,
  password: string,
  onProgress: (stage: CryptoProgress) => void,
  onEnvelope: (envelope: Envelope) => void,
): Promise<
  | { kind: "secret"; plaintext: string; burned: boolean; expiresAt: number }
  | { kind: "bad"; burned: boolean }
  | { kind: "gone"; reason: GoneReason }
> {
  let response: Response;
  try {
    response = await fetch(`/api/snippets/${id}/open`, { method: "POST" });
  } catch {
    throw new UiError("network");
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 404 || response.status === 410) return { kind: "gone", reason: goneReason(body) };
  if (!response.ok || !isEnvelope(body)) throw failureFromResponse(response.status, body, response.headers.get("retry-after"));
  const fragment = parseFragment(location.hash);
  if (!fragment) return { kind: "gone", reason: "missing" };
  onEnvelope(body);
  try {
    const plaintext = await openInBrowser(
      { password, fragment: location.hash.replace(/^#k=/, ""), envelope: body },
      onProgress,
    );
    return { kind: "secret", plaintext, burned: body.burnAfterRead, expiresAt: body.expiresAt };
  } catch (error) {
    if (error instanceof Error && error.message === "decrypt") return { kind: "bad", burned: body.burnAfterRead };
    throw error;
  }
}

function renderSecret(plaintext: string, burned: boolean, expiresAt: number): void {
  const block = el("pre", { className: "secret", text: plaintext });
  block.tabIndex = 0;
  block.setAttribute("aria-label", copy.secretLabel);
  const copied = el("p", { className: "copied" });
  copied.setAttribute("role", "status");
  copied.setAttribute("aria-live", "polite");
  const copyButton = el("button", { className: "primary", text: copy.copySecret });
  copyButton.type = "button";
  copyButton.addEventListener("click", () => flashCopy(copyButton, copied, plaintext));
  const hide = el("button", { className: "ghost", text: copy.hideSecret });
  hide.type = "button";
  hide.addEventListener("click", () => {
    block.textContent = copy.hidden;
    copyButton.disabled = true;
    hide.disabled = true;
  });
  const heading = el("h2", { text: copy.plainTitle });
  heading.tabIndex = -1;
  const when = formatAbsolute(expiresAt);
  const relative = formatRelative(expiresAt, Date.now());
  const panel = el(
    "div",
    {},
    heading,
    burned
      ? el("p", { className: "ok", text: copy.plainGone })
      : el("p", { className: "fine", text: copy.plainStill(when, relative) }),
    block,
    el("div", { className: "result-actions" }, copyButton, hide),
    copied,
    el("p", { className: "footer", text: copy.plainFooter }),
  );
  shell(copy.readoutPlain, panel, copy.titlePlain);
  heading.focus();
}

function fragmentNotice(): Notice {
  return { title: copy.fragmentTitle, detail: copy.fragmentDetail, next: copy.fragmentNext };
}

function renderStopped(notice: Notice): void {
  const heading = el("h2", { text: notice.title });
  heading.tabIndex = -1;
  const panel = el("div", {}, heading);
  if (notice.detail) panel.append(el("p", { className: "note", text: notice.detail }));
  if (notice.next) panel.append(el("p", { className: "next", text: notice.next }));
  panel.append(anchor("/", copy.home));
  shell(copy.readoutStop, panel, copy.titleStopped);
  heading.focus();
}

function renderMissing(): void {
  renderStopped({ title: copy.notFoundTitle, detail: "", next: copy.notFoundNext });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCreateResponse(value: unknown): value is { id: string; expiresAt: number; burnAfterRead: boolean } {
  return isRecord(value) && typeof value.expiresAt === "number" && typeof value.burnAfterRead === "boolean" && typeof value.id === "string";
}

interface Envelope {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
}

function isEnvelope(value: unknown): value is Envelope {
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

const pathId = parseSnippetPath(location.pathname);
if (location.pathname === "/") renderCreate();
else if (pathId) renderOpen(pathId);
else if (location.pathname.startsWith("/s/")) renderStopped(goneNotice("missing"));
else renderMissing();
