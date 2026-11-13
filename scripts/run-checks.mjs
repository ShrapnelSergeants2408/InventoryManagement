// Runs the browser checks side by side (backlog C4), each in its own headless Chrome on its own
// ports, and prints one summary. All of them in a row took about 25 minutes.
//
//   npm run build && node scripts/run-checks.mjs [--jobs 4] [--chrome <chrome.exe>] [--out <folder>] [name ...]
//
// With names (m3, m25, ...) only those run. m10 changes the built files, so it runs alone after the others and can't disturb a check that is still serving them.
// The two upgrade checks need an older build and a tablet backup as arguments, so they are run by hand.
// Don't rebuild or switch branches while this runs. Output of each check: <out>/<name>.log.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const opt = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv.splice(i, 2)[1];
};
const jobs = Math.max(1, Number(opt('--jobs', '4')) || 4);
const out = resolve(opt('--out', join(tmpdir(), `checks-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`)));
const chrome =
  opt('--chrome', process.env.CHROME) ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!chrome) throw new Error('Chrome not found: pass --chrome <chrome.exe> or set CHROME');
if (!existsSync('dist/index.html')) throw new Error('No build: run npm run build first');
mkdirSync(out, { recursive: true });

/** Rewrites the built files while it runs, so it never shares a build with another check. */
const ALONE = new Set(['m10-ui-check']);
// m19-upgrade-check and m23-helper-upgrade-check are left out: they need an older build and a tablet backup as arguments (see their headers).
const all = readdirSync('scripts')
  .filter((f) => /^m[0-9]+[a-z]?-ui-check[.]mjs$/.test(f))
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const wanted = argv.filter((a) => !a.startsWith('-'));
const names = wanted.length ? all.filter((n) => wanted.some((w) => n === w || n.startsWith(w + '-'))) : all;
if (wanted.length && names.length === 0) throw new Error(`No check matches ${wanted.join(', ')}`);

function runOne(name) {
  return new Promise((done) => {
    const started = Date.now();
    const log = [];
    const child = spawn(process.execPath, [join('scripts', name + '.mjs'), chrome, join(out, name)], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log.push(d));
    child.stderr.on('data', (d) => log.push(d));
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(log).toString('utf8');
      writeFileSync(join(out, name + '.log'), text);
      const lines = text.split(/\r?\n/);
      const pass = lines.filter((l) => l.startsWith('PASS')).length;
      const fails = lines.filter((l) => /^(FAIL|ERROR)/.test(l));
      const clean = /No console errors or warnings/.test(text);
      done({ name, pass, fails, clean, code, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

async function pool(list, size) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, list.length) }, async () => {
      while (next < list.length) {
        const name = list[next++];
        const r = await runOne(name);
        results.push(r);
        console.log(`${r.fails.length || r.code ? 'FAIL' : 'done'}  ${name.padEnd(28)} ${r.pass} pass${r.fails.length ? `, ${r.fails.length} fail` : ''}${r.clean ? '' : ', console problems'}  (${r.seconds}s)`);
      }
    }),
  );
  return results;
}

const t0 = Date.now();
console.log(`${names.length} checks, ${jobs} at a time, Chrome ${chrome}\nOutput: ${out}`);
const results = [...(await pool(names.filter((n) => !ALONE.has(n)), jobs)), ...(await pool(names.filter((n) => ALONE.has(n)), 1))];
results.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
const failed = results.filter((r) => r.fails.length || r.code !== 0 || !r.clean);
console.log(`\n${results.reduce((n, r) => n + r.pass, 0)} checks pass in ${Math.round((Date.now() - t0) / 1000)}s; ${failed.length ? `${failed.length} script(s) need a look:` : 'every script is clean.'}`);
for (const r of failed) {
  console.log(`  ${r.name}: exit ${r.code}${r.clean ? '' : ', console problems'}  (${join(out, r.name + '.log')})`);
  for (const l of r.fails.slice(0, 5)) console.log('    ' + l.slice(0, 240));
}
process.exitCode = failed.length ? 1 : 0;
