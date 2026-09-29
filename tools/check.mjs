// Real-time headless check over the DevTools protocol (no server; file:// like a player double-clicking index.html).
// node tools/check.mjs <query> <width>x<height> <waitMs> <out.png> [js expression]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [query = "", size = "540x960", wait = "3000", out = "shot.png", exprArg = "", evalOut = ""] = process.argv.slice(2);
const expr = exprArg.startsWith("@") ? readFileSync(exprArg.slice(1), "utf8") : exprArg;   // @file.js evaluates a file
const [width, height] = size.split("x").map(Number);
const url = `file://${resolve(import.meta.dirname, "../index.html")}${query ? `?${query}` : ""}`;
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--hide-scrollbars", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "ct-"))}`, `--window-size=${width},${height}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); }
    catch { await sleep(200); }
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") console.log("EXCEPTION", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) console.log(m.params.type.toUpperCase(), m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") console.log("LOG", m.params.entry.text, m.params.entry.url ?? "");
  };
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url });
  await sleep(Number(wait));
  if (expr) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    const value = r.result.result?.value ?? r.result;
    if (evalOut) { writeFileSync(evalOut, String(value)); console.log("EVAL saved", evalOut, String(value).length, "chars"); }
    else console.log("EVAL", JSON.stringify(value));
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("saved", out);
  ws.close();
} finally {
  chrome.kill();
}
