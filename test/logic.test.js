import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildApplyPlan, fixedServerConfig } from "../extension/lib/apply.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LOCALES,
  SUPPORTED_LANGUAGES,
  formatRuleCount,
  normalizeLanguage,
  t,
} from "../extension/lib/i18n.js";
import { buildFixedPac, buildPac, pacResult } from "../extension/lib/pac.js";
import {
  AUTO_ID,
  DIRECT_ID,
  SYSTEM_ID,
  actionTitle,
  activeDescriptor,
  badgeLabel,
  bypassHasCidr,
  bypassListError,
  chromeBypassToken,
  cleanHost,
  createDefaultState,
  createFixedProfile,
  credentialsForChallenge,
  describeProfile,
  effectiveBypass,
  findProfile,
  hostError,
  isProxyHost,
  mergeBypassLists,
  normalizeState,
  parsePattern,
  patternMatches,
  ipInCidr,
  portFromPageUrl,
  profileBypasses,
  profileDisplayName,
  proxyFieldErrors,
  rawIsCurrent,
  resolveTarget,
  splitBypassText,
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
  const sandbox = {
    isInNetEx(host, cidr) {
      return ipInCidr(host, cidr);
    },
  };
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
    bypass: ["evil.example", "*.internal.example"],
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
  assert.deepEqual(updated.bypass, ["evil.example", "*.internal.example"]);
  const kept = upsertFixedProfile(edited.state, {
    id: created.id,
    name: "Home",
    proxy: updated.proxy,
  });
  assert.deepEqual(findProfile(kept.state, created.id).bypass, ["evil.example", "*.internal.example"]);
  assert.match(upsertFixedProfile(edited.state, {
    id: created.id,
    name: "Home",
    proxy: updated.proxy,
    bypass: ["bad host"],
  }).error, /bypass entry/i);
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

test("a profile bypass list skips those hosts and rejects addresses the proxy model does not use", () => {
  const state = createDefaultState();
  const profile = createFixedProfile(state.profiles);
  profile.name = "Office";
  profile.bypass = splitBypassText(" localhost, *.internal.example\n10.0.0.8 ");
  const saved = upsertFixedProfile(state, profile);
  assert.equal(saved.ok, true);
  saved.state.activeProfileId = profile.id;
  const plan = buildApplyPlan(saved.state);
  assert.deepEqual(plan.config.rules.bypassList, ["localhost", "*.internal.example", "10.0.0.8"]);
  assert.equal(resolveTarget(saved.state, "www.internal.example", 443).profile.builtin, "direct");
  assert.equal(resolveTarget(saved.state, "10.0.0.8", 80).bypassed, true);
  assert.equal(resolveTarget(saved.state, "example.com", 443).bypassed, false);
  assert.equal(bypassListError(["10.0.0.0/8", "192.168.0.0/16", "2001:db8::/32"]), "");
  assert.match(bypassListError(["10.0.0.0/33"]), /0 to 32/);
  assert.match(bypassListError(["2001:db8::/129"]), /0 to 128/);
  assert.match(bypassListError(["example.com/8"]), /not valid/i);
  assert.equal(bypassListError(splitBypassText("*.internal.example, <local>")), "");
});

test("CIDR bypass is applied through the PAC script", () => {
  const { state, http } = sample();
  http.bypass = ["10.0.0.0/8", "192.168.0.0/16", "2001:db8::/32", "*.internal.example"];
  state.activeProfileId = http.id;
  const plan = buildApplyPlan(state);
  assert.equal(plan.config.mode, "pac_script");
  const script = plan.config.pacScript.data;
  assert.match(script, /isInNetEx/);
  assert.equal(script.includes("10.0.0.0/8"), true);
  assert.equal(script.includes("pa$$word"), false);
  const find = runPac(script);
  assert.equal(find("http://10.1.2.3/", "10.1.2.3"), "DIRECT");
  assert.equal(find("http://192.168.4.5/", "192.168.4.5"), "DIRECT");
  assert.equal(find("http://11.0.0.1/", "11.0.0.1"), "PROXY proxy.example:8080");
  assert.equal(find("http://[2001:db8::5]/", "2001:db8::5"), "DIRECT");
  assert.equal(find("http://[2001:db9::5]/", "2001:db9::5"), "PROXY proxy.example:8080");
  assert.equal(find("http://www.internal.example/", "www.internal.example"), "DIRECT");
  assert.equal(resolveTarget(state, "10.255.0.1", 80).bypassed, true);
  assert.equal(ipInCidr("172.16.5.5", "172.16.0.0/12"), true);
  assert.equal(ipInCidr("172.32.0.1", "172.16.0.0/12"), false);
  state.activeProfileId = AUTO_ID;
  state.autoSwitch.defaultProfileId = http.id;
  state.autoSwitch.rules = [];
  const route = routeWithPac(state);
  assert.equal(route("http://10.9.9.9/a"), "DIRECT");
  assert.equal(route("https://example.org/"), "PROXY proxy.example:8080");
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

test("badge text is the switch state, and the tooltip keeps the full name", () => {
  assert.equal(badgeLabel(findProfile(createDefaultState(), DIRECT_ID)), "OFF");
  assert.equal(badgeLabel(findProfile(createDefaultState(), SYSTEM_ID)), "ON");
  assert.equal(badgeLabel({ kind: "auto", name: "Auto switch" }), "ON");
  assert.equal(badgeLabel(null), "ERR");
  assert.equal(badgeLabel({ name: "Social proxy", proxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 } }), "ON");
  assert.equal(badgeLabel({ name: "家用代理", proxy: { scheme: "socks4", host: "10.0.0.1", port: 1080 } }), "ON");
  assert.equal(badgeLabel({ name: "Office", proxy: { scheme: "http", host: "proxy.example", port: 8080 } }), "ON");
  assert.equal(badgeLabel({ name: "Secure", proxy: { scheme: "https", host: "proxy.example", port: 443 } }), "ON");
  const title = actionTitle({
    name: "Social proxy",
    proxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 },
  }, "");
  assert.match(title, /Social proxy/);
  assert.match(title, /SOCKS5 · 127\.0\.0\.1:1080/);
  assert.equal(title.includes("SOCI"), false);
  const failed = actionTitle({
    name: "Office",
    proxy: { scheme: "http", host: "proxy.example", port: 8080 },
  }, "Chrome rejected the proxy settings.");
  assert.match(failed, /Office/);
  assert.match(failed, /HTTP · proxy\.example:8080/);
  assert.match(failed, /rejected the proxy/);
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
  for (const id of ["add-proxy", "editor", "name", "scheme", "host", "port", "username", "password", "bypass", "save-profile", "cancel-edit"]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }
  assert.match(popupHtml, /value="socks5"/);
  assert.match(popupJs, /upsertFixedProfile/);
  assert.match(popupJs, /createFixedProfile/);
  assert.match(popupJs, /profile\.builtin \? profileButton/);
  assert.match(popupJs, /chrome\.storage\.local\.set/);
  for (const relative of [
    "popup/popup.html",
    "popup/popup.js",
    "options/options.html",
    "options/options.js",
    "background.js",
    "ui.css",
    "lib/i18n.js",
    ...SUPPORTED_LANGUAGES.map((code) => `lib/locales/${code}.js`),
  ]) {
    const text = fs.readFileSync(path.join(root, "extension", relative), "utf8");
    assert.doesNotMatch(text, /https?:\/\//);
    assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>/i);
  }
  const optionsHtml = fs.readFileSync(path.join(root, "extension/options/options.html"), "utf8");
  const optionsJs = fs.readFileSync(path.join(root, "extension/options/options.js"), "utf8");
  for (const id of ["language", "global-bypass-card", "global-bypass", "global-bypass-error"]) {
    assert.match(optionsHtml, new RegExp(`id="${id}"`));
  }
  assert.match(optionsJs, /globalBypass/);
  assert.match(optionsJs, /language/);
  assert.match(background, /globalBypass/);
  assert.match(background, /language/);
});

test("language and globalBypass normalize cleanly and stay backward compatible with old saves", () => {
  const defaults = createDefaultState();
  assert.equal(defaults.language, DEFAULT_LANGUAGE);
  assert.equal(defaults.language, "en");
  assert.deepEqual(defaults.globalBypass, []);

  assert.equal(normalizeLanguage(undefined), "en");
  assert.equal(normalizeLanguage(null), "en");
  assert.equal(normalizeLanguage(""), "en");
  assert.equal(normalizeLanguage(42), "en");
  assert.equal(normalizeLanguage("de"), "en");
  assert.equal(normalizeLanguage("en-US"), "en");
  assert.equal(normalizeLanguage(" ZH "), "zh");
  assert.equal(normalizeLanguage("RU"), "ru");
  assert.equal(normalizeLanguage("es"), "es");
  assert.equal(normalizeLanguage("fr"), "fr");
  assert.equal(normalizeLanguage("ja"), "ja");

  // Simulate an older saved payload lacking language and globalBypass
  const legacy = {
    schemaVersion: 1,
    profiles: [
      { id: DIRECT_ID, name: "Direct", color: "#2f6f4e", builtin: "direct" },
      { id: SYSTEM_ID, name: "System", color: "#2c5f8a", builtin: "system" },
    ],
    activeProfileId: DIRECT_ID,
    autoSwitch: { defaultProfileId: DIRECT_ID, rules: [] },
  };
  assert.equal(rawIsCurrent(legacy), false);
  const migrated = normalizeState(legacy);
  assert.equal(migrated.language, "en");
  assert.deepEqual(migrated.globalBypass, []);
  assert.equal(rawIsCurrent(migrated), true);
  assert.equal(stable(migrated), stable(normalizeState(migrated)));

  // Trims entries and ignores blanks in globalBypass while keeping order
  const withSettings = normalizeState({
    ...legacy,
    language: "JA",
    globalBypass: ["  *.corp.example ", "", "10.0.0.0/8", "  "],
  });
  assert.equal(withSettings.language, "ja");
  assert.deepEqual(withSettings.globalBypass, ["*.corp.example", "10.0.0.0/8"]);
  assert.equal(rawIsCurrent(withSettings), true);

  // Popup upsert preserves language and globalBypass
  const created = createFixedProfile(withSettings.profiles);
  created.name = "Corp";
  const upserted = upsertFixedProfile(withSettings, created);
  assert.equal(upserted.ok, true);
  assert.equal(upserted.state.language, "ja");
  assert.deepEqual(upserted.state.globalBypass, ["*.corp.example", "10.0.0.0/8"]);
});

test("globalBypass merges and deduplicates in stable order for fixed proxies", () => {
  const { state, http } = sample();
  http.bypass = ["<local>", "LocalHost", "127.0.0.1", "[::1]", "*.team.example"];
  state.globalBypass = [
    "localhost",
    "::1",
    "*.TEAM.example",
    "*.corp.example",
    "intranet.example:8443",
    "INTRANET.EXAMPLE:8443",
    ".sub.example",
    "*.sub.example",
  ];
  state.activeProfileId = http.id;

  const merged = effectiveBypass(http, state.globalBypass);
  assert.deepEqual(merged, [
    "<local>",
    "LocalHost",
    "127.0.0.1",
    "[::1]",
    "*.team.example",
    "*.corp.example",
    "intranet.example:8443",
    ".sub.example",
    "*.sub.example",
  ]);
  assert.deepEqual(mergeBypassLists(["2001:0db8::/32"], ["[2001:DB8::]/32", "10.0.0.0/8"]), [
    "2001:0db8::/32",
    "10.0.0.0/8",
  ]);

  const plan = buildApplyPlan(state);
  assert.equal(plan.ok, true);
  assert.equal(plan.config.mode, "fixed_servers");
  assert.deepEqual(plan.config, fixedServerConfig(http, state.globalBypass));
  assert.deepEqual(plan.config.rules.bypassList, [
    "<local>",
    "localhost",
    "127.0.0.1",
    "[::1]",
    "*.team.example",
    "*.corp.example",
    "intranet.example:8443",
    ".sub.example",
    "*.sub.example",
  ]);

  assert.equal(profileBypasses(http, "app.team.example", 443, state.globalBypass), true);
  assert.equal(profileBypasses(http, "app.corp.example", 443, state.globalBypass), true);
  assert.equal(profileBypasses(http, "intranet.example", 8443, state.globalBypass), true);
  assert.equal(profileBypasses(http, "intranet.example", 443, state.globalBypass), false);
  assert.equal(resolveTarget(state, "app.corp.example", 443).bypassed, true);
  assert.equal(resolveTarget(state, "app.corp.example", 443).profile.builtin, "direct");
  assert.equal(resolveTarget(state, "public.example", 443).bypassed, false);
  assert.equal(resolveTarget(state, "public.example", 443).profile.id, http.id);
});

test("CIDR present only in globalBypass forces PAC path and matches both profile and global entries", () => {
  const { state, http } = sample();
  http.bypass = ["localhost", "*.profile.example"];
  state.globalBypass = ["10.0.0.0/8", "2001:db8::/32", "localhost", "*.global.example"];
  state.activeProfileId = http.id;

  assert.equal(bypassHasCidr(http), false);
  assert.equal(bypassHasCidr(http, state.globalBypass), true);

  const plan = buildApplyPlan(state);
  assert.equal(plan.ok, true);
  assert.equal(plan.config.mode, "pac_script");
  const script = plan.config.pacScript.data;
  assert.equal(script, buildFixedPac(http, state.globalBypass));
  assert.match(script, /isInNetEx/);
  assert.equal(script.includes("10.0.0.0/8"), true);
  assert.equal(script.includes("2001:db8::/32"), true);
  assert.equal(script.includes(http.proxy.password), false);

  const find = runPac(script);
  assert.equal(find("http://localhost/", "localhost"), "DIRECT");
  assert.equal(find("https://a.profile.example/", "a.profile.example"), "DIRECT");
  assert.equal(find("https://b.global.example/", "b.global.example"), "DIRECT");
  assert.equal(find("http://10.42.0.1/", "10.42.0.1"), "DIRECT");
  assert.equal(find("http://[2001:db8::99]/", "2001:db8::99"), "DIRECT");
  assert.equal(find("http://11.0.0.1/", "11.0.0.1"), "PROXY proxy.example:8080");
  assert.equal(find("http://[2001:db9::99]/", "2001:db9::99"), "PROXY proxy.example:8080");
  assert.equal(find("https://example.org/", "example.org"), "PROXY proxy.example:8080");

  assert.equal(resolveTarget(state, "10.42.0.1", 80).bypassed, true);
  assert.equal(resolveTarget(state, "2001:db8::99", 80).bypassed, true);
  assert.equal(resolveTarget(state, "b.global.example", 443).bypassed, true);
  assert.equal(resolveTarget(state, "example.org", 443).bypassed, false);
});

test("Auto switch applies profile bypass plus globalBypass while preserving first-match-wins", () => {
  const { state, socks, http } = sample();
  http.bypass = ["docs.google.com"];
  socks.bypass = ["*.local.test"];
  state.globalBypass = ["mail.google.com", "10.0.0.0/8", "bypass.example.org"];
  state.activeProfileId = AUTO_ID;
  state.autoSwitch.defaultProfileId = socks.id;
  state.autoSwitch.rules = [
    { id: "r_rule000001", pattern: "*.google.com", profileId: http.id },
    { id: "r_rule000002", pattern: "www.google.com", profileId: socks.id },
    { id: "r_rule000003", pattern: "direct.example", profileId: DIRECT_ID },
  ];

  const route = routeWithPac(state);
  // First matching rule wins (*.google.com -> http, not www.google.com -> socks)
  assert.equal(route("https://www.google.com/"), "PROXY proxy.example:8080");
  // Profile bypass on matched rule target
  assert.equal(route("https://docs.google.com/"), "DIRECT");
  assert.equal(resolveTarget(state, "docs.google.com", 443).bypassed, true);
  // Global bypass on matched rule target
  assert.equal(route("https://mail.google.com/"), "DIRECT");
  assert.equal(resolveTarget(state, "mail.google.com", 443).bypassed, true);
  // Global bypass on fallback proxy target (host + CIDR)
  assert.equal(route("https://bypass.example.org/"), "DIRECT");
  assert.equal(route("http://10.8.8.8/"), "DIRECT");
  // Profile bypass on fallback proxy target
  assert.equal(route("https://app.local.test/"), "DIRECT");
  // Non-bypassed fallback uses socks
  assert.equal(route("https://example.org/"), "SOCKS5 127.0.0.1:1080");
  // Direct rule stays direct without bypassed flag
  assert.equal(route("https://direct.example/"), "DIRECT");
  assert.equal(resolveTarget(state, "direct.example", 443).bypassed, false);

  // Proxy credentials are NOT supplied when host is globally bypassed in Auto switch
  assert.equal(credentialsForChallenge(state, {
    isProxy: true,
    url: "https://mail.google.com/",
    challenger: { host: "proxy.example", port: 8080 },
  }), null);
  assert.deepEqual(credentialsForChallenge(state, {
    isProxy: true,
    url: "https://www.google.com/",
    challenger: { host: "proxy.example", port: 8080 },
  }), { username: http.proxy.username, password: http.proxy.password });
});

test("Direct and System ignore globalBypass and never wrap System in PAC; invalid globalBypass blocks proxy plans only", () => {
  const { state, http } = sample();
  state.globalBypass = ["10.0.0.0/8", "*.corp.example"];

  const direct = findProfile(state, DIRECT_ID);
  const system = findProfile(state, SYSTEM_ID);
  assert.deepEqual(effectiveBypass(direct, state.globalBypass), []);
  assert.deepEqual(effectiveBypass(system, state.globalBypass), []);
  assert.equal(bypassHasCidr(direct, state.globalBypass), false);
  assert.equal(bypassHasCidr(system, state.globalBypass), false);

  state.activeProfileId = DIRECT_ID;
  assert.deepEqual(buildApplyPlan(state).config, { mode: "direct" });
  assert.equal(resolveTarget(state, "10.0.0.1", 80).profile.builtin, "direct");
  assert.equal(resolveTarget(state, "10.0.0.1", 80).bypassed, false);

  state.activeProfileId = SYSTEM_ID;
  assert.deepEqual(buildApplyPlan(state).config, { mode: "system" });
  assert.equal(resolveTarget(state, "10.0.0.1", 80).profile.builtin, "system");
  assert.equal(resolveTarget(state, "10.0.0.1", 80).bypassed, false);

  // Invalid globalBypass entry blocks fixed proxy and auto switch, but Direct/System remain selectable
  state.globalBypass = ["10.0.0.0/33"];
  assert.match(bypassListError(state.globalBypass, { global: true }), /global bypass entry/i);
  assert.match(bypassListError(state.globalBypass, { global: true }), /0 to 32/);

  state.activeProfileId = DIRECT_ID;
  assert.equal(buildApplyPlan(state).ok, true);
  state.activeProfileId = SYSTEM_ID;
  assert.equal(buildApplyPlan(state).ok, true);

  state.activeProfileId = http.id;
  const fixedFail = buildApplyPlan(state);
  assert.equal(fixedFail.ok, false);
  assert.match(fixedFail.error, /0 to 32/);

  state.activeProfileId = AUTO_ID;
  state.autoSwitch.defaultProfileId = http.id;
  const autoFail = buildApplyPlan(state);
  assert.equal(autoFail.ok, false);
  assert.match(autoFail.error, /0 to 32/);
  assert.throws(() => buildPac(state), /0 to 32/);
});

test("all 6 locale dictionaries are complete, consistent, and produce localized copy and errors", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["en", "zh", "ru", "es", "fr", "ja"]);
  assert.deepEqual(LANGUAGES.map((item) => item.label), [
    "English",
    "中文",
    "Русский",
    "Español",
    "Français",
    "日本語",
  ]);

  const baseKeys = Object.keys(LOCALES.en).sort();
  const placeholderPattern = /\{[a-zA-Z0-9_]+\}/g;
  const richKeys = ["options.bypassHint", "options.globalBypassHint", "options.patternsHint"];

  for (const code of SUPPORTED_LANGUAGES) {
    const dict = LOCALES[code];
    assert.deepEqual(Object.keys(dict).sort(), baseKeys, `key mismatch in ${code}`);
    for (const key of baseKeys) {
      const value = dict[key];
      assert.equal(typeof value, "string", `${code}.${key} is not a string`);
      assert.ok(value.trim().length > 0, `${code}.${key} is empty`);
      const expectedVars = [...new Set(LOCALES.en[key].match(placeholderPattern) || [])].sort();
      const actualVars = [...new Set(value.match(placeholderPattern) || [])].sort();
      assert.deepEqual(actualVars, expectedVars, `placeholder mismatch in ${code}.${key}`);
    }
    for (const richKey of richKeys) {
      const ticks = (dict[richKey].match(/`/g) || []).length;
      assert.equal(ticks % 2, 0, `unbalanced backticks in ${code}.${richKey}`);
    }
  }

  // Built-in names and descriptions translate while profile IDs stay fixed
  const state = createDefaultState();
  for (const code of SUPPORTED_LANGUAGES) {
    state.language = code;
    state.activeProfileId = DIRECT_ID;
    const directDesc = activeDescriptor(state);
    assert.equal(directDesc.id, DIRECT_ID);
    assert.equal(directDesc.name, LOCALES[code]["builtin.directName"]);
    assert.equal(describeProfile(directDesc, code), LOCALES[code]["builtin.directDesc"]);
    assert.equal(actionTitle(directDesc, "", code), `SampleProxy: ${LOCALES[code]["builtin.directName"]}\n${LOCALES[code]["builtin.directDesc"]}`);

    state.activeProfileId = SYSTEM_ID;
    const systemDesc = activeDescriptor(state);
    assert.equal(systemDesc.id, SYSTEM_ID);
    assert.equal(systemDesc.name, LOCALES[code]["builtin.systemName"]);

    state.activeProfileId = AUTO_ID;
    const autoDesc = activeDescriptor(state);
    assert.equal(autoDesc.id, AUTO_ID);
    assert.equal(autoDesc.name, LOCALES[code]["builtin.autoName"]);

    // Non-English locales produce distinct localized built-in names and validation messages
    if (code !== "en") {
      assert.notEqual(profileDisplayName(findProfile(state, DIRECT_ID), code), "Direct");
      assert.notEqual(hostError("", code), hostError("", "en"));
      assert.notEqual(bypassListError(["bad host"], { lang: code, global: true }), bypassListError(["bad host"], { lang: "en", global: true }));
    }
  }

  // Custom profile names are never altered by locale
  const custom = { id: "p_custom0001", name: "My Office", builtin: null, proxy: { scheme: "http", host: "proxy.example", port: 8080 } };
  assert.equal(profileDisplayName(custom, "zh"), "My Office");
  assert.match(actionTitle(custom, "", "ja"), /^SampleProxy: My Office\nHTTP · proxy\.example:8080$/);

  // Pluralization across languages (including Russian 3-form plurals)
  assert.equal(formatRuleCount("en", 0), "0 rules");
  assert.equal(formatRuleCount("en", 1), "1 rule");
  assert.equal(formatRuleCount("en", 2), "2 rules");
  assert.equal(formatRuleCount("zh", 3), "3 条规则");
  assert.equal(formatRuleCount("ja", 3), "3 件のルール");
  assert.equal(formatRuleCount("ru", 1), "1 правило");
  assert.equal(formatRuleCount("ru", 2), "2 правила");
  assert.equal(formatRuleCount("ru", 5), "5 правил");
  assert.equal(formatRuleCount("ru", 21), "21 правило");
  assert.equal(formatRuleCount("ru", 22), "22 правила");
  assert.equal(formatRuleCount("ru", 25), "25 правил");
  assert.equal(formatRuleCount("es", 1), "1 regla");
  assert.equal(formatRuleCount("es", 4), "4 reglas");
  assert.equal(formatRuleCount("fr", 1), "1 règle");
  assert.equal(formatRuleCount("fr", 4), "4 règles");

  // Unknown language falls back to English
  assert.equal(t("unknown-lang", "builtin.directName"), "Direct");
});
