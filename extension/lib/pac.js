import {
  cleanHost,
  cleanPort,
  findProfile,
  isIpv6,
  parseCidr,
  parsePattern,
  validateAutoSwitch,
} from "./state.js";

const PAC_RUNTIME = `
function FindProxyForURL(url, host) {
  var target = normalizeProxyHost(host);
  var port = portFromProxyUrl(url);
  var i;
  for (i = 0; i < PROXY_DATA.rules.length; i++) {
    var rule = PROXY_DATA.rules[i];
    if (proxyRuleMatches(rule.pattern, rule.port, target, port)) {
      return applyProxyBypass(rule.result, rule.bypass, target, port);
    }
  }
  return applyProxyBypass(PROXY_DATA.fallback.result, PROXY_DATA.fallback.bypass, target, port);
}

function normalizeProxyHost(host) {
  host = lowerText(host);
  host = trimText(host);
  if (charAt(host, 0) === "[") {
    var end = host.indexOf("]");
    if (end > 0) host = host.substring(1, end);
  }
  if (charAt(host, host.length - 1) === ".") host = host.substring(0, host.length - 1);
  return host;
}

function portFromProxyUrl(url) {
  url = String(url || "");
  var schemeEnd = url.indexOf("://");
  if (schemeEnd < 0) return 0;
  var scheme = lowerText(url.substring(0, schemeEnd));
  var rest = url.substring(schemeEnd + 3);
  var slash = rest.indexOf("/");
  var authority = slash < 0 ? rest : rest.substring(0, slash);
  var query = authority.indexOf("?");
  if (query >= 0) authority = authority.substring(0, query);
  var at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.substring(at + 1);
  var portText = "";
  if (charAt(authority, 0) === "[") {
    var bracket = authority.indexOf("]");
    if (bracket >= 0 && charAt(authority, bracket + 1) === ":") portText = authority.substring(bracket + 2);
  } else {
    var colon = authority.lastIndexOf(":");
    if (colon >= 0) portText = authority.substring(colon + 1);
  }
  if (!portText) {
    if (scheme === "https" || scheme === "wss") return 443;
    if (scheme === "http" || scheme === "ws") return 80;
    if (scheme === "ftp") return 21;
    return 0;
  }
  var port = parseInt(portText, 10);
  if (!port || port < 1 || port > 65535) return 0;
  return port;
}

function proxyRuleMatches(pattern, wantPort, host, port) {
  if (wantPort && wantPort !== port) return false;
  if (pattern === "<local>") return host.indexOf(".") === -1 && host.indexOf(":") === -1 && host.length > 0;
  if (pattern.indexOf("*.") === 0) {
    var suffix = pattern.substring(2);
    return host === suffix || endsWithText(host, "." + suffix);
  }
  if (charAt(pattern, 0) === ".") {
    var body = pattern.substring(1);
    return host !== body && endsWithText(host, "." + body);
  }
  return host === pattern;
}

function applyProxyBypass(result, bypass, host, port) {
  var i;
  for (i = 0; i < bypass.length; i++) {
    var entry = bypass[i];
    if (entry.cidr) {
      if (isInNetEx(host, entry.cidr)) return "DIRECT";
      continue;
    }
    if (proxyRuleMatches(entry.pattern, entry.port, host, port)) return "DIRECT";
  }
  return result;
}

function lowerText(value) {
  return String(value || "").toLowerCase();
}

function trimText(value) {
  var text = String(value || "");
  while (charAt(text, 0) === " ") text = text.substring(1);
  while (text.length && charAt(text, text.length - 1) === " ") text = text.substring(0, text.length - 1);
  return text;
}

function charAt(text, index) {
  if (index < 0 || index >= text.length) return "";
  return text.charAt(index);
}

function endsWithText(text, suffix) {
  if (text.length < suffix.length) return false;
  return text.substring(text.length - suffix.length) === suffix;
}
`;

export function pacResult(profile) {
  if (!profile || profile.builtin === "direct") return "DIRECT";
  if (profile.builtin === "system" || profile.kind === "auto") {
    throw new Error("This profile cannot be expressed in a PAC script.");
  }
  const host = cleanHost(profile.proxy.host);
  const port = cleanPort(profile.proxy.port);
  const token = { http: "PROXY", https: "HTTPS", socks4: "SOCKS4", socks5: "SOCKS5" }[profile.proxy.scheme];
  if (!token || !host || !port) throw new Error("This profile cannot be expressed in a PAC script.");
  const rendered = isIpv6(host) ? `[${host}]` : host;
  return `${token} ${rendered}:${port}`;
}

export function buildPac(state) {
  const problem = validateAutoSwitch(state);
  if (problem) throw new Error(problem);
  const rules = [];
  for (const rule of state.autoSwitch.rules) {
    if (!String(rule.pattern || "").trim()) continue;
    const parsed = parsePattern(rule.pattern);
    const profile = findProfile(state, rule.profileId);
    rules.push({
      pattern: parsed.pattern,
      port: parsed.port || 0,
      result: pacResult(profile),
      bypass: bypassData(profile),
    });
  }
  const fallback = findProfile(state, state.autoSwitch.defaultProfileId);
  const data = {
    rules,
    fallback: {
      result: pacResult(fallback),
      bypass: bypassData(fallback),
    },
  };
  return `var PROXY_DATA = ${JSON.stringify(data)};\n${PAC_RUNTIME}`;
}

export function buildFixedPac(profile) {
  const data = {
    rules: [],
    fallback: {
      result: pacResult(profile),
      bypass: bypassData(profile),
    },
  };
  return `var PROXY_DATA = ${JSON.stringify(data)};\n${PAC_RUNTIME}`;
}

function bypassData(profile) {
  if (!profile || profile.builtin) return [];
  const entries = [];
  for (const line of profile.bypass || []) {
    const cidr = parseCidr(line);
    if (cidr.ok) {
      entries.push({ cidr: `${cidr.address}/${cidr.prefix}` });
      continue;
    }
    const parsed = parsePattern(line);
    if (!parsed.ok) continue;
    entries.push({ pattern: parsed.pattern, port: parsed.port || 0 });
  }
  return entries;
}
