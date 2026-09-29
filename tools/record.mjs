// Records the game with the DevTools screencast: node tools/record.mjs <query> <width>x<height> <ms> <out-dir>
// Writes numbered JPEG frames plus frames.json (timestamps) for tools/make_gif.py.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [query = "", size = "405x720", ms = "8000", outDir = "frames"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const url = query.startsWith("http") ? query : `file://${resolve(import.meta.dirname, "../index.html")}${query ? `?${query}` : ""}`;
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--hide-scrollbars", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ct-rec-"))}`, `--window-size=${width},${height}`, "about:blank",
], { stdio: "ignore" });
const sleep = (t) => new Promise((r) => setTimeout(r, t));
mkdirSync(outDir, { recursive: true });

try {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); }
    catch { await sleep(200); }
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const pending = new Map(), frames = [];
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    if (m.method === "Page.screencastFrame") {
      const n = frames.length;
      writeFileSync(join(outDir, `f${String(n).padStart(4, "0")}.jpg`), Buffer.from(m.params.data, "base64"));
      frames.push(m.params.metadata.timestamp);
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
    }
    if (m.method === "Runtime.exceptionThrown") console.log("EXCEPTION", m.params.exceptionDetails.exception?.description);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url });
  await sleep(700);                                   // let the page load before recording
  await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: width * 2, maxHeight: height * 2, everyNthFrame: 1 });
  await sleep(Number(ms));
  await send("Page.stopScreencast");
  writeFileSync(join(outDir, "frames.json"), JSON.stringify(frames));
  console.log(`${frames.length} frames over ${(frames.at(-1) - frames[0]).toFixed(1)} s`);
  ws.close();
} finally {
  chrome.kill();
}
