import { buildPac } from "./pac.js";
import {
  AUTO_ID,
  activeDescriptor,
  chromeBypassToken,
  cleanHost,
  cleanPort,
  findProfile,
  validateAutoSwitch,
  validateFixedProfile,
} from "./state.js";

export function buildApplyPlan(state) {
  const badge = activeDescriptor(state);
  if (state.activeProfileId === AUTO_ID) {
    const error = validateAutoSwitch(state);
    if (error) return { ok: false, error, config: null, badge };
    return {
      ok: true,
      error: null,
      config: {
        mode: "pac_script",
        pacScript: { data: buildPac(state), mandatory: false },
      },
      badge,
    };
  }
  const profile = findProfile(state, state.activeProfileId);
  if (!profile) return { ok: false, error: "Select a profile again.", config: null, badge };
  if (profile.builtin === "direct") return { ok: true, error: null, config: { mode: "direct" }, badge: profile };
  if (profile.builtin === "system") return { ok: true, error: null, config: { mode: "system" }, badge: profile };
  const error = validateFixedProfile(profile);
  if (error) return { ok: false, error, config: null, badge: profile };
  return { ok: true, error: null, config: fixedServerConfig(profile), badge: profile };
}

export function fixedServerConfig(profile) {
  const rules = {
    singleProxy: {
      scheme: profile.proxy.scheme,
      host: cleanHost(profile.proxy.host),
      port: cleanPort(profile.proxy.port),
    },
  };
  const bypassList = (profile.bypass || []).map((line) => chromeBypassToken(line)).filter(Boolean);
  if (bypassList.length) rules.bypassList = bypassList;
  return { mode: "fixed_servers", rules };
}
