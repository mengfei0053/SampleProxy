import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildApplyPlan, fixedServerConfig } from "../extension/lib/apply.js";
import { buildPac, pacResult } from "../extension/lib/pac.js";
import {
  AUTO_ID,
  DIRECT_ID,
  SYSTEM_ID,
  badgeLabel,
  chromeBypassToken,
  cleanHost,
  createDefaultState,
  createFixedProfile,
  credentialsForChallenge,
  findProfile,
  hostError,
  isProxyHost,
  normalizeState,
  parsePattern,
  patternMatches,
  portFromPageUrl,
  proxyFieldErrors,
  rawIsCurrent,
  resolveTarget,
  splitHostPort,
  stable,
  upsertFixedProfile,
  validateAutoSwitch,
} from "../extension/lib/state.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sample() {
  const state = createDefaultState();
  const socks = createFixedProfile(state.profiles);
  socks.id = "p_socks0001";
  socks.name = "Local SOCKS";
  socks.proxy.username = "ignored-socks-user";
  socks.proxy.password = "ignored-socks-pass";
  const http = createFixedProfile([...state.profiles, socks]);
  http.id = "p_http00001";
  http.name = "Office";
  http.proxy.scheme = "http";
  http.proxy.host = "proxy.example";
  http.proxy.port = 8080;
  http.proxy.username = "alice-secret-user";
  http.proxy.password = "pa$$word";
  http.bypass = ["<local>", "localhost", "127.0.0.1", "[::1]"];
  state.profiles.push(socks, http);
  return { state, socks, http };
}

function routeWithPac(state) {
  const find = runPac(buildPac(state));
  return (url, host = new URL(url).hostname) => {
    const resolved = resolveTarget(state, host, portFromPageUrl(url));
    const expected = !resolved.profile || resolved.profile.builtin === "direct" ? "DIRECT" : pacResult(resolved.profile);
    assert.equal(find(url, host), expected);
    return find(url, host);
  };
}

function runPac(script) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${script}\nthis.FindProxyForURL = FindProxyForURL;`, sandbox, { timeout: 1000 });
  return (url, host) => sandbox.FindProxyForURL(url, host);
}

test("repairs empty storage into Direct and does not mutate input", () => {
  const input = {};
  const state = normalizeState(input);
  assert.equal(input.profiles, undefined);
  assert.equal(state.activeProfileId, DIRECT_ID);
  assert.deepEqual(state.profiles.map((profile) => profile.id), [DIRECT_ID, SYSTEM_ID]);
  assert.equal(rawIsCurrent({}), false);
  assert.equal(rawIsCurrent(state), true);
  assert.equal(stable(state), stable(normalizeState(state)));
});

test("normalizes drafts once and then stays put", () => {
  const raw = {
    profiles: [{
      id: "p_custom0001",
      name: "  Mine \n",
      color: "#5B3D91",
      proxy: { scheme: "SOCKS5", host: "LOCALHOST.", port: "1080", username: "a", password: "b\nc" },
      bypass: [" LocalHost "],
    }],
    activeProfileId: "missing",
    autoSwitch: { defaultProfileId: SYSTEM_ID, rules: [{ pattern: " *.Google.com ", profileId: "p_custom0001" }] },
  };
  const clone = structuredClone(raw);
  const once = normalizeState(raw);
  assert.deepEqual(raw, clone);
  const profile = findProfile(once, "p_custom0001");
  assert.equal(profile.name, "Mine");
  assert.equal(profile.proxy.scheme, "socks5");
  assert.equal(profile.proxy.host, "localhost");
  assert.equal(profile.proxy.port, 1080);
  assert.equal(profile.proxy.password, "bc");
  assert.deepEqual(profile.bypass, ["LocalHost"]);
  assert.equal(once.activeProfileId, DIRECT_ID);
  assert.equal(once.autoSwitch.defaultProfileId, DIRECT_ID);
  assert.equal(once.autoSwitch.rules[0].pattern, "*.google.com");
  assert.equal(stable(once), stable(normalizeState(once)));
  assert.equal(rawIsCurrent(once), true);
});

test("popup save inserts and edits a fixed profile and leaves built-ins alone", () => {
  const state = createDefaultState();
  const before = structuredClone(state);
  const created = createFixedProfile(state.profiles);
  created.name = "  Home ";
  created.proxy.host = "LOCALHOST.";
  created.proxy.username = "socks-user";
  created.proxy.password = "socks-pass";
  const inserted = upsertFixedProfile(state, created);
  assert.deepEqual(state, before);
  assert.equal(inserted.ok, true);
  assert.equal(rawIsCurrent(inserted.state), true);
  assert.equal(inserted.state.activeProfileId, DIRECT_ID);
  const saved = findProfile(inserted.state, created.id);
  assert.equal(saved.name, "Home");
  assert.equal(saved.proxy.scheme, "socks5");
  assert.equal(saved.proxy.host, "localhost");
  assert.equal(saved.proxy.port, 1080);
  assert.equal(saved.proxy.username, "socks-user");
  assert.equal(saved.proxy.password, "socks-pass");
  assert.deepEqual(saved.bypass, ["<local>", "localhost", "127.0.0.1", "[::1]"]);
  assert.deepEqual(inserted.state.profiles.map((profile) => profile.builtin), ["direct", "system", null]);

  const edited = upsertFixedProfile(inserted.state, {
    id: created.id,
    name: "Home",
    color: "#000000",
    bypass: ["evil.example"],
    proxy: { scheme: "http", host: "proxy.example", port: "8080", username: "alice", password: "secret" },
  });
  const updated = findProfile(edited.state, created.id);
  assert.equal(edited.ok, true);
  assert.equal(updated.proxy.scheme, "http");
  assert.equal(updated.proxy.host, "proxy.example");
  assert.equal(updated.proxy.port, 8080);
  assert.equal(updated.proxy.username, "alice");
  assert.equal(updated.proxy.password, "secret");
  assert.equal(updated.color, saved.color);
  assert.deepEqual(updated.bypass, saved.bypass);
  assert.equal(edited.state.activeProfileId, DIRECT_ID);

  const builtin = upsertFixedProfile(edited.state, {
    id: DIRECT_ID,
    name: "Nope",
    proxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 },
  });
  assert.equal(builtin.ok, false);
  assert.equal(findProfile(builtin.state, DIRECT_ID).builtin, "direct");
  assert.equal(builtin.state.profiles.some((profile) => profile.name === "Nope"), false);
  assert.equal(upsertFixedProfile(edited.state, {
    id: "p_blankname01",
    name: " ",
    proxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 },
  }).ok, false);
  assert.match(upsertFixedProfile(edited.state, {
    id: "p_badhost0001",
    name: "Bad",
    proxy: { scheme: "socks5", host: "bad host", port: 1080 },
  }).error, /host/i);
  assert.equal(proxyFieldErrors({ scheme: "socks5", host: "127.0.0.1", port: 1080 }).host, "");
  assert.match(proxyFieldErrors({ scheme: "socks5", host: "", port: "0" }).port, /1 to 65535/);

  let full = edited.state;
  while (full.profiles.filter((profile) => !profile.builtin).length < 40) {
    const extra = createFixedProfile(full.profiles);
    extra.name = `Proxy ${full.profiles.length}`;
    const added = upsertFixedProfile(full, extra);
    assert.equal(added.ok, true);
    full = added.state;
  }
  const overflow = createFixedProfile(full.profiles);
  overflow.name = "Overflow";
  assert.equal(upsertFixedProfile(full, overflow).ok, false);
  const keep = full.profiles.find((profile) => !profile.builtin);
  const renamed = upsertFixedProfile(full, { id: keep.id, name: "Still here", proxy: keep.proxy });
  assert.equal(renamed.ok, true);
  assert.equal(findProfile(renamed.state, keep.id).name, "Still here");
  assert.equal(renamed.state.profiles.filter((profile) => !profile.builtin).length, 40);
});

test("new proxies start as local SOCKS5 and get distinct names", () => {
  const first = createFixedProfile(createDefaultState().profiles);
  const second = createFixedProfile([...createDefaultState().profiles, first]);
  assert.equal(first.proxy.scheme, "socks5");
  assert.equal(first.proxy.host, "127.0.0.1");
  assert.equal(first.proxy.port, 1080);
  assert.equal(first.name, "SOCKS5");
  assert.equal(second.name, "SOCKS5 2");
  assert.notEqual(first.color, second.color);
  assert.deepEqual(first.bypass, ["<local>", "localhost", "127.0.0.1", "[::1]"]);
});

test("host and pattern checks reject partial addresses and unsafe text", () => {
  assert.equal(hostError(""), "Enter a host name or IP address.");
  assert.equal(hostError("127.0.0.1"), "");
  assert.equal(hostError("EXAMPLE.com."), "");
  assert.equal(cleanHost("EXAMPLE.com."), "example.com");
  assert.equal(isProxyHost("127"), false);
  assert.equal(isProxyHost("127.0.0"), false);
  assert.equal(isProxyHost("127.0.0.01"), false);
  assert.equal(isProxyHost("::1"), true);
  assert.match(hostError("http://127.0.0.1"), /host only/i);
  assert.deepEqual(splitHostPort("127.0.0.1:9050"), { host: "127.0.0.1", port: 9050 });
  assert.deepEqual(splitHostPort("[::1]:1080"), { host: "::1", port: 1080 });
  assert.equal(parsePattern("*.google.com").ok, true);
  assert.equal(parsePattern(".google.com").ok, true);
  assert.equal(parsePattern("example.com:443").ok, true);
  assert.equal(parsePattern("<local>").ok, true);
  assert.equal(parsePattern("*").ok, false);
  assert.equal(parsePattern("*google.com").ok, false);
  assert.equal(parsePattern("google.*").ok, false);
  assert.equal(parsePattern("").empty, true);
  assert.equal(patternMatches(parsePattern("*.google.com"), "google.com", 443), true);
  assert.equal(patternMatches(parsePattern("*.google.com"), "www.google.com.", 443), true);
  assert.equal(patternMatches(parsePattern("*.google.com"), "a.b.google.com", 443), true);
  assert.equal(patternMatches(parsePattern("*.google.com"), "google.com.evil.test", 443), false);
  assert.equal(patternMatches(parsePattern("*.google.com"), "notgoogle.com", 443), false);
  assert.equal(patternMatches(parsePattern(".google.com"), "google.com", 443), false);
  assert.equal(patternMatches(parsePattern(".google.com"), "www.google.com", 443), true);
  assert.equal(patternMatches(parsePattern("example.com:443"), "example.com", 80), false);
  assert.equal(patternMatches(parsePattern("example.com:443"), "example.com", 443), true);
  assert.equal(patternMatches(parsePattern("<local>"), "localhost", 80), true);
  assert.equal(patternMatches(parsePattern("<local>"), "127.0.0.1", 80), false);
});

test("fixed, direct, and system plans", () => {
  const { state, socks, http } = sample();
  assert.deepEqual(buildApplyPlan(state).config, { mode: "direct" });
  state.activeProfileId = SYSTEM_ID;
  assert.deepEqual(buildApplyPlan(state).config, { mode: "system" });
  state.activeProfileId = socks.id;
  const socksPlan = buildApplyPlan(state);
  assert.equal(socksPlan.ok, true);
  assert.deepEqual(socksPlan.config, fixedServerConfig(socks));
  assert.equal(socksPlan.config.rules.singleProxy.scheme, "socks5");
  assert.equal(JSON.stringify(socksPlan.config).includes("ignored-socks"), false);
  state.activeProfileId = http.id;
  assert.equal(buildApplyPlan(state).config.rules.singleProxy.host, "proxy.example");
  assert.deepEqual(buildApplyPlan(state).config.rules.bypassList, ["<local>", "localhost", "127.0.0.1", "[::1]"]);
  socks.proxy.host = "::1";
  state.activeProfileId = socks.id;
  assert.equal(buildApplyPlan(state).config.rules.singleProxy.host, "::1");
  assert.equal(pacResult(socks), "SOCKS5 [::1]:1080");
  socks.proxy.host = "";
  assert.equal(buildApplyPlan(state).ok, false);
  assert.equal(chromeBypassToken("::1"), "[::1]");
  assert.equal(chromeBypassToken("[::1]:443"), "[::1]:443");
});

test("auto switch PAC agrees with the matcher and hides credentials", () => {
  const { state, socks, http } = sample();
  socks.proxy.host = "127.0.0.1";
  state.activeProfileId = AUTO_ID;
  state.autoSwitch.defaultProfileId = socks.id;
  state.autoSwitch.rules = [
    { id: "r_google0001", pattern: "*.google.com", profileId: http.id },
    { id: "r_exact00001", pattern: "www.google.com", profileId: socks.id },
    { id: "r_blank00001", pattern: "   ", profileId: http.id },
    { id: "r_port000001", pattern: "example.com:443", profileId: http.id },
  ];
  const script = buildPac(state);
  assert.equal(script.includes("alice-secret-user"), false);
  assert.equal(script.includes("pa$$word"), false);
  assert.equal(script.includes("ignored-socks"), false);
  assert.doesNotMatch(script, /=>|`|\b(?:const|let|class)\b|\beval\s*\(/);
  assert.match(script, /function FindProxyForURL/);
  const route = routeWithPac(state);
  assert.equal(route("https://www.google.com/search?q=1"), "PROXY proxy.example:8080");
  assert.equal(route("https://google.com/"), "PROXY proxy.example:8080");
  assert.equal(route("https://news.google.com/"), "PROXY proxy.example:8080");
  assert.equal(route("https://google.com.evil.test/"), "SOCKS5 127.0.0.1:1080");
  assert.equal(route("https://example.com/docs"), "PROXY proxy.example:8080");
  assert.equal(route("http://example.com/docs"), "SOCKS5 127.0.0.1:1080");
  assert.equal(route("https://example.org/"), "SOCKS5 127.0.0.1:1080");
  assert.equal(route("http://localhost/"), "DIRECT");
  assert.equal(route("http://127.0.0.1/"), "DIRECT");
  assert.equal(route("https://[::1]/", "::1"), "DIRECT");
  state.autoSwitch.rules[0].pattern = "*";
  assert.match(validateAutoSwitch(state), /host pattern/i);
  assert.equal(buildApplyPlan(state).ok, false);
});

test("subdomain-only patterns do not include the apex", () => {
  const { state, socks } = sample();
  state.activeProfileId = AUTO_ID;
  state.autoSwitch.defaultProfileId = DIRECT_ID;
  state.autoSwitch.rules = [{ id: "r_dot0000001", pattern: ".google.com", profileId: socks.id }];
  const route = routeWithPac(state);
  assert.equal(route("https://www.google.com/"), "SOCKS5 127.0.0.1:1080");
  assert.equal(route("https://google.com/"), "DIRECT");
});

test("proxy credentials are returned only for the matching HTTP proxy challenge", () => {
  const { state, socks, http } = sample();
  state.activeProfileId = http.id;
  const good = {
    isProxy: true,
    url: "https://example.com/",
    challenger: { host: "proxy.example", port: 8080 },
    requestId: "1",
  };
  assert.deepEqual(credentialsForChallenge(state, good), {
    username: "alice-secret-user",
    password: "pa$$word",
  });
  assert.equal(credentialsForChallenge(state, { ...good, isProxy: false }), null);
  assert.equal(credentialsForChallenge(state, { ...good, challenger: { host: "evil.example", port: 8080 } }), null);
  state.activeProfileId = socks.id;
  socks.proxy.username = "alice-secret-user";
  assert.equal(credentialsForChallenge(state, {
    isProxy: true,
    challenger: { host: "127.0.0.1", port: 1080 },
  }), null);
  state.activeProfileId = AUTO_ID;
  state.autoSwitch.defaultProfileId = DIRECT_ID;
  state.autoSwitch.rules = [
    { id: "r_rule000001", pattern: "*.google.com", profileId: http.id },
    { id: "r_rule000002", pattern: "*.example.org", profileId: socks.id },
  ];
  socks.proxy.scheme = "http";
  socks.proxy.host = "other.example";
  socks.proxy.port = 9090;
  socks.proxy.username = "other-user";
  socks.proxy.password = "other-pass";
  assert.deepEqual(credentialsForChallenge(state, {
    isProxy: true,
    url: "https://mail.google.com/",
    challenger: { host: "Proxy.Example", port: 8080 },
  }), { username: "alice-secret-user", password: "pa$$word" });
  assert.equal(credentialsForChallenge(state, {
    isProxy: true,
    url: "https://mail.google.com/",
    challenger: { host: "other.example", port: 9090 },
  }), null);
});

test("badge text stays short", () => {
  assert.equal(badgeLabel(findProfile(createDefaultState(), DIRECT_ID)), "DIR");
  assert.equal(badgeLabel(findProfile(createDefaultState(), SYSTEM_ID)), "SYS");
  assert.equal(badgeLabel({ kind: "auto", name: "Auto switch" }), "AUTO");
  assert.equal(badgeLabel({ name: "Home proxy" }), "HOME");
  assert.equal(badgeLabel({ name: "家用代理" }), "家用");
  assert.equal(badgeLabel({ name: "123vpn" }), "123V");
});

test("extension manifest is MV3 and only references local files", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "proxy", "storage", "webRequest", "webRequestAuthProvider"]);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
  ];
  for (const relative of referenced) {
    assert.equal(fs.existsSync(path.join(root, "extension", relative)), true, relative);
  }
  const background = fs.readFileSync(path.join(root, "extension/background.js"), "utf8");
  assert.match(background, /onAuthRequired/);
  assert.match(background, /isProxy/);
  assert.match(background, /asyncBlocking/);
  const popupHtml = fs.readFileSync(path.join(root, "extension/popup/popup.html"), "utf8");
  const popupJs = fs.readFileSync(path.join(root, "extension/popup/popup.js"), "utf8");
  for (const id of ["add-proxy", "editor", "name", "scheme", "host", "port", "username", "password", "save-profile", "cancel-edit"]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }
  assert.match(popupHtml, /value="socks5"/);
  assert.match(popupJs, /upsertFixedProfile/);
  assert.match(popupJs, /createFixedProfile/);
  assert.match(popupJs, /profile\.builtin \? profileButton/);
  assert.match(popupJs, /chrome\.storage\.local\.set/);
  for (const relative of ["popup/popup.html", "popup/popup.js", "options/options.html", "options/options.js", "background.js", "ui.css"]) {
    const text = fs.readFileSync(path.join(root, "extension", relative), "utf8");
    assert.doesNotMatch(text, /https?:\/\//);
    assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>/i);
  }
});
