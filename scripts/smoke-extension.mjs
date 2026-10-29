// Optional browser check for Chrome for Testing at /tmp/chrome-linux64/chrome.
// Branded Chrome ignores --load-extension. `node --test` does not run this file.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = 9333;
const profileDir = "/tmp/sampleproxy-chrome-profile";
const shotDir = "/tmp/sampleproxy-shots";
const artifactDir = "/opt/cursor/artifacts/screenshots";
fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(shotDir, { recursive: true });
fs.mkdirSync(artifactDir, { recursive: true });

const chrome = spawn("xvfb-run", [
  "-a",
  "-s", "-screen 0 1280x900x24",
  "/tmp/chrome-linux64/chrome",
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${port}`,
  "--remote-allow-origins=*",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-features=DisableLoadExtensionCommandLineSwitch",
  `--disable-extensions-except=/workspace/extension`,
  "--load-extension=/workspace/extension",
  "--window-size=1280,900",
  "about:blank",
], { detached: true, stdio: ["ignore", "pipe", "pipe"] });

let log = "";
chrome.stdout.on("data", (chunk) => { log += chunk; });
chrome.stderr.on("data", (chunk) => { log += chunk; });

const failures = [];
try {
  const worker = await waitForExtension();
  const extensionId = worker.id;
  const root = `chrome-extension://${extensionId}`;
  const workerErrors = [];
  worker.client.on((message) => {
    if (message.method === "Runtime.exceptionThrown") workerErrors.push(message.params.exceptionDetails);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      workerErrors.push(message.params.args?.map((arg) => arg.value || arg.description).join(" "));
    }
  });

  await waitFor(worker.client, `chrome.proxy.settings.get({}).then((details) => details.value.mode === "direct" ? "direct" : "")`);
  const badge = await evaluate(worker.client, `chrome.action.getBadgeText({})`);
  expect(badge === "OFF", `initial badge was ${badge}`);

  const probe = await evaluate(worker.client, `(async () => {
    await chrome.storage.local.set({ probe: { builtin: null, port: null } });
    const stored = await chrome.storage.local.get("probe");
    await chrome.storage.local.remove("probe");
    return stored.probe;
  })()`);
  expect(probe && probe.builtin === null && probe.port === null, `null storage round-trip failed: ${JSON.stringify(probe)}`);

  const popup = await openPage(`${root}/popup/popup.html`);
  await waitFor(popup.client, `document.querySelector("#current-name")?.textContent === "Direct" && document.querySelector(".profile") ? "ready" : ""`);
  await shot(popup.client, "popup-direct", 340, 560);

  await evaluate(popup.client, `document.querySelector("#add-proxy").click()`);
  await waitFor(popup.client, `document.querySelector("#editor") && !document.querySelector("#editor").hidden ? "ready" : ""`);
  const blank = await evaluate(popup.client, `({
    title: document.querySelector("#editor-title").textContent,
    scheme: document.querySelector("#scheme").value,
    host: document.querySelector("#host").value,
    port: document.querySelector("#port").value,
    usernameDisabled: document.querySelector("#username").disabled,
    passwordDisabled: document.querySelector("#password").disabled,
    builtInRows: [...document.querySelectorAll(".profile-line .name")].map((node) => node.textContent),
  })`);
  expect(blank.title === "New proxy" && blank.scheme === "socks5" && blank.host === "127.0.0.1" && blank.port === "1080",
    `new popup draft was ${JSON.stringify(blank)}`);
  expect(blank.usernameDisabled === true && blank.passwordDisabled === true, "SOCKS auth fields were enabled");
  expect(blank.builtInRows.length === 0, `built-in profiles were editable: ${blank.builtInRows.join(",")}`);
  await evaluate(popup.client, `(() => {
    document.querySelector("#host").value = "bad host";
    document.querySelector("#editor").requestSubmit();
  })()`);
  await waitFor(popup.client, `document.querySelector("#host-error")?.textContent ? "ready" : ""`);
  const rejected = await evaluate(popup.client, `!document.querySelector("#editor").hidden && document.querySelector("#host").getAttribute("aria-invalid") === "true"`);
  expect(rejected === true, "invalid host was accepted");
  await evaluate(popup.client, `(() => {
    const scheme = document.querySelector("#scheme");
    scheme.value = "http";
    scheme.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const httpAuth = await evaluate(popup.client, `document.querySelector("#username").disabled === false && document.querySelector("#password").disabled === false`);
  expect(httpAuth === true, "HTTP auth fields stayed disabled");
  await evaluate(popup.client, `document.querySelector("#cancel-edit").click()`);
  await waitFor(popup.client, `document.querySelector("#editor").hidden && !document.querySelector("#add-proxy").hidden ? "ready" : ""`);
  const userCount = await evaluate(worker.client, `chrome.storage.local.get("profiles").then((value) => (value.profiles || []).filter((profile) => !profile.builtin).length)`);
  expect(userCount === 0, `cancel persisted ${userCount} profiles`);

  const options = await openPage(`${root}/options/options.html`);
  await waitFor(options.client, `document.querySelector("#profile-list button") ? "ready" : ""`);
  await evaluate(options.client, `document.querySelector("#add-profile").click()`);
  await sleep(300);
  const created = await evaluate(options.client, `({
    scheme: document.querySelector("#scheme").value,
    host: document.querySelector("#host").value,
    port: document.querySelector("#port").value,
    fixedHidden: document.querySelector("#fixed-fields").hidden
  })`);
  expect(created.scheme === "socks5" && created.host === "127.0.0.1" && created.port === "1080" && created.fixedHidden === false,
    `new profile form was ${JSON.stringify(created)}`);

  await evaluate(options.client, `(() => {
    const host = document.querySelector("#host");
    const port = document.querySelector("#port");
    const password = document.querySelector("#password");
    host.value = "10.1.2.3";
    port.value = "9050";
    password.value = "super-secret-proxy";
    host.dispatchEvent(new Event("input", { bubbles: true }));
    port.dispatchEvent(new Event("input", { bubbles: true }));
    password.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#add-rule").click();
    const pattern = document.querySelector("#rules input");
    pattern.value = "*.example.com";
    pattern.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(700);
  await evaluate(options.client, `document.querySelector("#use-profile").click()`);
  await sleep(700);
  const fixed = await proxyValue(worker.client);
  expect(fixed.mode === "fixed_servers", `fixed mode was ${fixed.mode}`);
  expect(fixed.rules?.singleProxy?.scheme === "socks5", `scheme was ${fixed.rules?.singleProxy?.scheme}`);
  expect(fixed.rules?.singleProxy?.host === "10.1.2.3", `host was ${fixed.rules?.singleProxy?.host}`);
  expect(fixed.rules?.singleProxy?.port === 9050, `port was ${fixed.rules?.singleProxy?.port}`);
  expect(!JSON.stringify(fixed).includes("super-secret-proxy"), "proxy config included a password");
  const stored = await evaluate(worker.client, `chrome.storage.local.get(null).then((value) => JSON.stringify(value))`);
  expect(stored.includes("super-secret-proxy"), "password was not saved locally");
  const socksBadge = await evaluate(worker.client, `chrome.action.getBadgeText({})`);
  expect(socksBadge === "ON", `SOCKS badge was ${socksBadge}`);

  await evaluate(options.client, `document.querySelector("#use-auto").click()`);
  await sleep(700);
  const auto = await proxyValue(worker.client);
  expect(auto.mode === "pac_script", `auto mode was ${auto.mode}`);
  const pac = auto.pacScript?.data || "";
  expect(pac.includes("*.example.com"), "PAC omitted the rule");
  expect(pac.includes("SOCKS5 10.1.2.3:9050"), "PAC omitted the SOCKS profile");
  expect(!pac.includes("super-secret-proxy"), "PAC included a password");
  const autoBadge = await evaluate(worker.client, `chrome.action.getBadgeText({})`);
  expect(autoBadge === "ON", `auto badge was ${autoBadge}`);
  await shot(options.client, "options", 1100, 980);

  await evaluate(popup.client, `location.reload()`);
  await waitFor(popup.client, `[...document.querySelectorAll(".name")].some((node) => node.textContent === "Direct") ? "ready" : ""`);
  await evaluate(popup.client, `[...document.querySelectorAll(".profile")].find((button) => button.querySelector(".name")?.textContent === "Direct").click()`);
  await sleep(500);
  const direct = await evaluate(worker.client, `chrome.proxy.settings.get({}).then((details) => details.value.mode)`);
  expect(direct === "direct", `direct mode was ${direct}`);
  const offBadge = await evaluate(worker.client, `chrome.action.getBadgeText({})`);
  expect(offBadge === "OFF", `direct badge was ${offBadge}`);
  await shot(popup.client, "popup-direct-after", 340, 560);

  await evaluate(popup.client, `document.querySelector("#add-proxy").click()`);
  await waitFor(popup.client, `document.querySelector("#editor-title")?.textContent === "New proxy" ? "ready" : ""`);
  await evaluate(popup.client, `(() => {
    const name = document.querySelector("#name");
    const scheme = document.querySelector("#scheme");
    const host = document.querySelector("#host");
    const port = document.querySelector("#port");
    const username = document.querySelector("#username");
    const password = document.querySelector("#password");
    name.value = "Popup proxy";
    scheme.value = "http";
    scheme.dispatchEvent(new Event("change", { bubbles: true }));
    host.value = "proxy.popup.test";
    port.value = "8888";
    username.value = "popup-user";
    password.value = "popup-secret";
    document.querySelector("#bypass").value = "example.org, *.bypass.test";
  })()`);
  await evaluate(popup.client, `document.querySelector("#save-profile").click()`, false);
  await waitFor(popup.client, `document.querySelector("#editor").hidden && [...document.querySelectorAll(".name")].some((node) => node.textContent === "Popup proxy") ? "ready" : ""`);
  const inactive = await evaluate(popup.client, `document.querySelector("#current-name").textContent`);
  expect(inactive === "Direct", `saving a profile switched to ${inactive}`);
  await evaluate(popup.client, `[...document.querySelectorAll(".profile")].find((button) => button.querySelector(".name")?.textContent === "Popup proxy").click()`);
  await sleep(700);
  const fromPopup = await proxyValue(worker.client);
  expect(fromPopup.mode === "fixed_servers", `popup profile mode was ${fromPopup.mode}`);
  expect(fromPopup.rules?.singleProxy?.scheme === "http", `popup scheme was ${fromPopup.rules?.singleProxy?.scheme}`);
  expect(fromPopup.rules?.singleProxy?.host === "proxy.popup.test", `popup host was ${fromPopup.rules?.singleProxy?.host}`);
  expect(fromPopup.rules?.singleProxy?.port === 8888, `popup port was ${fromPopup.rules?.singleProxy?.port}`);
  expect(fromPopup.rules?.bypassList?.includes("example.org"), `bypass list was ${JSON.stringify(fromPopup.rules?.bypassList)}`);
  expect(fromPopup.rules?.bypassList?.includes("*.bypass.test"), `wildcard bypass missing from ${JSON.stringify(fromPopup.rules?.bypassList)}`);
  expect(!JSON.stringify(fromPopup).includes("popup-secret"), "popup proxy config included a password");
  const popupStored = await evaluate(worker.client, `chrome.storage.local.get(null).then((value) => JSON.stringify(value))`);
  expect(popupStored.includes("popup-secret"), "popup password was not saved locally");
  expect(popupStored.includes("popup-user"), "popup username was not saved locally");

  await evaluate(popup.client, `[...document.querySelectorAll(".profile-line")].find((row) => row.querySelector(".name")?.textContent === "Popup proxy").querySelector(".edit-profile").click()`);
  await waitFor(popup.client, `document.querySelector("#editor-title")?.textContent === "Edit proxy" && document.querySelector("#port").value === "8888" ? "ready" : ""`);
  await evaluate(popup.client, `(() => {
    const port = document.querySelector("#port");
    port.value = "8889";
    document.querySelector("#save-profile").click();
  })()`, false);
  await waitFor(popup.client, `document.querySelector("#current-detail")?.textContent.includes("8889") ? "ready" : ""`);
  await sleep(700);
  const edited = await proxyValue(worker.client);
  expect(edited.rules?.singleProxy?.port === 8889, `edited port was ${edited.rules?.singleProxy?.port}`);
  expect(edited.rules?.singleProxy?.host === "proxy.popup.test", `edited host was ${edited.rules?.singleProxy?.host}`);
  expect(edited.rules?.bypassList?.includes("example.org"), `edit dropped the bypass list: ${JSON.stringify(edited.rules?.bypassList)}`);
  const httpBadge = await evaluate(worker.client, `chrome.action.getBadgeText({})`);
  expect(httpBadge === "ON", `HTTP badge was ${httpBadge}`);
  const title = await evaluate(worker.client, `chrome.action.getTitle({})`);
  expect(title.includes("Popup proxy"), `tooltip missed the profile name: ${title}`);
  expect(title.includes("proxy.popup.test:8889"), `tooltip missed the server: ${title}`);

  await evaluate(popup.client, `[...document.querySelectorAll(".profile-line")].find((row) => row.querySelector(".name")?.textContent === "Popup proxy").querySelector(".edit-profile").click()`);
  await waitFor(popup.client, `document.querySelector("#editor-title")?.textContent === "Edit proxy" ? "ready" : ""`);
  await evaluate(popup.client, `(() => {
    const bypass = document.querySelector("#bypass");
    bypass.value = bypass.value.replace(/\\s*$/, "") + "\\n10.0.0.0/8\\n2001:db8::/32";
    document.querySelector("#save-profile").click();
  })()`, false);
  await waitFor(popup.client, `document.querySelector("#editor").hidden ? "ready" : ""`);
  await sleep(700);
  const cidrProxy = await proxyValue(worker.client);
  expect(cidrProxy.mode === "pac_script", `CIDR proxy mode was ${cidrProxy.mode}`);
  const cidrPac = cidrProxy.pacScript?.data || "";
  expect(cidrPac.includes("isInNetEx"), "PAC did not match CIDR with isInNetEx");
  expect(cidrPac.includes("10.0.0.0/8"), "PAC omitted the IPv4 CIDR");
  expect(cidrPac.includes("2001:db8::/32"), "PAC omitted the IPv6 CIDR");
  expect(cidrPac.includes("example.org"), "PAC omitted the hostname bypass");
  expect(!cidrPac.includes("popup-secret"), "CIDR PAC included a password");
  const lines = await evaluate(popup.client, `[...document.querySelectorAll(".profile-line .name")].map((node) => node.textContent)`);
  expect(!lines.includes("Direct") && !lines.includes("System") && !lines.includes("Auto switch"),
    `built-in rows became editable: ${lines.join(",")}`);

  await evaluate(options.client, `location.reload()`);
  await waitFor(options.client, `[...document.querySelectorAll(".row-name")].some((node) => node.textContent === "Popup proxy") ? "ready" : ""`);
  const optionsBypass = await evaluate(options.client, `document.querySelector("#bypass").value`);
  expect(optionsBypass.includes("example.org") && optionsBypass.includes("*.bypass.test") && optionsBypass.includes("10.0.0.0/8"), `options bypass was ${optionsBypass}`);

  await sleep(300);
  expect(workerErrors.length === 0, `service worker errors: ${JSON.stringify(workerErrors)}`);
  popup.ws.close();
  options.ws.close();
  worker.ws.close();
} catch (error) {
  failures.push(error?.stack || String(error));
} finally {
  try { process.kill(-chrome.pid, "SIGKILL"); } catch { /* already gone */ }
}

if (failures.length) {
  fs.writeFileSync("/tmp/sampleproxy-chrome.log", log);
  console.error(failures.join("\n\n"));
  console.error(log.slice(-4000));
  process.exit(1);
}
console.log("Chrome smoke passed");

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForExtension() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const targets = await list();
      for (const target of targets) {
        if (target.type !== "service_worker" || !target.url.includes("/background.js")) continue;
        const connection = await connect(target);
        try {
          const name = await evaluate(connection.client, `chrome.runtime?.getManifest?.().name || ""`);
          if (name === "SampleProxy") {
            connection.id = target.url.split("/")[2];
            return connection;
          }
        } catch { /* another extension's worker */ }
        connection.ws.close();
      }
    } catch { /* debugger not up yet */ }
    await sleep(200);
  }
  throw new Error(`extension service worker did not start\n${log.slice(-4000)}`);
}

async function list() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`debugger list ${response.status}`);
  return response.json();
}

async function openPage(url) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  const browserWs = new WebSocket(version.webSocketDebuggerUrl);
  await opened(browserWs);
  const browser = cdp(browserWs);
  const created = await browser.send("Target.createTarget", { url });
  browserWs.close();
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const target = (await list()).find((item) => item.id === created.targetId && item.webSocketDebuggerUrl);
    if (target) {
      const page = await connect(target);
      await page.client.send("Page.enable");
      await evaluate(page.client, `document.readyState`);
      return page;
    }
    await sleep(100);
  }
  throw new Error(`page did not open: ${url}`);
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await opened(ws);
  const client = cdp(ws);
  await client.send("Runtime.enable");
  return { ws, client };
}

async function proxyValue(client) {
  return evaluate(client, `chrome.proxy.settings.get({}).then((details) => details.value)`);
}

async function shot(client, name, width, height) {
  const metrics = await evaluate(client, `({
    width: Math.max(document.documentElement.scrollWidth, ${width}),
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  })`);
  const capture = client.send("Page.captureScreenshot", {
    format: "png",
    clip: {
      x: 0,
      y: 0,
      width: Math.min(metrics.width, width),
      height: Math.min(metrics.height, height),
      scale: 1,
    },
  });
  const { data } = await Promise.race([
    capture,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`screenshot timed out: ${name}`)), 10000)),
  ]);
  const buffer = Buffer.from(data, "base64");
  fs.writeFileSync(path.join(shotDir, `${name}.png`), buffer);
  fs.writeFileSync(path.join(artifactDir, `${name}.png`), buffer);
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  return {
    send(method, params = {}) {
      const messageId = ++id;
      ws.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    on(listener) { listeners.push(listener); },
  };
}

function opened(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

function evaluate(client, expression, awaitPromise = true) {
  const call = client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }).then((result) => {
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`evaluate timed out: ${expression.slice(0, 160)}`)), 15000);
  });
  return Promise.race([call, timeout]);
}

async function waitFor(client, expression) {
  const started = Date.now();
  let last;
  while (Date.now() - started < 8000) {
    try {
      last = await evaluate(client, expression);
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${expression}; last=${last}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
