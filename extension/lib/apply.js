import { normalizeLanguage, t } from "./i18n.js";
import { buildFixedPac, buildPac } from "./pac.js";
import {
  AUTO_ID,
  activeDescriptor,
  bypassHasCidr,
  bypassListError,
  chromeBypassToken,
  cleanHost,
  cleanPort,
  effectiveBypass,
  findProfile,
  validateAutoSwitch,
  validateFixedProfile,
} from "./state.js";

export function buildApplyPlan(state) {
  const lang = normalizeLanguage(state?.language);
  const badge = activeDescriptor(state, lang);
  if (state.activeProfileId === AUTO_ID) {
    const error = validateAutoSwitch(state, lang);
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
  if (!profile) return { ok: false, error: t(lang, "err.selectProfileAgain"), config: null, badge };
  if (profile.builtin === "direct") return { ok: true, error: null, config: { mode: "direct" }, badge };
  if (profile.builtin === "system") return { ok: true, error: null, config: { mode: "system" }, badge };
  const error = validateFixedProfile(profile, lang) || bypassListError(state.globalBypass, { lang, global: true });
  if (error) return { ok: false, error, config: null, badge };
  if (bypassHasCidr(profile, state.globalBypass)) {
    return {
      ok: true,
      error: null,
      config: {
        mode: "pac_script",
        pacScript: { data: buildFixedPac(profile, state.globalBypass, lang), mandatory: false },
      },
      badge,
    };
  }
  return { ok: true, error: null, config: fixedServerConfig(profile, state.globalBypass), badge };
}

export function fixedServerConfig(profile, globalBypass = []) {
  const rules = {
    singleProxy: {
      scheme: profile.proxy.scheme,
      host: cleanHost(profile.proxy.host),
      port: cleanPort(profile.proxy.port),
    },
  };
  const bypassList = effectiveBypass(profile, globalBypass).map((line) => chromeBypassToken(line)).filter(Boolean);
  if (bypassList.length) rules.bypassList = bypassList;
  return { mode: "fixed_servers", rules };
}
