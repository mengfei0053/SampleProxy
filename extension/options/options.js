import { buildApplyPlan } from "../lib/apply.js";
import {
  AUTO_ID,
  DIRECT_ID,
  PALETTE,
  SCHEMA_VERSION,
  activeDescriptor,
  cleanPort,
  createFixedProfile,
  describeProfile,
  findProfile,
  hostError,
  listSelectableProfiles,
  newId,
  normalizeState,
  parsePattern,
  supportsProxyAuth,
} from "../lib/state.js";

const els = {
  list: document.querySelector("#profile-list"),
  editor: document.querySelector("#editor"),
  fixedFields: document.querySelector("#fixed-fields"),
  editorTitle: document.querySelector("#editor-title"),
  builtin: document.querySelector("#builtin-note"),
  name: document.querySelector("#name"),
  colors: document.querySelector("#colors"),
  scheme: document.querySelector("#scheme"),
  host: document.querySelector("#host"),
  port: document.querySelector("#port"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  togglePassword: document.querySelector("#toggle-password"),
  authNote: document.querySelector("#auth-note"),
  bypass: document.querySelector("#bypass"),
  use: document.querySelector("#use-profile"),
  delete: document.querySelector("#delete-profile"),
  cancelDelete: document.querySelector("#cancel-delete"),
  add: document.querySelector("#add-profile"),
  inUseName: document.querySelector("#in-use-name"),
  inUseSwatch: document.querySelector("#in-use-swatch"),
  applyError: document.querySelector("#apply-error"),
  saveState: document.querySelector("#save-state"),
  defaultProfile: document.querySelector("#default-profile"),
  rules: document.querySelector("#rules"),
  addRule: document.querySelector("#add-rule"),
  useAuto: document.querySelector("#use-auto"),
};

let state = normalizeState({});
let selectedId = DIRECT_ID;
let confirmDelete = false;
let editing = false;
let writeActive = false;
let localWrites = 0;
let timer = 0;
let savedTimer = 0;
let queue = Promise.resolve();
let adoptQueue = Promise.resolve();
let dirty = false;
let persistStamp = 0;

els.editor.addEventListener("submit", (event) => event.preventDefault());
els.add.addEventListener("click", addProfile);
els.use.addEventListener("click", () => useProfile(selectedId));
els.delete.addEventListener("click", onDelete);
els.cancelDelete.addEventListener("click", () => {
  confirmDelete = false;
  renderDelete();
});
els.useAuto.addEventListener("click", () => useProfile(AUTO_ID));
els.addRule.addEventListener("click", addRule);
els.defaultProfile.addEventListener("change", () => {
  state.autoSwitch.defaultProfileId = els.defaultProfile.value;
  persistNow({ sync: false });
  refreshBanner();
});
els.colors.addEventListener("change", (event) => {
  const profile = selectedFixed();
  if (!profile || !event.target.matches("input")) return;
  profile.color = event.target.value;
  persistSoon();
  renderList();
});
els.scheme.addEventListener("change", () => {
  const profile = selectedFixed();
  if (!profile) return;
  profile.proxy.scheme = els.scheme.value;
  updateAuthState(profile);
  patchRow(profile);
  persistNow();
  refreshBanner();
});
for (const input of [els.name, els.host, els.port, els.username, els.password, els.bypass]) {
  input.addEventListener("input", onFieldInput);
  input.addEventListener("change", () => persistNow());
}
els.togglePassword.addEventListener("click", () => {
  const showing = els.password.type === "text";
  els.password.type = showing ? "password" : "text";
  els.togglePassword.textContent = showing ? "Show" : "Hide";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && dirty) persistNow();
});
window.addEventListener("pagehide", () => {
  if (dirty) persistNow();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    refreshBanner();
    return;
  }
  if (area !== "local" || localWrites > 0) return;
  if (!changes.profiles && !changes.autoSwitch && !changes.activeProfileId && !changes.schemaVersion) return;
  if (dirty) {
    if (changes.activeProfileId && !changes.profiles && !changes.autoSwitch) {
      state.activeProfileId = changes.activeProfileId.newValue;
      renderList();
      renderStatusBits();
      refreshBanner();
    }
    return;
  }
  adoptStorage();
});

init();

async function init() {
  const stored = normalizeState(await chrome.storage.local.get(null));
  if (!editing) {
    state = stored;
    selectedId = state.activeProfileId !== AUTO_ID && findProfile(state, state.activeProfileId)
      ? state.activeProfileId
      : DIRECT_ID;
    renderAll();
  }
  refreshBanner();
}

function adoptStorage() {
  adoptQueue = adoptQueue.then(adoptLatest, adoptLatest);
}

async function adoptLatest() {
  if (dirty || localWrites > 0) return;
  const stored = normalizeState(await chrome.storage.local.get(null));
  if (dirty || localWrites > 0) return;
  const stillThere = findProfile(stored, selectedId);
  state = stored;
  if (!stillThere) {
    selectedId = state.activeProfileId !== AUTO_ID && findProfile(state, state.activeProfileId)
      ? state.activeProfileId
      : DIRECT_ID;
    confirmDelete = false;
  }
  renderAll();
  refreshBanner();
}

function selected() {
  return findProfile(state, selectedId);
}

function selectedFixed() {
  const profile = selected();
  return profile && !profile.builtin ? profile : null;
}

function onFieldInput() {
  const profile = selectedFixed();
  if (!profile) return;
  profile.name = els.name.value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60);
  profile.proxy.host = els.host.value;
  profile.proxy.port = cleanPort(els.port.value.trim());
  profile.proxy.username = els.username.value;
  profile.proxy.password = els.password.value;
  profile.bypass = readBypass();
  els.editorTitle.textContent = profile.name || "Untitled";
  patchRow(profile);
  refreshProfileChoices();
  refreshFieldErrors();
  refreshBanner();
  persistSoon();
}

function readBypass() {
  return els.bypass.value.split(/\n/).map((line) => line.trim()).filter(Boolean).slice(0, 40);
}

function addProfile() {
  syncFormToState();
  const profile = createFixedProfile(state.profiles);
  state.profiles.push(profile);
  selectedId = profile.id;
  confirmDelete = false;
  persistNow({ sync: false });
  renderAll();
  els.name.focus();
  els.name.select();
}

function onDelete() {
  const profile = selectedFixed();
  if (!profile) return;
  if (!confirmDelete) {
    confirmDelete = true;
    renderDelete();
    return;
  }
  const id = profile.id;
  state.profiles = state.profiles.filter((item) => item.id !== id);
  state.autoSwitch.rules = state.autoSwitch.rules.filter((rule) => rule.profileId !== id);
  if (state.autoSwitch.defaultProfileId === id) state.autoSwitch.defaultProfileId = DIRECT_ID;
  if (state.activeProfileId === id) {
    state.activeProfileId = DIRECT_ID;
    writeActive = true;
  }
  selectedId = DIRECT_ID;
  confirmDelete = false;
  persistNow({ sync: false });
  renderAll();
}

function useProfile(id) {
  state.activeProfileId = id;
  writeActive = true;
  persistNow();
  renderStatusBits();
  renderList();
}

function addRule() {
  syncFormToState();
  const firstFixed = state.profiles.find((profile) => !profile.builtin);
  state.autoSwitch.rules.push({
    id: newId("r"),
    pattern: "",
    profileId: firstFixed?.id || DIRECT_ID,
  });
  persistNow({ sync: false });
  renderRules();
  const inputs = els.rules.querySelectorAll("input");
  inputs[inputs.length - 1]?.focus();
}

function selectProfile(id) {
  if (id === selectedId) return;
  syncFormToState();
  selectedId = id;
  confirmDelete = false;
  persistNow({ sync: false });
  renderList();
  fillForm();
  refreshFieldErrors();
}

function renderAll() {
  renderList();
  fillForm();
  renderRules();
  renderStatusBits();
  refreshFieldErrors();
}

function renderList() {
  els.list.replaceChildren();
  for (const profile of state.profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-row";
    button.dataset.profile = profile.id;
    button.style.setProperty("--row", profile.color);
    if (profile.id === selectedId) button.classList.add("is-selected");
    if (profile.id === state.activeProfileId) button.classList.add("is-active");
    button.append(swatch(profile.color), rowCopy(profile), onTag(profile.id === state.activeProfileId));
    button.addEventListener("click", () => selectProfile(profile.id));
    els.list.append(button);
  }
}

function patchRow(profile) {
  const button = els.list.querySelector(`[data-profile="${cssEscape(profile.id)}"]`);
  if (!button) return;
  button.querySelector(".row-name").textContent = profile.name || "Untitled";
  button.querySelector(".row-sub").textContent = describeProfile(profile);
  button.querySelector(".dot").style.background = profile.color;
  button.style.setProperty("--row", profile.color);
}

function fillForm() {
  const profile = selected();
  const fixed = Boolean(profile && !profile.builtin);
  els.fixedFields.hidden = !fixed;
  els.builtin.hidden = fixed;
  els.editorTitle.textContent = profile?.name || "Profile";
  if (!profile) return;
  if (!fixed) {
    els.builtin.textContent = profile.builtin === "system"
      ? "System sends traffic through the proxy configured by the operating system. It cannot be edited, and auto switch cannot use it for individual sites."
      : "Direct opens connections without a proxy. It cannot be edited.";
    renderDelete();
    return;
  }
  els.name.value = profile.name;
  els.scheme.value = profile.proxy.scheme;
  els.host.value = profile.proxy.host;
  els.port.value = profile.proxy.port ? String(profile.proxy.port) : "";
  els.username.value = profile.proxy.username;
  els.password.value = profile.proxy.password;
  els.password.type = "password";
  els.togglePassword.textContent = "Show";
  els.bypass.value = (profile.bypass || []).join("\n");
  renderColors(profile.color);
  updateAuthState(profile);
  renderDelete();
}

function renderColors(selectedColor) {
  const colors = PALETTE.includes(selectedColor) ? PALETTE : [selectedColor, ...PALETTE];
  els.colors.replaceChildren();
  for (const color of colors) {
    const label = document.createElement("label");
    label.className = "swatch-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "color";
    input.value = color;
    input.checked = color === selectedColor;
    input.setAttribute("aria-label", `Badge color ${color}`);
    const dot = document.createElement("span");
    dot.style.background = color;
    label.append(input, dot);
    els.colors.append(label);
  }
}

function updateAuthState(profile) {
  const socks = !supportsProxyAuth(profile.proxy.scheme);
  els.username.disabled = socks;
  els.password.disabled = socks;
  els.togglePassword.disabled = socks;
  els.authNote.textContent = socks
    ? "Chrome cannot sign in to SOCKS proxies. The username and password are kept if you switch this profile to HTTP or HTTPS, and they are not sent."
    : "If this proxy asks Chrome to sign in, this username and password are sent to the proxy only.";
}

function renderDelete() {
  const fixed = Boolean(selectedFixed());
  els.delete.hidden = !fixed;
  els.cancelDelete.hidden = !confirmDelete;
  els.delete.textContent = confirmDelete ? "Confirm delete" : "Delete";
}

function renderRules() {
  fillProfileSelect(els.defaultProfile, state.autoSwitch.defaultProfileId);
  els.rules.replaceChildren();
  if (!state.autoSwitch.rules.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No rules yet. Every site uses the default profile.";
    els.rules.append(empty);
    return;
  }
  state.autoSwitch.rules.forEach((rule, index) => els.rules.append(ruleRow(rule, index)));
}

function ruleRow(rule, index) {
  const row = document.createElement("div");
  row.className = "rule";
  row.dataset.ruleId = rule.id;
  const pattern = document.createElement("input");
  pattern.type = "text";
  pattern.spellcheck = false;
  pattern.placeholder = "*.example.com";
  pattern.value = rule.pattern;
  pattern.setAttribute("aria-label", `Rule ${index + 1} pattern`);
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Rule ${index + 1} profile`);
  fillProfileSelect(select, rule.profileId);
  const error = document.createElement("small");
  error.className = "field-error";
  error.textContent = ruleMessage(rule);
  pattern.addEventListener("input", () => {
    rule.pattern = pattern.value;
    error.textContent = ruleMessage(rule);
    refreshBanner();
    persistSoon();
  });
  select.addEventListener("change", () => {
    rule.profileId = select.value;
    refreshBanner();
    persistNow({ sync: false });
  });
  const buttons = document.createElement("div");
  buttons.className = "rule-buttons";
  buttons.append(
    ruleButton("Up", "Move rule up", index === 0, () => moveRule(index, -1)),
    ruleButton("Down", "Move rule down", index === state.autoSwitch.rules.length - 1, () => moveRule(index, 1)),
    ruleButton("Remove", "Delete rule", false, () => removeRule(rule.id)),
  );
  row.append(pattern, select, buttons, error);
  return row;
}

function moveRule(index, delta) {
  const next = index + delta;
  const rules = state.autoSwitch.rules;
  if (next < 0 || next >= rules.length) return;
  const [rule] = rules.splice(index, 1);
  rules.splice(next, 0, rule);
  persistNow({ sync: false });
  renderRules();
  els.rules.querySelector(`[data-rule-id="${cssEscape(rule.id)}"] input`)?.focus();
}

function removeRule(id) {
  state.autoSwitch.rules = state.autoSwitch.rules.filter((rule) => rule.id !== id);
  persistNow({ sync: false });
  renderRules();
  refreshBanner();
}

function refreshProfileChoices() {
  for (const select of [els.defaultProfile, ...els.rules.querySelectorAll("select")]) {
    fillProfileSelect(select, select.value);
  }
}

function fillProfileSelect(select, value) {
  const chosen = value || select.value;
  select.replaceChildren();
  for (const profile of listSelectableProfiles(state)) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name || "Untitled";
    select.append(option);
  }
  const available = [...select.options].some((option) => option.value === chosen);
  select.value = available ? chosen : DIRECT_ID;
}

function renderStatusBits() {
  const active = activeDescriptor(state);
  els.inUseName.textContent = active.name;
  els.inUseSwatch.style.background = active.color;
  const profile = selected();
  const using = profile && state.activeProfileId === profile.id;
  els.use.textContent = using ? "In use" : "Use this profile";
  els.use.disabled = !profile || using;
  const autoOn = state.activeProfileId === AUTO_ID;
  els.useAuto.textContent = autoOn ? "Auto switch is in use" : "Use auto switch";
  els.useAuto.disabled = autoOn;
}

function refreshFieldErrors() {
  const profile = selectedFixed();
  setFieldError("name", profile && !els.name.value.trim() ? "Give the profile a name." : "");
  setFieldError("host", profile ? hostError(els.host.value) : "");
  setFieldError("port", profile && cleanPort(els.port.value.trim()) == null ? "Port must be a number from 1 to 65535." : "");
  const bypassProblem = (profile?.bypass || []).map((line) => parsePattern(line)).find((parsed) => !parsed.ok);
  setFieldError("bypass", bypassProblem ? bypassProblem.error : "");
}

async function refreshBanner() {
  const plan = buildApplyPlan(state);
  let message = plan.error || "";
  if (!message) {
    const session = await chrome.storage.session.get("applyStatus");
    if (session.applyStatus && !session.applyStatus.ok) message = session.applyStatus.message;
  }
  els.applyError.hidden = !message;
  els.applyError.textContent = message
    ? `Not applied yet: ${message} The previous working proxy stays in place until this is fixed.`
    : "";
}

function syncFormToState() {
  const profile = selectedFixed();
  if (!profile) return;
  profile.name = els.name.value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60);
  profile.proxy.scheme = els.scheme.value;
  profile.proxy.host = els.host.value;
  profile.proxy.port = cleanPort(els.port.value.trim());
  profile.proxy.username = els.username.value;
  profile.proxy.password = els.password.value;
  profile.bypass = readBypass();
}

function persistSoon() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => persistNow(), 400);
}

function persistNow({ sync = true } = {}) {
  editing = true;
  if (sync) syncFormToState();
  clearTimeout(timer);
  dirty = false;
  const stamp = ++persistStamp;
  const includeActive = writeActive;
  writeActive = false;
  const snapshot = normalizeState({
    schemaVersion: SCHEMA_VERSION,
    profiles: state.profiles,
    autoSwitch: state.autoSwitch,
    activeProfileId: state.activeProfileId,
  });
  queue = queue.then(async () => {
    const payload = {
      schemaVersion: snapshot.schemaVersion,
      profiles: snapshot.profiles,
      autoSwitch: snapshot.autoSwitch,
    };
    if (includeActive) payload.activeProfileId = snapshot.activeProfileId;
    localWrites += 1;
    try {
      await chrome.storage.local.set(payload);
      showSaved();
    } catch (error) {
      if (stamp === persistStamp) dirty = true;
      console.error("Could not save settings.", error);
      els.saveState.textContent = "Could not save";
    } finally {
      localWrites -= 1;
    }
  });
}

function showSaved() {
  els.saveState.textContent = "Saved";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    els.saveState.textContent = "";
  }, 1200);
}

function ruleMessage(rule) {
  if (!String(rule.pattern || "").trim()) return "";
  const parsed = parsePattern(rule.pattern);
  return parsed.ok ? "" : parsed.error;
}

function setFieldError(name, message) {
  const error = document.querySelector(`#${name}-error`);
  const input = document.querySelector(`#${name}`);
  if (error) error.textContent = message || "";
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
}

function swatch(color) {
  const node = document.createElement("span");
  node.className = "dot";
  node.style.background = color;
  return node;
}

function rowCopy(profile) {
  const node = document.createElement("span");
  node.className = "row-copy";
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = profile.name || "Untitled";
  const sub = document.createElement("span");
  sub.className = "row-sub";
  sub.textContent = describeProfile(profile);
  node.append(name, sub);
  return node;
}

function onTag(active) {
  const node = document.createElement("span");
  node.className = "on-tag";
  node.textContent = active ? "On" : "";
  return node;
}

function ruleButton(label, aria, disabled, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quiet";
  button.textContent = label;
  button.setAttribute("aria-label", aria);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
}
