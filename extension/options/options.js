import { buildApplyPlan } from "../lib/apply.js";
import { LANGUAGES, normalizeLanguage, setRichText, t } from "../lib/i18n.js";
import {
  AUTO_ID,
  DIRECT_ID,
  MAX_BYPASS_ENTRIES,
  MAX_GLOBAL_BYPASS,
  PALETTE,
  SCHEMA_VERSION,
  activeDescriptor,
  bypassListError,
  cleanPort,
  createFixedProfile,
  describeProfile,
  findProfile,
  hostError,
  listSelectableProfiles,
  newId,
  normalizeState,
  parsePattern,
  profileDisplayName,
  splitBypassText,
  supportsProxyAuth,
} from "../lib/state.js";

const els = {
  language: document.querySelector("#language"),
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
  globalBypass: document.querySelector("#global-bypass"),
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
let saveStatusKey = "";
let queue = Promise.resolve();
let adoptQueue = Promise.resolve();
let dirty = false;
let persistStamp = 0;

populateLanguages();

els.language.addEventListener("change", () => {
  syncFormToState();
  state.language = normalizeLanguage(els.language.value);
  renderAll({ preserveInputs: true });
  refreshBanner();
  persistNow({ sync: false });
});
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
els.globalBypass.addEventListener("input", onGlobalBypassInput);
els.globalBypass.addEventListener("change", () => persistNow());
els.togglePassword.addEventListener("click", () => {
  const showing = els.password.type === "text";
  els.password.type = showing ? "password" : "text";
  els.togglePassword.textContent = t(state.language, showing ? "common.show" : "common.hide");
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
  if (
    !changes.profiles
    && !changes.autoSwitch
    && !changes.activeProfileId
    && !changes.schemaVersion
    && !changes.language
    && !changes.globalBypass
  ) return;
  if (dirty) {
    if (!changes.profiles && !changes.autoSwitch && !changes.globalBypass) {
      if (changes.activeProfileId) state.activeProfileId = changes.activeProfileId.newValue;
      if (changes.language) state.language = normalizeLanguage(changes.language.newValue);
      renderAll({ preserveInputs: true });
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
  els.editorTitle.textContent = profileDisplayName(profile, state.language) || t(state.language, "common.untitled");
  patchRow(profile);
  if (profile.id === state.activeProfileId) renderStatusBits();
  refreshProfileChoices();
  refreshFieldErrors();
  refreshBanner();
  persistSoon();
}

function onGlobalBypassInput() {
  state.globalBypass = readGlobalBypass();
  refreshFieldErrors();
  refreshBanner();
  persistSoon();
}

function readBypass() {
  return splitBypassText(els.bypass.value, MAX_BYPASS_ENTRIES);
}

function readGlobalBypass() {
  return splitBypassText(els.globalBypass.value, MAX_GLOBAL_BYPASS);
}

function populateLanguages() {
  els.language.replaceChildren();
  for (const item of LANGUAGES) {
    const option = document.createElement("option");
    option.value = item.code;
    option.textContent = item.label;
    els.language.append(option);
  }
}

function applyLanguage() {
  const lang = state.language;
  document.documentElement.lang = lang;
  document.title = t(lang, "options.pageTitle");
  els.language.value = lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(lang, node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-rich]")) {
    setRichText(node, t(lang, node.dataset.i18nRich));
  }
  for (const node of document.querySelectorAll("[data-i18n-aria]")) {
    node.setAttribute("aria-label", t(lang, node.dataset.i18nAria));
  }
  els.togglePassword.textContent = t(lang, els.password.type === "text" ? "common.hide" : "common.show");
  els.saveState.textContent = saveStatusKey ? t(lang, saveStatusKey) : "";
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

function renderAll({ preserveInputs = false } = {}) {
  applyLanguage();
  renderList();
  fillForm({ preserveInputs });
  if (!preserveInputs) fillGlobalBypass();
  renderRules();
  renderStatusBits();
  refreshFieldErrors();
}

function fillGlobalBypass() {
  els.globalBypass.value = (state.globalBypass || []).join("\n");
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
  const lang = state.language;
  button.querySelector(".row-name").textContent = profileDisplayName(profile, lang) || t(lang, "common.untitled");
  button.querySelector(".row-sub").textContent = describeProfile(profile, lang);
  button.querySelector(".dot").style.background = profile.color;
  button.style.setProperty("--row", profile.color);
}

function fillForm({ preserveInputs = false } = {}) {
  const lang = state.language;
  const profile = selected();
  const fixed = Boolean(profile && !profile.builtin);
  els.fixedFields.hidden = !fixed;
  els.builtin.hidden = fixed;
  els.editorTitle.textContent = profile
    ? (profileDisplayName(profile, lang) || t(lang, "common.untitled"))
    : t(lang, "options.profileHeading");
  if (!profile) return;
  if (!fixed) {
    els.builtin.textContent = profile.builtin === "system"
      ? t(lang, "options.systemNote")
      : t(lang, "options.directNote");
    renderDelete();
    return;
  }
  if (!preserveInputs) {
    els.name.value = profile.name;
    els.scheme.value = profile.proxy.scheme;
    els.host.value = profile.proxy.host;
    els.port.value = profile.proxy.port ? String(profile.proxy.port) : "";
    els.username.value = profile.proxy.username;
    els.password.value = profile.proxy.password;
    els.password.type = "password";
    els.bypass.value = (profile.bypass || []).join("\n");
  }
  els.togglePassword.textContent = t(lang, els.password.type === "text" ? "common.hide" : "common.show");
  renderColors(profile.color);
  updateAuthState(profile);
  renderDelete();
}

function renderColors(selectedColor) {
  const lang = state.language;
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
    input.setAttribute("aria-label", t(lang, "field.badgeColorAria", { color }));
    const dot = document.createElement("span");
    dot.style.background = color;
    label.append(input, dot);
    els.colors.append(label);
  }
}

function updateAuthState(profile) {
  const lang = state.language;
  const socks = !supportsProxyAuth(profile.proxy.scheme);
  els.username.disabled = socks;
  els.password.disabled = socks;
  els.togglePassword.disabled = socks;
  els.authNote.textContent = socks
    ? t(lang, "options.authNoteSocks")
    : t(lang, "options.authNoteHttp");
}

function renderDelete() {
  const lang = state.language;
  const fixed = Boolean(selectedFixed());
  els.delete.hidden = !fixed;
  els.cancelDelete.hidden = !confirmDelete;
  els.delete.textContent = confirmDelete ? t(lang, "common.confirmDelete") : t(lang, "common.delete");
}

function renderRules() {
  const lang = state.language;
  fillProfileSelect(els.defaultProfile, state.autoSwitch.defaultProfileId);
  els.rules.replaceChildren();
  if (!state.autoSwitch.rules.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = t(lang, "options.noRules");
    els.rules.append(empty);
    return;
  }
  state.autoSwitch.rules.forEach((rule, index) => els.rules.append(ruleRow(rule, index)));
}

function ruleRow(rule, index) {
  const lang = state.language;
  const row = document.createElement("div");
  row.className = "rule";
  row.dataset.ruleId = rule.id;
  const pattern = document.createElement("input");
  pattern.type = "text";
  pattern.spellcheck = false;
  pattern.placeholder = "*.example.com";
  pattern.value = rule.pattern;
  pattern.setAttribute("aria-label", t(lang, "options.rulePatternAria", { index: index + 1 }));
  const select = document.createElement("select");
  select.setAttribute("aria-label", t(lang, "options.ruleProfileAria", { index: index + 1 }));
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
    ruleButton(t(lang, "options.ruleUp"), t(lang, "options.ruleUpAria"), index === 0, () => moveRule(index, -1)),
    ruleButton(t(lang, "options.ruleDown"), t(lang, "options.ruleDownAria"), index === state.autoSwitch.rules.length - 1, () => moveRule(index, 1)),
    ruleButton(t(lang, "options.ruleRemove"), t(lang, "options.ruleRemoveAria"), false, () => removeRule(rule.id)),
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
  const lang = state.language;
  const chosen = value || select.value;
  select.replaceChildren();
  for (const profile of listSelectableProfiles(state)) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profileDisplayName(profile, lang) || t(lang, "common.untitled");
    select.append(option);
  }
  const available = [...select.options].some((option) => option.value === chosen);
  select.value = available ? chosen : DIRECT_ID;
}

function renderStatusBits() {
  const lang = state.language;
  const active = activeDescriptor(state, lang);
  els.inUseName.textContent = active.name || t(lang, "common.untitled");
  els.inUseSwatch.style.background = active.color;
  const profile = selected();
  const using = profile && state.activeProfileId === profile.id;
  els.use.textContent = using ? t(lang, "options.profileInUse") : t(lang, "options.useProfile");
  els.use.disabled = !profile || using;
  const autoOn = state.activeProfileId === AUTO_ID;
  els.useAuto.textContent = autoOn ? t(lang, "options.autoInUse") : t(lang, "options.useAuto");
  els.useAuto.disabled = autoOn;
}

function refreshFieldErrors() {
  const lang = state.language;
  const profile = selectedFixed();
  setFieldError("name", profile && !els.name.value.trim() ? t(lang, "err.nameRequired") : "");
  setFieldError("host", profile ? hostError(els.host.value, lang) : "");
  setFieldError("port", profile && cleanPort(els.port.value.trim()) == null ? t(lang, "err.portRange") : "");
  setFieldError("bypass", profile ? bypassListError(profile.bypass, lang) : "");
  setFieldError("global-bypass", bypassListError(state.globalBypass, { lang, global: true }));
}

async function refreshBanner() {
  const lang = state.language;
  const plan = buildApplyPlan(state);
  let message = plan.error || "";
  if (!message) {
    const session = await chrome.storage.session.get("applyStatus");
    if (session.applyStatus && !session.applyStatus.ok) {
      message = session.applyStatus.fallbackKey
        ? t(lang, session.applyStatus.fallbackKey)
        : session.applyStatus.message;
    }
  }
  els.applyError.hidden = !message;
  els.applyError.textContent = message
    ? t(lang, "banner.notApplied", { message })
    : "";
}

function syncFormToState() {
  state.globalBypass = readGlobalBypass();
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
    language: state.language,
    profiles: state.profiles,
    autoSwitch: state.autoSwitch,
    activeProfileId: state.activeProfileId,
    globalBypass: state.globalBypass,
  });
  queue = queue.then(async () => {
    const payload = {
      schemaVersion: snapshot.schemaVersion,
      language: snapshot.language,
      profiles: snapshot.profiles,
      autoSwitch: snapshot.autoSwitch,
      globalBypass: snapshot.globalBypass,
    };
    if (includeActive) payload.activeProfileId = snapshot.activeProfileId;
    localWrites += 1;
    try {
      await chrome.storage.local.set(payload);
      showSaved();
    } catch (error) {
      if (stamp === persistStamp) dirty = true;
      console.error("Could not save settings.", error);
      saveStatusKey = "options.saveError";
      els.saveState.textContent = t(state.language, saveStatusKey);
    } finally {
      localWrites -= 1;
    }
  });
}

function showSaved() {
  saveStatusKey = "options.saved";
  els.saveState.textContent = t(state.language, saveStatusKey);
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    saveStatusKey = "";
    els.saveState.textContent = "";
  }, 1200);
}

function ruleMessage(rule) {
  if (!String(rule.pattern || "").trim()) return "";
  const parsed = parsePattern(rule.pattern, state.language);
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
  const lang = state.language;
  const node = document.createElement("span");
  node.className = "row-copy";
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = profileDisplayName(profile, lang) || t(lang, "common.untitled");
  const sub = document.createElement("span");
  sub.className = "row-sub";
  sub.textContent = describeProfile(profile, lang);
  node.append(name, sub);
  return node;
}

function onTag(active) {
  const node = document.createElement("span");
  node.className = "on-tag";
  node.textContent = active ? t(state.language, "common.on") : "";
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
