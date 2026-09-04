import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const browserPaths = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const chrome = browserPaths.find(fs.existsSync);
assert.ok(chrome, "no headless browser found");

const server = await fetch("http://127.0.0.1:3000").catch(() => null);
assert.ok(server?.ok, "nothing is serving http://127.0.0.1:3000");

const port = 9300 + (process.pid % 300);
const profile = path.resolve(`./.browser-check-${process.pid}`);
const screenshot = "./houscaper-next.png";
fs.rmSync(profile, { recursive: true, force: true });
const browser = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--window-size=1400,900",
  "http://127.0.0.1:3000",
], { stdio: "ignore" });
let browserExit = null;
let resolveBrowserExit;
const browserExited = new Promise((resolve) => (resolveBrowserExit = resolve));
browser.on("exit", (code) => { browserExit = code; resolveBrowserExit(); });
const stopBrowser = () => { if (!browser.killed) browser.kill(); };
process.on("exit", stopBrowser);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let pages;
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    if (pages.some((page) => page.url?.startsWith("http://127.0.0.1:3000") && page.type === "page")) break;
  } catch {}
  await delay(100);
}
assert.ok(pages?.length, `headless browser did not expose a page (pid ${browser.pid}, port ${port}, exit ${browserExit})`);

const page = pages.find(({ url, type }) => url.startsWith("http://127.0.0.1:3000") && type === "page");
assert.ok(page, "headless browser did not open Houscaper");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let commandId = 0;
const pending = new Map();
const errors = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const callback = pending.get(message.id);
    pending.delete(message.id);
    callback(message);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.text);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++commandId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const message = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (message.result.exceptionDetails) {
    throw new Error(`${message.result.exceptionDetails.text}: ${message.result.result.description}`);
  }
  return message.result.result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
const state = await evaluate(`(async () => {
  for (let i = 0; i < 120; i++) {
    const state = window.getHouscaperState?.();
    if (state?.activeFamilyId && state.renderedArchitecturalTiles > 0) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return {
    state: window.getHouscaperState?.() ?? null,
    stats: document.getElementById("stats")?.textContent ?? null,
    familyCount: document.getElementById("tileFamily")?.options?.length ?? -1,
    canvases: document.querySelectorAll("canvas").length,
    url: document.URL,
    title: document.title,
    body: document.body?.innerText?.slice(0, 200) ?? null
  };
})()`);
if (!state.activeFamilyId) console.error({ state, errors });
assert.equal(state.activeFamilyId, "frame-light");
assert.equal(state.architecturalAssets, 25);
assert.ok(state.renderedArchitecturalTiles > 0);

const switched = await evaluate(`(async () => {
  const select = document.getElementById("tileFamily");
  select.value = "frame-structural";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  for (let i = 0; i < 100; i++) {
    const state = window.getHouscaperState();
    if (state.activeFamilyId === "frame-structural") return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("family switch timed out");
})()`);
assert.equal(switched.architecturalAssets, 54);
assert.ok(switched.renderedArchitecturalTiles > 0);

await evaluate(`document.getElementById("tileFamily").value = "frame-light";
document.getElementById("tileFamily").dispatchEvent(new Event("change", { bubbles: true }));`);
await delay(700);
const image = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(screenshot, Buffer.from(image.result.data, "base64"));

socket.close();
stopBrowser();
if (browserExit === null) await browserExited;
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
assert.deepEqual(errors, []);
console.log(`ok — browser loaded and switched isolated families (${screenshot})`);