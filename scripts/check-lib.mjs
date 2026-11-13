// Shared start-up for the browser checks (backlog C4): the preview server, headless Chrome, the
// DevTools connection and the PASS/FAIL bookkeeping, so a check holds only what it tests.
// A check keeps its own in-page helpers (`prelude`) because they differ from check to check.
//
//   const t = await startCheck({ previewPort: 4364, cdpPort: 9394, prelude: () => H + EDIT });
//   const { js, waitFor, check, shot, size, send, sleep } = t;
//   try { ... } catch (e) { await t.fail(e); } finally { await t.finish(); }
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, track } from './tmp-cleanup.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * previewPort, cdpPort: this check's own ports (every check has its own, so checks can run side by side).
 * prelude: a function giving the JS put before every `js(...)` call (the in-page helpers).
 * chromeArgs: extra Chrome switches. argv: [chrome.exe, screenshot folder].
 */
export async function startCheck({ previewPort, cdpPort, prelude = () => '', chromeArgs = [], argv = process.argv.slice(2) }) {
  const [chrome, outDir] = argv;
  if (!chrome || !outDir) throw new Error('Usage: node <check>.mjs <chrome.exe> <screenshot dir>');
  mkdirSync(outDir, { recursive: true });
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(previewPort), '--strictPort'], { stdio: 'ignore' });
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${tempDir('cdp-')}`, ...chromeArgs, 'about:blank'], { stdio: 'ignore' });
  track(proc);

  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) problems.push(`console.${d.params.type}: ` + JSON.stringify(d.params.args).slice(0, 400));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${prelude()} ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const waitFor = async (cond, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await js(`return !!(${cond})`)) return; await sleep(150); }
    throw new Error('timeout waiting for ' + cond);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const results = [];
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  };
  /** A script error counts as a failure, with a screenshot of where it stopped. */
  const fail = async (e) => {
    results.push('FAIL  script error: ' + e.message);
    await shot('zz-error').catch(() => {});
  };
  /** Prints the results and the console problems, sets the exit code, closes everything. */
  const finish = async () => {
    console.log(results.join('\n'));
    process.exitCode = results.some((r) => /^(FAIL|ERROR)/.test(r)) ? 1 : 0;
    console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
    ws.close();
    proc.kill();
    preview.kill();
  };
  return { send, js, waitFor, shot, size, check, fail, finish, sleep, results, problems, outDir, port: cdpPort, previewPort };
}
