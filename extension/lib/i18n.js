import en from "./locales/en.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import ja from "./locales/ja.js";
import ru from "./locales/ru.js";
import zh from "./locales/zh.js";

export const DEFAULT_LANGUAGE = "en";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ru", label: "Русский" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "ja", label: "日本語" },
];

export const SUPPORTED_LANGUAGES = LANGUAGES.map((entry) => entry.code);

export const LOCALES = { en, zh, ru, es, fr, ja };

const pluralRulesCache = new Map();

export function normalizeLanguage(value) {
  if (typeof value !== "string") return DEFAULT_LANGUAGE;
  const code = value.trim().toLowerCase();
  return Object.hasOwn(LOCALES, code) ? code : DEFAULT_LANGUAGE;
}

export function t(lang, key, params = null) {
  const code = normalizeLanguage(lang);
  const dict = LOCALES[code] || LOCALES[DEFAULT_LANGUAGE];
  const template = Object.hasOwn(dict, key) ? dict[key] : LOCALES[DEFAULT_LANGUAGE][key];
  if (typeof template !== "string") return key;
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.hasOwn(params, name) ? String(params[name]) : match
  ));
}

export function formatRuleCount(lang, count) {
  const code = normalizeLanguage(lang);
  const category = pluralCategory(code, count);
  const key = `popup.rulesCount.${category}`;
  if (Object.hasOwn(LOCALES[code], key)) return t(code, key, { count });
  return t(code, "popup.rulesCount.other", { count });
}

export function setRichText(element, text) {
  if (!element) return;
  const parts = String(text ?? "").split("`");
  const nodes = [];
  for (let index = 0; index < parts.length; index += 1) {
    const chunk = parts[index];
    if (!chunk) continue;
    if (index % 2 === 1 && index < parts.length - 1) {
      const code = document.createElement("code");
      code.textContent = chunk;
      nodes.push(code);
    } else {
      nodes.push(document.createTextNode(chunk));
    }
  }
  element.replaceChildren(...nodes);
}

function pluralCategory(lang, count) {
  if (typeof Intl === "object" && typeof Intl.PluralRules === "function") {
    let rules = pluralRulesCache.get(lang);
    if (!rules) {
      rules = new Intl.PluralRules(lang);
      pluralRulesCache.set(lang, rules);
    }
    return rules.select(count);
  }
  return count === 1 ? "one" : "other";
}
