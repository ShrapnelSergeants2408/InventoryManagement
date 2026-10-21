// Usage: node cdp-check.mjs <chrome.exe> <url> <selector> [timeoutMs]
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [chrome, url, selector, timeout = '60000'] = process.argv.slice(2);
const port = 9333;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, url], { stdio: 'ignore' });
track(proc);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled' || d.method === 'Runtime.exceptionThrown') logs.push(JSON.stringify(d.params).slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
const deadline = Date.now() + Number(timeout);
let text = null;
while (Date.now() < deadline) {
  const r = await send('Runtime.evaluate', { expression: `(() => { const e = document.querySelector(${JSON.stringify(selector)}) || document.querySelector('[role=alert]'); return e ? e.innerText : null; })()`, returnByValue: true });
  text = r.result?.result?.value ?? null;
  if (text) break;
  await sleep(500);
}
console.log(text ?? 'TIMEOUT: selector not found');
if (logs.length) console.log('console:', logs.join('\n'));
ws.close(); proc.kill();
process.exit(0);
