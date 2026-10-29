import { buildApplyPlan } from "../lib/apply.js";
import {
  AUTO_COLOR,
  AUTO_ID,
  MAX_USER_PROFILES,
  activeDescriptor,
  cleanPort,
  createFixedProfile,
  describeProfile,
  findProfile,
  normalizeState,
  portFromPageUrl,
  bypassListError,
  proxyFieldErrors,
  resolveTarget,
  splitBypassText,
  supportsProxyAuth,
  upsertFixedProfile,
} from "../lib/state.js";

const currentName = document.querySelector("#current-name");
const currentDetail = document.querySelector("#current-detail");
const currentSwatch = document.querySelector("#current-swatch");
const tabLine = document.querySelector("#tab-line");
const status = document.querySelector("#status");
const list = document.querySelector("#profiles");
const hint = document.querySelector("#hint");
const editor = document.querySelector("#editor");
const editorTitle = document.querySelector("#editor-title");
const editorNote = document.querySelector("#editor-note");
const nameInput = document.querySelector("#name");
const schemeInput = document.querySelector("#scheme");
const hostInput = document.querySelector("#host");
const portInput = document.querySelector("#port");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const togglePassword = document.querySelector("#toggle-password");
const bypassInput = document.querySelector("#bypass");
const authNote = document.querySelector("#auth-note");
const formError = document.querySelector("#form-error");
const saveButton = document.querySelector("#save-profile");
const addButton = document.querySelector("#add-proxy");

let state = normalizeState({});
let draft = null;
let saving = false;
let notice = "";
let lastStatus = null;
let lastTab = null;

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

addButton.addEventListener("click", () => {
  if (draft || saving) return;
  const count = state.profiles.filter((profile) => !profile.builtin).length;
  if (count >= MAX_USER_PROFILES) {
    notice = "You can save 40 proxy profiles. Delete one in Proxy settings before adding another.";
    render(lastStatus, lastTab);
    return;
  }
  openEditor("create", createFixedProfile(state.profiles));
});

editor.addEventListener("submit", saveEditor);
document.querySelector("#cancel-edit").addEventListener("click", closeEditor);
editor.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeEditor();
  }
});
schemeInput.addEventListener("change", updateAuth);
togglePassword.addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  togglePassword.textContent = showing ? "Show" : "Hide";
});

list.addEventListener("keydown", (event) => {
  const buttons = [...list.querySelectorAll("button.profile")];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  }
});

let refreshQueue = Promise.resolve();

function scheduleRefresh() {
  const run = refreshQueue.then(loadAndRender, loadAndRender);
  refreshQueue = run.catch(() => {});
  return run;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" && area !== "session") return;
  setTimeout(() => scheduleRefresh(), 0);
});

scheduleRefresh();

async function loadAndRender() {
  state = normalizeState(await chrome.storage.local.get(null));
  const session = await chrome.storage.session.get("applyStatus");
  const tab = await currentWebTab();
  render(session.applyStatus || null, tab);
}

function render(applyStatus, tab) {
  lastStatus = applyStatus;
  lastTab = tab;
  const active = activeDescriptor(state);
  const plan = buildApplyPlan(state);
  currentName.textContent = active.name || "Untitled";
  currentName.title = active.name || "Untitled";
  currentDetail.textContent = describeProfile(active);
  currentSwatch.style.background = active.color;
  currentSwatch.title = active.name || "";

  const message = !plan.ok
    ? `Not applied yet: ${plan.error} The previous working proxy stays in place until this is fixed.`
    : applyStatus && !applyStatus.ok
      ? applyStatus.message
      : "";
  status.hidden = !message;
  status.textContent = message;

  renderTab(plan, tab);
  list.replaceChildren();
  for (const profile of state.profiles) {
    list.append(profile.builtin ? profileButton(profile) : customRow(profile));
  }
  list.append(autoButton());

  const editing = Boolean(draft);
  const count = state.profiles.filter((profile) => !profile.builtin).length;
  if (count < MAX_USER_PROFILES) notice = "";
  list.hidden = editing;
  editor.hidden = !editing;
  addButton.hidden = editing;
  hint.hidden = editing || (!notice && count > 0);
  hint.textContent = notice || (count > 0 ? "" : "New profiles start as SOCKS5 on 127.0.0.1 port 1080.");
}

function renderTab(plan, tab) {
  if (!tab) {
    tabLine.hidden = true;
    return;
  }
  tabLine.hidden = false;
  if (!plan.ok) {
    tabLine.textContent = `${tab.host} · the current rules are not applied`;
    return;
  }
  const resolved = resolveTarget(state, tab.host, tab.port);
  const name = resolved.profile?.name || "Direct";
  tabLine.textContent = resolved.bypassed ? `${tab.host} → ${name} (bypass)` : `${tab.host} → ${name}`;
}

function customRow(profile) {
  const line = document.createElement("div");
  line.className = "profile-line";
  line.setAttribute("role", "listitem");
  if (state.activeProfileId === profile.id) line.classList.add("is-active");
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit-profile";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit ${profile.name || "Untitled"}`);
  edit.addEventListener("click", () => openEditor("edit", profile));
  line.append(profileButton(profile, false), edit);
  return line;
}

function profileButton(profile, listitem = true) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile";
  button.dataset.profileId = profile.id;
  if (listitem) button.setAttribute("role", "listitem");
  const active = state.activeProfileId === profile.id;
  if (active) {
    button.classList.add("is-active");
    button.setAttribute("aria-current", "true");
  }
  button.append(dot(profile.color), meta(profile.name, describeProfile(profile)), mark(active));
  button.addEventListener("click", () => activate(profile.id));
  return button;
}

function autoButton() {
  const active = state.activeProfileId === AUTO_ID;
  const fallback = findProfile(state, state.autoSwitch.defaultProfileId);
  const count = state.autoSwitch.rules.filter((rule) => String(rule.pattern || "").trim()).length;
  const rules = count === 1 ? "1 rule" : `${count} rules`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile is-auto";
  button.setAttribute("role", "listitem");
  if (active) {
    button.classList.add("is-active");
    button.setAttribute("aria-current", "true");
  }
  button.append(
    dot(AUTO_COLOR),
    meta("Auto switch", `${rules} · default ${fallback?.name || "Direct"}`),
    mark(active),
  );
  button.addEventListener("click", () => activate(AUTO_ID));
  return button;
}

function dot(color) {
  const node = document.createElement("span");
  node.className = "dot";
  node.style.background = color;
  return node;
}

function meta(name, sub) {
  const node = document.createElement("span");
  node.className = "meta";
  const title = document.createElement("span");
  title.className = "name";
  title.textContent = name || "Untitled";
  const detail = document.createElement("span");
  detail.className = "sub";
  detail.textContent = sub;
  node.append(title, detail);
  return node;
}

function mark(active) {
  const node = document.createElement("span");
  node.className = "mark";
  node.textContent = active ? "On" : "";
  return node;
}

function openEditor(mode, profile) {
  if (!profile || profile.builtin) return;
  draft = { mode, profile: structuredClone(profile) };
  editorTitle.textContent = mode === "create" ? "New proxy" : "Edit proxy";
  editorNote.textContent = mode === "create"
    ? "Click the profile in the list after saving to turn it on."
    : "Badge color stays as it is in Proxy settings.";
  nameInput.value = draft.profile.name || "";
  schemeInput.value = draft.profile.proxy?.scheme || "socks5";
  hostInput.value = draft.profile.proxy?.host || "";
  portInput.value = draft.profile.proxy?.port ? String(draft.profile.proxy.port) : "";
  usernameInput.value = draft.profile.proxy?.username || "";
  passwordInput.value = draft.profile.proxy?.password || "";
  bypassInput.value = (draft.profile.bypass || []).join("\n");
  passwordInput.type = "password";
  togglePassword.textContent = "Show";
  showErrors({ name: "", host: "", port: "", bypass: "", form: "" });
  updateAuth();
  render(lastStatus, lastTab);
  nameInput.focus();
  nameInput.select();
}

function closeEditor() {
  if (!draft || saving) return;
  draft = null;
  render(lastStatus, lastTab);
  addButton.focus();
}

function updateAuth() {
  const enabled = supportsProxyAuth(schemeInput.value);
  usernameInput.disabled = !enabled;
  passwordInput.disabled = !enabled;
  togglePassword.disabled = !enabled;
  authNote.textContent = enabled
    ? "Sent only when this proxy asks Chrome to sign in."
    : "Chrome cannot sign in to SOCKS proxies. A username and password are kept but not sent.";
}

function profileFromForm() {
  const profile = draft.profile;
  profile.name = nameInput.value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  profile.proxy = {
    ...profile.proxy,
    scheme: schemeInput.value,
    host: hostInput.value,
    port: cleanPort(portInput.value.trim()),
    username: usernameInput.value,
    password: passwordInput.value,
  };
  profile.bypass = splitBypassText(bypassInput.value);
  return profile;
}

function collectErrors(profile) {
  const fields = proxyFieldErrors(profile.proxy);
  return {
    name: profile.name ? "" : "Give the profile a name.",
    host: fields.host,
    port: fields.port,
    bypass: bypassListError(profile.bypass),
    form: fields.scheme,
  };
}

function showErrors(errors) {
  setField("name", errors.name);
  setField("host", errors.host);
  setField("port", errors.port);
  setField("bypass", errors.bypass);
  formError.textContent = errors.form || "";
}

function setField(id, message) {
  const error = document.querySelector(`#${id}-error`);
  const input = document.querySelector(`#${id}`);
  if (error) error.textContent = message || "";
  if (!input) return;
  input.setAttribute("aria-invalid", message ? "true" : "false");
  if (message) input.setAttribute("aria-describedby", `${id}-error`);
  else input.removeAttribute("aria-describedby");
}

async function saveEditor(event) {
  event.preventDefault();
  if (!draft || saving) return;
  const profile = profileFromForm();
  const errors = collectErrors(profile);
  if (errors.name || errors.host || errors.port || errors.bypass || errors.form) {
    showErrors(errors);
    return;
  }
  saving = true;
  saveButton.disabled = true;
  const savedId = profile.id;
  try {
    const latest = normalizeState(await chrome.storage.local.get(null));
    const result = upsertFixedProfile(latest, profile);
    if (!result.ok) {
      showErrors({ name: "", host: "", port: "", bypass: "", form: result.error });
      return;
    }
    const snapshot = result.state;
    await chrome.storage.local.set({
      schemaVersion: snapshot.schemaVersion,
      profiles: snapshot.profiles,
      autoSwitch: snapshot.autoSwitch,
      activeProfileId: snapshot.activeProfileId,
    });
    draft = null;
    await scheduleRefresh();
    list.querySelector(`[data-profile-id="${cssEscape(savedId)}"]`)?.focus();
  } catch (error) {
    console.error("Could not save the proxy profile.", error);
    showErrors({ name: "", host: "", port: "", bypass: "", form: "Could not save this profile." });
  } finally {
    saving = false;
    saveButton.disabled = false;
  }
}

async function activate(id) {
  if (draft) return;
  state.activeProfileId = id;
  render(null, await currentWebTab());
  await chrome.storage.local.set({ activeProfileId: id });
}

async function currentWebTab() {
  try {
    const tabs = await Promise.race([
      chrome.tabs.query({ active: true, currentWindow: true }),
      new Promise((resolve) => setTimeout(() => resolve([]), 1500)),
    ]);
    const tab = tabs?.[0];
    if (!tab?.url || !/^https?:/i.test(tab.url)) return null;
    return { host: new URL(tab.url).hostname, port: portFromPageUrl(tab.url) };
  } catch {
    return null;
  }
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
}
