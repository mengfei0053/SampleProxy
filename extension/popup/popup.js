import { buildApplyPlan } from "../lib/apply.js";
import { formatRuleCount, t } from "../lib/i18n.js";
import {
  AUTO_COLOR,
  AUTO_ID,
  MAX_USER_PROFILES,
  activeDescriptor,
  bypassListError,
  cleanPort,
  createFixedProfile,
  describeProfile,
  findProfile,
  normalizeState,
  portFromPageUrl,
  profileDisplayName,
  proxyFieldErrors,
  resolveTarget,
  splitBypassText,
  supportsProxyAuth,
  upsertFixedProfile,
} from "../lib/state.js";

const currentName = document.querySelector("#current-name");
const currentDetail = document.querySelector("#current-detail");
const systemNote = document.querySelector("#system-note");
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
let showingValidation = false;
let noticeKey = "";
let lastStatus = null;
let lastTab = null;

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

addButton.addEventListener("click", () => {
  if (draft || saving) return;
  const count = state.profiles.filter((profile) => !profile.builtin).length;
  if (count >= MAX_USER_PROFILES) {
    noticeKey = "err.maxProfiles";
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
  togglePassword.textContent = t(state.language, showing ? "common.show" : "common.hide");
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

chrome.storage.onChanged.addListener((_changes, area) => {
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

function applyLanguage() {
  const lang = state.language;
  document.documentElement.lang = lang;
  document.title = t(lang, "popup.pageTitle");
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(lang, node.dataset.i18n);
  }
  togglePassword.textContent = t(lang, passwordInput.type === "text" ? "common.hide" : "common.show");
  if (draft) {
    renderEditorCopy();
    updateAuth();
    if (showingValidation) showErrors(collectErrors(profileFromForm()));
  }
}

function render(applyStatus, tab) {
  lastStatus = applyStatus;
  lastTab = tab;
  const lang = state.language;
  applyLanguage();
  const active = activeDescriptor(state, lang);
  const plan = buildApplyPlan(state);
  const activeName = active.name || t(lang, "common.untitled");
  currentName.textContent = activeName;
  currentName.title = activeName;
  currentDetail.textContent = describeProfile(active, lang);
  currentSwatch.style.background = active.color;
  currentSwatch.title = active.name || "";

  const showSystemNote = active.builtin === "system" && state.globalBypass.length > 0;
  systemNote.hidden = !showSystemNote;
  systemNote.textContent = showSystemNote ? t(lang, "popup.systemGlobalBypassNote") : "";

  let message = "";
  if (!plan.ok) {
    message = t(lang, "banner.notApplied", { message: plan.error });
  } else if (applyStatus && !applyStatus.ok) {
    message = applyStatus.fallbackKey ? t(lang, applyStatus.fallbackKey) : applyStatus.message;
  }
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
  if (count < MAX_USER_PROFILES) noticeKey = "";
  list.hidden = editing;
  editor.hidden = !editing;
  addButton.hidden = editing;
  const notice = noticeKey ? t(lang, noticeKey, { max: MAX_USER_PROFILES }) : "";
  hint.hidden = editing || (!notice && count > 0);
  hint.textContent = notice || (count > 0 ? "" : t(lang, "popup.emptyHint"));
}

function renderTab(plan, tab) {
  if (!tab) {
    tabLine.hidden = true;
    return;
  }
  const lang = state.language;
  tabLine.hidden = false;
  if (!plan.ok) {
    tabLine.textContent = t(lang, "popup.tabNotApplied", { host: tab.host });
    return;
  }
  const resolved = resolveTarget(state, tab.host, tab.port);
  const name = profileDisplayName(resolved.profile, lang) || t(lang, "builtin.directName");
  tabLine.textContent = resolved.bypassed
    ? t(lang, "popup.tabRouteBypass", { host: tab.host, name })
    : t(lang, "popup.tabRoute", { host: tab.host, name });
}

function customRow(profile) {
  const lang = state.language;
  const line = document.createElement("div");
  line.className = "profile-line";
  line.setAttribute("role", "listitem");
  if (state.activeProfileId === profile.id) line.classList.add("is-active");
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit-profile";
  edit.textContent = t(lang, "common.edit");
  const labelName = profileDisplayName(profile, lang) || t(lang, "common.untitled");
  edit.setAttribute("aria-label", t(lang, "common.editProfileAria", { name: labelName }));
  edit.addEventListener("click", () => openEditor("edit", profile));
  line.append(profileButton(profile, false), edit);
  return line;
}

function profileButton(profile, listitem = true) {
  const lang = state.language;
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
  button.append(dot(profile.color), meta(profileDisplayName(profile, lang), describeProfile(profile, lang)), mark(active));
  button.addEventListener("click", () => activate(profile.id));
  return button;
}

function autoButton() {
  const lang = state.language;
  const active = state.activeProfileId === AUTO_ID;
  const fallback = findProfile(state, state.autoSwitch.defaultProfileId);
  const count = state.autoSwitch.rules.filter((rule) => String(rule.pattern || "").trim()).length;
  const rules = formatRuleCount(lang, count);
  const fallbackName = profileDisplayName(fallback, lang) || t(lang, "builtin.directName");
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
    meta(t(lang, "builtin.autoName"), t(lang, "popup.autoSummary", { rules, name: fallbackName })),
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
  title.textContent = name || t(state.language, "common.untitled");
  const detail = document.createElement("span");
  detail.className = "sub";
  detail.textContent = sub;
  node.append(title, detail);
  return node;
}

function mark(active) {
  const node = document.createElement("span");
  node.className = "mark";
  node.textContent = active ? t(state.language, "common.on") : "";
  return node;
}

function renderEditorCopy() {
  if (!draft) return;
  const lang = state.language;
  editorTitle.textContent = t(lang, draft.mode === "create" ? "popup.newProxyTitle" : "popup.editProxyTitle");
  editorNote.textContent = t(lang, draft.mode === "create" ? "popup.newProxyNote" : "popup.editProxyNote");
}

function openEditor(mode, profile) {
  if (!profile || profile.builtin) return;
  draft = { mode, profile: structuredClone(profile) };
  renderEditorCopy();
  nameInput.value = draft.profile.name || "";
  schemeInput.value = draft.profile.proxy?.scheme || "socks5";
  hostInput.value = draft.profile.proxy?.host || "";
  portInput.value = draft.profile.proxy?.port ? String(draft.profile.proxy.port) : "";
  usernameInput.value = draft.profile.proxy?.username || "";
  passwordInput.value = draft.profile.proxy?.password || "";
  bypassInput.value = (draft.profile.bypass || []).join("\n");
  passwordInput.type = "password";
  togglePassword.textContent = t(state.language, "common.show");
  showingValidation = false;
  showErrors({ name: "", host: "", port: "", bypass: "", form: "" });
  updateAuth();
  render(lastStatus, lastTab);
  nameInput.focus();
  nameInput.select();
}

function closeEditor() {
  if (!draft || saving) return;
  draft = null;
  showingValidation = false;
  render(lastStatus, lastTab);
  addButton.focus();
}

function updateAuth() {
  const lang = state.language;
  const enabled = supportsProxyAuth(schemeInput.value);
  usernameInput.disabled = !enabled;
  passwordInput.disabled = !enabled;
  togglePassword.disabled = !enabled;
  authNote.textContent = t(lang, enabled ? "popup.authNoteHttp" : "popup.authNoteSocks");
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
  const lang = state.language;
  const fields = proxyFieldErrors(profile.proxy, lang);
  return {
    name: profile.name ? "" : t(lang, "err.nameRequired"),
    host: fields.host,
    port: fields.port,
    bypass: bypassListError(profile.bypass, lang),
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
    showingValidation = true;
    showErrors(errors);
    return;
  }
  showingValidation = false;
  saving = true;
  saveButton.disabled = true;
  const savedId = profile.id;
  try {
    const latest = normalizeState(await chrome.storage.local.get(null));
    const result = upsertFixedProfile(latest, profile, latest.language);
    if (!result.ok) {
      showErrors({ name: "", host: "", port: "", bypass: "", form: result.error });
      return;
    }
    const snapshot = result.state;
    await chrome.storage.local.set({
      schemaVersion: snapshot.schemaVersion,
      language: snapshot.language,
      profiles: snapshot.profiles,
      autoSwitch: snapshot.autoSwitch,
      activeProfileId: snapshot.activeProfileId,
      globalBypass: snapshot.globalBypass,
    });
    draft = null;
    await scheduleRefresh();
    list.querySelector(`[data-profile-id="${cssEscape(savedId)}"]`)?.focus();
  } catch (error) {
    console.error("Could not save the proxy profile.", error);
    showErrors({ name: "", host: "", port: "", bypass: "", form: t(state.language, "popup.saveFailed") });
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
