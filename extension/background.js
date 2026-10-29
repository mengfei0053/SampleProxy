import { buildApplyPlan } from "./lib/apply.js";
import {
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

chrome.proxy.onProxyError.addListener((details) => {
  if (!details.fatal) return;
  const message = [details.error, details.details].filter(Boolean).join(": ");
  writeStatus(false, message || "Chrome reported a proxy error.");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.profiles && !changes.autoSwitch && !changes.activeProfileId && !changes.schemaVersion) return;
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
  await applyState(state);
}

async function applyState(state) {
  const plan = buildApplyPlan(state);
  if (!plan.ok) {
    await paintBadge(plan.badge, plan.error);
    try {
      const current = await chrome.proxy.settings.get({});
      if (current.level !== "controlled_by_this_extension") {
        await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: SCOPE });
      }
    } catch (error) {
      const message = errorMessage(error) || plan.error;
      await paintBadge(plan.badge, message);
      await writeStatus(false, message);
      return;
    }
    await writeStatus(false, plan.error);
    return;
  }
  try {
    await chrome.proxy.settings.set({ value: plan.config, scope: SCOPE });
  } catch (error) {
    const message = errorMessage(error);
    await paintBadge(plan.badge, message);
    await writeStatus(false, message);
    return;
  }
  await paintBadge(plan.badge, "");
  await writeStatus(true, "");
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

async function paintBadge(profile, error) {
  const text = error ? "ERR" : badgeLabel(profile);
  const color = error ? ERROR_COLOR : profile.color;
  const title = error ? `SampleProxy: ${error}` : `SampleProxy: ${profile.name}`;
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    await chrome.action.setBadgeText({ text });
    await chrome.action.setTitle({ title });
  } catch (paintError) {
    console.error("Could not update the toolbar badge.", paintError);
  }
}

async function writeStatus(ok, message) {
  try {
    await chrome.storage.session.set({
      applyStatus: { ok, message, at: Date.now() },
    });
  } catch (error) {
    console.error("Could not record proxy status.", error);
  }
}

function errorMessage(error) {
  return error?.message || "Chrome rejected the proxy settings.";
}
