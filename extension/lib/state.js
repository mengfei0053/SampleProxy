export const SCHEMA_VERSION = 1;
export const MAX_USER_PROFILES = 40;
export const DIRECT_ID = "direct";
export const SYSTEM_ID = "system";
export const AUTO_ID = "auto";

export const DIRECT_COLOR = "#2f6f4e";
export const SYSTEM_COLOR = "#2c5f8a";
export const AUTO_COLOR = "#9f3d22";
export const ERROR_COLOR = "#8d2f2f";

export const PALETTE = [
  "#5b3d91",
  "#8a4b12",
  "#0f6e66",
  "#8e2944",
  "#2f5d2c",
  "#2c4578",
  "#6e4a22",
  "#4a4453",
];

export const SCHEMES = ["http", "https", "socks4", "socks5"];
export const SCHEME_LABEL = {
  http: "HTTP",
  https: "HTTPS",
  socks4: "SOCKS4",
  socks5: "SOCKS5",
};
export const DEFAULT_BYPASS = ["<local>", "localhost", "127.0.0.1", "[::1]"];
const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

export function newId(prefix) {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${rand}`;
}

export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: [builtinDirect(), builtinSystem()],
    activeProfileId: DIRECT_ID,
    autoSwitch: {
      defaultProfileId: DIRECT_ID,
      rules: [],
    },
  };
}

export function createFixedProfile(profiles) {
  const names = new Set(profiles.map((profile) => profile.name.trim().toLowerCase()));
  let name = "SOCKS5";
  let count = 2;
  while (names.has(name.toLowerCase())) {
    name = `SOCKS5 ${count}`;
    count += 1;
  }
  const userCount = profiles.filter((profile) => !profile.builtin).length;
  return {
    id: newId("p"),
    name,
    color: PALETTE[userCount % PALETTE.length],
    builtin: null,
    proxy: {
      scheme: "socks5",
      host: "127.0.0.1",
      port: 1080,
      username: "",
      password: "",
    },
    bypass: [...DEFAULT_BYPASS],
  };
}

export function supportsProxyAuth(scheme) {
  return scheme === "http" || scheme === "https";
}

export function defaultPort(scheme) {
  if (scheme === "https") return 443;
  if (scheme === "http") return 80;
  return 1080;
}

export function normalizeState(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const seen = new Set();
  const users = [];
  const source = Array.isArray(input.profiles) ? input.profiles : [];
  for (const entry of source) {
    if (users.length >= MAX_USER_PROFILES) break;
    const profile = normalizeUserProfile(entry, seen);
    if (!profile) continue;
    seen.add(profile.id);
    users.push(profile);
  }
  const profiles = [builtinDirect(), builtinSystem(), ...users];
  const ids = new Set(profiles.map((profile) => profile.id));
  const activeProfileId = cleanActiveId(input.activeProfileId, ids);
  const autoSwitch = normalizeAuto(input.autoSwitch, ids);
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles,
    activeProfileId,
    autoSwitch,
  };
}

export function rawIsCurrent(raw) {
  if (!raw || typeof raw !== "object") return false;
  const normalized = normalizeState(raw);
  const projected = {
    schemaVersion: raw.schemaVersion,
    profiles: raw.profiles,
    activeProfileId: raw.activeProfileId,
    autoSwitch: raw.autoSwitch,
  };
  return stable(projected) === stable(normalized);
}

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function findProfile(state, id) {
  return state.profiles.find((profile) => profile.id === id) || null;
}

export function listSelectableProfiles(state) {
  return state.profiles.filter((profile) => profile.builtin !== "system");
}

export function activeDescriptor(state) {
  if (state.activeProfileId === AUTO_ID) {
    return {
      id: AUTO_ID,
      name: "Auto switch",
      color: AUTO_COLOR,
      kind: "auto",
      builtin: null,
    };
  }
  return findProfile(state, state.activeProfileId) || findProfile(state, DIRECT_ID);
}

export function describeProfile(profile) {
  if (!profile) return "";
  if (profile.kind === "auto") return "Rules pick a profile per site";
  if (profile.builtin === "direct") return "No proxy";
  if (profile.builtin === "system") return "Operating system proxy";
  const scheme = SCHEME_LABEL[profile.proxy?.scheme] || "Proxy";
  const host = profile.proxy?.host || "No host";
  const port = profile.proxy?.port ? `:${profile.proxy.port}` : "";
  return `${scheme} · ${host}${port}`;
}

export function badgeLabel(profile) {
  if (!profile) return "ERR";
  if (profile.kind === "auto") return "AUTO";
  if (profile.builtin === "direct") return "DIR";
  if (profile.builtin === "system") return "SYS";
  const name = String(profile.name || "").trim();
  if (!name) return "PRX";
  const ascii = name.replace(/[^A-Za-z0-9]/g, "");
  if (ascii) return ascii.slice(0, 4).toUpperCase();
  return Array.from(name).slice(0, 2).join("");
}

export function cleanHost(value) {
  let host = String(value ?? "").trim().toLowerCase().slice(0, 253);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host;
}

export function cleanPort(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }
  if (typeof value === "string" && /^[1-9]\d{0,4}$/.test(value)) {
    const port = Number(value);
    if (port >= 1 && port <= 65535) return port;
  }
  return null;
}

export function isIpv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return false;
    return Number(part) <= 255;
  });
}

export function isIpv6(value) {
  const text = String(value || "");
  if (!text.includes(":") || !/^[0-9a-f:]+$/.test(text) || text.includes(":::")) return false;
  const halves = text.split("::");
  if (halves.length > 2) return false;
  const groups = text.split(":").filter((group) => group.length > 0);
  if (groups.some((group) => group.length > 4)) return false;
  if (halves.length === 2) return groups.length <= 7;
  return groups.length === 8;
}

export function isDomain(value) {
  if (!value || value.length > 253 || !/[a-z]/.test(value)) return false;
  return value.split(".").every((label) => LABEL.test(label));
}

export function isProxyHost(value) {
  const host = String(value || "");
  if (!host || host.length > 253) return false;
  return isIpv4(host) || isIpv6(host) || isDomain(host);
}

export function hostError(value) {
  const original = String(value ?? "").trim();
  if (!original) return "Enter a host name or IP address.";
  if (/[^\x00-\x7f]/.test(original)) {
    return "Use the punycode (ASCII) form of international host names.";
  }
  if (original.includes("://") || original.includes("/") || /\s/.test(original)) {
    return "Enter the host only, for example 127.0.0.1.";
  }
  const host = cleanHost(original);
  if (!isProxyHost(host)) return "Enter a host name or IP address.";
  return "";
}

export function splitHostPort(value) {
  const text = String(value ?? "").trim();
  if (!text || text.includes("://") || text.includes("/") || /\s/.test(text)) {
    return { host: cleanHost(text), port: null };
  }
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end > 1) {
      const host = cleanHost(text.slice(1, end));
      const rest = text.slice(end + 1);
      if (!rest) return { host, port: null };
      const port = /^:(\d{1,5})$/.exec(rest);
      if (!port) return { host: cleanHost(text), port: null };
      return { host, port: cleanPort(port[1]) };
    }
  }
  const lower = text.toLowerCase();
  if (isIpv6(cleanHost(lower))) return { host: cleanHost(lower), port: null };
  const match = /^(.*):(\d{1,5})$/.exec(lower);
  if (match && !match[1].includes(":")) {
    return { host: cleanHost(match[1]), port: cleanPort(match[2]) };
  }
  return { host: cleanHost(text), port: null };
}

export function parsePattern(input) {
  const text = String(input ?? "").trim().toLowerCase();
  if (!text) return { ok: false, empty: true, error: "Enter a host pattern." };
  const wildcard = text.includes("*") && !text.startsWith("*.");
  if (text.includes("://") || text.includes("/") || /\s/.test(text) || wildcard) {
    return { ok: false, empty: false, error: "Use example.com, *.example.com, or .example.com." };
  }
  let pattern = text;
  let port = 0;
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end < 0) return { ok: false, empty: false, error: "Invalid IPv6 pattern." };
    pattern = text.slice(1, end);
    const rest = text.slice(end + 1);
    if (rest) {
      const match = /^:(\d{1,5})$/.exec(rest);
      if (!match) return { ok: false, empty: false, error: "Invalid port in pattern." };
      const parsed = cleanPort(match[1]);
      if (!parsed) return { ok: false, empty: false, error: "Port must be a number from 1 to 65535." };
      port = parsed;
    }
  } else {
    const match = /^(.*):(\d{1,5})$/.exec(text);
    if (match && !match[1].includes(":")) {
      pattern = match[1];
      const parsed = cleanPort(match[2]);
      if (!parsed) return { ok: false, empty: false, error: "Port must be a number from 1 to 65535." };
      port = parsed;
    }
  }
  if (!isHostPattern(pattern)) {
    return { ok: false, empty: false, error: "Use example.com, *.example.com, or .example.com." };
  }
  return { ok: true, empty: false, pattern, port, error: "" };
}

export function patternMatches(parsed, host, port) {
  if (!parsed?.ok) return false;
  const normalized = normalizeHost(host);
  const want = parsed.port || 0;
  if (want && want !== Number(port)) return false;
  return hostPatternMatches(parsed.pattern, normalized);
}

export function normalizeHost(host) {
  let value = String(host ?? "").trim().toLowerCase();
  if (value.startsWith("[") && value.includes("]")) value = value.slice(1, value.indexOf("]"));
  if (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

export function portFromPageUrl(url) {
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  if (parsed.protocol === "https:") return 443;
  if (parsed.protocol === "http:") return 80;
  if (parsed.protocol === "ftp:") return 21;
  return 0;
}

export function profileBypasses(profile, host, port) {
  if (!profile || profile.builtin === "direct" || profile.builtin === "system") return false;
  const lines = Array.isArray(profile.bypass) ? profile.bypass : [];
  return lines.some((line) => patternMatches(parsePattern(line), host, port));
}

export function resolveTarget(state, host, port) {
  const normalized = normalizeHost(host);
  const portNum = Number(port) || 0;
  if (state.activeProfileId !== AUTO_ID) {
    const profile = findProfile(state, state.activeProfileId) || findProfile(state, DIRECT_ID);
    if (profileBypasses(profile, normalized, portNum)) {
      return { profile: findProfile(state, DIRECT_ID), bypassed: true };
    }
    return { profile, bypassed: false };
  }
  const problem = validateAutoSwitch(state);
  if (problem) return { profile: null, bypassed: false, error: problem };
  let chosen = findProfile(state, state.autoSwitch.defaultProfileId) || findProfile(state, DIRECT_ID);
  for (const rule of state.autoSwitch.rules) {
    const parsed = parsePattern(rule.pattern);
    if (!parsed.ok) continue;
    if (patternMatches(parsed, normalized, portNum)) {
      chosen = findProfile(state, rule.profileId) || chosen;
      break;
    }
  }
  if (profileBypasses(chosen, normalized, portNum)) {
    return { profile: findProfile(state, DIRECT_ID), bypassed: true };
  }
  return { profile: chosen, bypassed: false };
}

export function proxyFieldErrors(proxy) {
  return {
    scheme: SCHEMES.includes(proxy?.scheme) ? "" : "Choose HTTP, HTTPS, SOCKS4, or SOCKS5.",
    host: hostError(proxy?.host),
    port: cleanPort(proxy?.port) == null ? "Port must be a number from 1 to 65535." : "",
  };
}

export function upsertFixedProfile(state, profile) {
  const next = normalizeState(state);
  const reject = (error) => ({ ok: false, error, state: next });
  if (!profile || typeof profile !== "object" || profile.builtin) {
    return reject("Built-in profiles cannot be edited.");
  }
  if (profile.id === DIRECT_ID || profile.id === SYSTEM_ID || profile.id === AUTO_ID) {
    return reject("Built-in profiles cannot be edited.");
  }
  const name = String(profile.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) return reject("Give the profile a name.");
  const fields = proxyFieldErrors(profile.proxy);
  const fieldError = fields.scheme || fields.host || fields.port;
  if (fieldError) return reject(fieldError);
  const index = next.profiles.findIndex((item) => item.id === profile.id);
  if (index === -1) {
    const count = next.profiles.filter((item) => !item.builtin).length;
    if (count >= MAX_USER_PROFILES) {
      return reject("You can save 40 proxy profiles. Delete one in Proxy settings before adding another.");
    }
    next.profiles.push({ ...profile, name, builtin: null });
  } else if (next.profiles[index].builtin) {
    return reject("Built-in profiles cannot be edited.");
  } else {
    const current = next.profiles[index];
    next.profiles[index] = {
      ...current,
      name,
      proxy: {
        scheme: profile.proxy.scheme,
        host: profile.proxy.host,
        port: profile.proxy.port,
        username: profile.proxy.username,
        password: profile.proxy.password,
      },
    };
  }
  return { ok: true, error: "", state: normalizeState(next) };
}

export function validateFixedProfile(profile) {
  if (!profile || profile.builtin) return "Choose a fixed proxy profile.";
  if (!SCHEMES.includes(profile.proxy?.scheme)) return "Choose HTTP, HTTPS, SOCKS4, or SOCKS5.";
  const problem = hostError(profile.proxy?.host);
  if (problem) return problem;
  if (cleanPort(profile.proxy?.port) == null) return "Port must be a number from 1 to 65535.";
  for (const line of profile.bypass || []) {
    const parsed = parsePattern(line);
    if (!parsed.ok) {
      return `Bypass entry "${clip(line)}" is not valid. Use localhost, *.example.com, or <local>.`;
    }
  }
  return "";
}

export function validateAutoSwitch(state) {
  const fallback = findProfile(state, state.autoSwitch?.defaultProfileId);
  const fallbackError = validateTargetProfile(fallback, "The default profile");
  if (fallbackError) return fallbackError;
  for (const rule of state.autoSwitch?.rules || []) {
    if (!String(rule.pattern || "").trim()) continue;
    const parsed = parsePattern(rule.pattern);
    if (!parsed.ok) {
      return `Rule "${clip(rule.pattern)}" is not a host pattern. Use example.com or *.example.com.`;
    }
    const profile = findProfile(state, rule.profileId);
    const ruleError = validateTargetProfile(profile, `Rule "${clip(rule.pattern)}"`);
    if (ruleError) return ruleError;
  }
  return "";
}

export function credentialsForChallenge(state, details) {
  if (!details || details.isProxy !== true) return null;
  const profile = profileForChallenge(state, details);
  if (!profile?.proxy || !supportsProxyAuth(profile.proxy.scheme)) return null;
  const username = cleanSecret(profile.proxy.username);
  if (!username) return null;
  const proxyHost = cleanHost(profile.proxy.host);
  const challengerHost = cleanHost(details.challenger?.host || "");
  if (!proxyHost || proxyHost !== challengerHost) return null;
  const proxyPort = cleanPort(profile.proxy.port);
  const challengerPort = Number(details.challenger?.port) || defaultPort(profile.proxy.scheme);
  if (proxyPort !== challengerPort) return null;
  return { username, password: cleanSecret(profile.proxy.password) };
}

export function chromeBypassToken(line) {
  const parsed = parsePattern(line);
  if (!parsed.ok) return null;
  const host = isIpv6(parsed.pattern) ? `[${parsed.pattern}]` : parsed.pattern;
  return parsed.port ? `${host}:${parsed.port}` : host;
}

function profileForChallenge(state, details) {
  if (state.activeProfileId !== AUTO_ID) return findProfile(state, state.activeProfileId);
  if (!details.url) return null;
  let host = "";
  let port = 0;
  try {
    host = new URL(details.url).hostname;
    port = portFromPageUrl(details.url);
  } catch {
    return null;
  }
  return resolveTarget(state, host, port).profile;
}

function validateTargetProfile(profile, label) {
  if (!profile) return `${label} is missing. Choose Direct or a fixed server.`;
  if (profile.builtin === "system" || profile.kind === "auto") {
    return `${label} cannot be the System profile. Choose Direct or a fixed server.`;
  }
  if (profile.builtin === "direct") return "";
  const problem = validateFixedProfile(profile);
  return problem ? `${label}: ${problem}` : "";
}

function builtinDirect() {
  return { id: DIRECT_ID, name: "Direct", color: DIRECT_COLOR, builtin: "direct" };
}

function builtinSystem() {
  return { id: SYSTEM_ID, name: "System", color: SYSTEM_COLOR, builtin: "system" };
}

function normalizeUserProfile(entry, seen) {
  if (!entry || typeof entry !== "object" || entry.builtin === "direct" || entry.builtin === "system") {
    return null;
  }
  let id = cleanId(entry.id, "p");
  while (seen.has(id) || id === DIRECT_ID || id === SYSTEM_ID || id === AUTO_ID) id = newId("p");
  const scheme = SCHEMES.includes(entry.proxy?.scheme) ? entry.proxy.scheme : "socks5";
  const bypassSource = Array.isArray(entry.bypass) ? entry.bypass : DEFAULT_BYPASS;
  return {
    id,
    name: cleanName(entry.name),
    color: cleanColor(entry.color),
    builtin: null,
    proxy: {
      scheme,
      host: cleanHost(entry.proxy?.host),
      port: cleanPort(entry.proxy?.port),
      username: cleanSecret(entry.proxy?.username),
      password: cleanSecret(entry.proxy?.password),
    },
    bypass: bypassSource.map((line) => String(line ?? "").trim()).filter(Boolean).slice(0, 40),
  };
}

function normalizeAuto(autoSwitch, ids) {
  const source = autoSwitch && typeof autoSwitch === "object" ? autoSwitch : {};
  const defaultProfileId = ids.has(source.defaultProfileId) && source.defaultProfileId !== SYSTEM_ID
    ? source.defaultProfileId
    : DIRECT_ID;
  const seen = new Set();
  const rules = [];
  for (const entry of Array.isArray(source.rules) ? source.rules : []) {
    if (rules.length >= 80 || !entry || typeof entry !== "object") continue;
    if (!ids.has(entry.profileId) || entry.profileId === SYSTEM_ID) continue;
    let id = cleanId(entry.id, "r");
    while (seen.has(id)) id = newId("r");
    seen.add(id);
    rules.push({
      id,
      pattern: String(entry.pattern ?? "").trim().toLowerCase().slice(0, 253),
      profileId: entry.profileId,
    });
  }
  return { defaultProfileId, rules };
}

function cleanActiveId(value, ids) {
  if (value === AUTO_ID) return AUTO_ID;
  if (typeof value === "string" && ids.has(value)) return value;
  return DIRECT_ID;
}

function cleanId(value, prefix) {
  if (typeof value === "string" && /^[a-z]_[a-z0-9-]{4,40}$/i.test(value)) return value;
  return newId(prefix);
}

function cleanName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
}

function cleanColor(value) {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  return PALETTE[0];
}

function cleanSecret(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256);
}

function isHostPattern(pattern) {
  if (pattern === "<local>") return true;
  let body = pattern;
  let wild = false;
  if (pattern.startsWith("*.")) {
    wild = true;
    body = pattern.slice(2);
  } else if (pattern.startsWith(".")) {
    wild = true;
    body = pattern.slice(1);
  }
  if (!body || body.includes("*")) return false;
  if (isIpv4(body) || isIpv6(body)) return !wild;
  return isDomain(body);
}

function hostPatternMatches(pattern, host) {
  if (!host) return false;
  if (pattern === "<local>") return !host.includes(".") && !host.includes(":");
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  if (pattern.startsWith(".")) {
    const suffix = pattern.slice(1);
    return host !== suffix && host.endsWith(`.${suffix}`);
  }
  return host === pattern;
}

function clip(value) {
  const text = String(value ?? "").trim();
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}
