import { buildApplyPlan } from "../lib/apply.js";
import {
  AUTO_COLOR,
  AUTO_ID,
  activeDescriptor,
  describeProfile,
  findProfile,
  normalizeState,
  portFromPageUrl,
  resolveTarget,
} from "../lib/state.js";

const currentName = document.querySelector("#current-name");
const currentDetail = document.querySelector("#current-detail");
const currentSwatch = document.querySelector("#current-swatch");
const tabLine = document.querySelector("#tab-line");
const status = document.querySelector("#status");
const list = document.querySelector("#profiles");
const hint = document.querySelector("#hint");

let state = normalizeState({});

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

list.addEventListener("keydown", (event) => {
  const buttons = [...list.querySelectorAll("button")];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" || area === "session") refresh();
});

refresh();

async function refresh() {
  state = normalizeState(await chrome.storage.local.get(null));
  const session = await chrome.storage.session.get("applyStatus");
  const tab = await currentWebTab();
  render(session.applyStatus || null, tab);
}

function render(applyStatus, tab) {
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
  for (const profile of state.profiles) list.append(profileButton(profile));
  list.append(autoButton());

  const hasProxy = state.profiles.some((profile) => !profile.builtin);
  hint.hidden = hasProxy;
  hint.textContent = hasProxy
    ? ""
    : "Add a proxy in Settings. New profiles start as SOCKS5 on 127.0.0.1 port 1080.";
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

function profileButton(profile) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile";
  button.setAttribute("role", "listitem");
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

async function activate(id) {
  state.activeProfileId = id;
  render(null, await currentWebTab());
  await chrome.storage.local.set({ activeProfileId: id });
}

async function currentWebTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/i.test(tab.url)) return null;
    return { host: new URL(tab.url).hostname, port: portFromPageUrl(tab.url) };
  } catch {
    return null;
  }
}
