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
  expect(badge === "DIR", `initial badge was ${badge}`);

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
  expect(socksBadge === "SOCK", `SOCKS badge was ${socksBadge}`);

  await evaluate(options.client, `document.querySelector("#use-auto").click()`);
  await sleep(700);
  const auto = await proxyValue(worker.client);
  expect(auto.mode === "pac_script", `auto mode was ${auto.mode}`);
  const pac = auto.pacScript?.data || "";
  expect(pac.includes("*.example.com"), "PAC omitted the rule");
  expect(pac.includes("SOCKS5 10.1.2.3:9050"), "PAC omitted the SOCKS profile");
  expect(!pac.includes("super-secret-proxy"), "PAC included a password");
  const autoBadge = await evaluate(worker.client, `chrome.action.getBadgeText({})`);
  expect(autoBadge === "AUTO", `auto badge was ${autoBadge}`);
  await shot(options.client, "options", 1100, 980);

  await evaluate(popup.client, `location.reload()`);
  await waitFor(popup.client, `[...document.querySelectorAll(".name")].some((node) => node.textContent === "Direct") ? "ready" : ""`);
  await evaluate(popup.client, `[...document.querySelectorAll(".profile")].find((button) => button.querySelector(".name")?.textContent === "Direct").click()`);
  await sleep(500);
  const direct = await evaluate(worker.client, `chrome.proxy.settings.get({}).then((details) => details.value.mode)`);
  expect(direct === "direct", `direct mode was ${direct}`);
  await shot(popup.client, "popup-direct-after", 340, 560);

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
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: Math.min(metrics.width, width),
      height: Math.min(metrics.height, height),
      scale: 1,
    },
  });
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

function evaluate(client, expression) {
  return client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).then((result) => {
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  });
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
