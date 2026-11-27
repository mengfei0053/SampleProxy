import { buildApplyPlan } from "./lib/apply.js";
import { DEFAULT_LANGUAGE, normalizeLanguage, t } from "./lib/i18n.js";
import {
  actionTitle,
  badgeLabel,
  credentialsForChallenge,
  ERROR_COLOR,
  normalizeState,
  rawIsCurrent,
  stable,
} from "./lib/state.js";

const SCOPE = "regular";
const authAttempts = new Map();
let applying = Promise.resolve();
let currentLanguage = DEFAULT_LANGUAGE;

// Chrome only wakes the service worker for a proxy sign-in when this listener
// is registered during the initial script turn.
try {
  chrome.webRequest.onAuthRequired.addListener(
    (details, callback) => {
      provideCredentials(details).then(
        (result) => callback(result),
        () => callback({}),
      );
    },
    { urls: ["<all_urls>"] },
    ["asyncBlocking"],
  );
} catch (error) {
  console.error("Proxy authentication listener was not installed.", error);
}

chrome.proxy.onProxyError.addListener(async (details) => {
  if (!details.fatal) return;
  const message = [details.error, details.details].filter(Boolean).join(": ");
  if (message) {
    await writeStatus(false, message, "");
    return;
  }
  let lang = currentLanguage;
  try {
    const stored = await chrome.storage.local.get("language");
    lang = normalizeLanguage(stored?.language);
    currentLanguage = lang;
  } catch { /* fall back to cached language */ }
  await writeStatus(false, t(lang, "err.chromeProxyError"), "err.chromeProxyError");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    !changes.profiles
    && !changes.autoSwitch
    && !changes.activeProfileId
    && !changes.schemaVersion
    && !changes.language
    && !changes.globalBypass
  ) return;
  applyFromStorage();
});

applyFromStorage();

function applyFromStorage() {
  applying = applying.then(applyLatest, applyLatest);
}

async function applyLatest() {
  const raw = await chrome.storage.local.get(null);
  let state = normalizeState(raw);
  if (!rawIsCurrent(raw)) {
    const latest = await chrome.storage.local.get(null);
    if (stable(latest) !== stable(raw)) return;
    await chrome.storage.local.set(state);
  }
  state = normalizeState(await chrome.storage.local.get(null));
  currentLanguage = state.language;
  await applyState(state);
}

async function applyState(state) {
  const lang = normalizeLanguage(state.language);
  const plan = buildApplyPlan(state);
  if (!plan.ok) {
    await paintBadge(plan.badge, plan.error, lang);
    try {
      const current = await chrome.proxy.settings.get({});
      if (current.level !== "controlled_by_this_extension") {
        await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: SCOPE });
      }
    } catch (error) {
      const err = errorMessage(error, lang);
      const message = err.message || plan.error;
      await paintBadge(plan.badge, message, lang);
      await writeStatus(false, message, err.fallbackKey);
      return;
    }
    await writeStatus(false, plan.error, "");
    return;
  }
  try {
    await chrome.proxy.settings.set({ value: plan.config, scope: SCOPE });
  } catch (error) {
    const err = errorMessage(error, lang);
    await paintBadge(plan.badge, err.message, lang);
    await writeStatus(false, err.message, err.fallbackKey);
    return;
  }
  await paintBadge(plan.badge, "", lang);
  await writeStatus(true, "", "");
}

async function provideCredentials(details) {
  if (!details || details.isProxy !== true) return {};
  const seen = authAttempts.get(details.requestId) || 0;
  if (seen >= 1) return {};
  authAttempts.set(details.requestId, seen + 1);
  if (authAttempts.size > 200) authAttempts.delete(authAttempts.keys().next().value);
  try {
    const state = normalizeState(await chrome.storage.local.get(null));
    const credentials = credentialsForChallenge(state, details);
    return credentials ? { authCredentials: credentials } : {};
  } catch (error) {
    console.error("Proxy sign-in failed.", error);
    return {};
  }
}

async function paintBadge(profile, error, lang = currentLanguage) {
  const text = error ? "ERR" : badgeLabel(profile);
  const color = error ? ERROR_COLOR : profile?.color;
  const title = actionTitle(profile, error, lang);
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    await chrome.action.setBadgeText({ text });
    await chrome.action.setTitle({ title });
  } catch (paintError) {
    console.error("Could not update the toolbar badge.", paintError);
  }
}

async function writeStatus(ok, message, fallbackKey = "") {
  try {
    await chrome.storage.session.set({
      applyStatus: { ok, message, fallbackKey, at: Date.now() },
    });
  } catch (error) {
    console.error("Could not record proxy status.", error);
  }
}

function errorMessage(error, lang = currentLanguage) {
  if (error?.message) return { message: error.message, fallbackKey: "" };
  return { message: t(lang, "err.chromeRejected"), fallbackKey: "err.chromeRejected" };
}
