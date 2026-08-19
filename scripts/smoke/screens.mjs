import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000';
const OUT = process.env.SHOTS ?? '.smoke';
const errors = [];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();

page.on('pageerror', (e) => errors.push(`PAGEERROR ${page.url()} :: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE ${page.url()} :: ${m.text().slice(0, 200)}`);
});
page.on('response', (r) => {
  if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
});

async function shot(name) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  shot: ${name}`);
}

// --- sign in as the Owner -------------------------------------------------
console.log('signing in…');
await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle' });
await shot('01-signin');
await page.fill('#email', 'june@kmids.ac.th');
await page.click('button[type=submit]');
await page.waitForURL(/dashboard|onboarding/, { timeout: 25000 }).catch(() => {});
console.log('  landed on', page.url());

const screens = [
  ['dashboard', '02-dashboard'],
  ['people', '03-people'],
  ['workspace', '04-workspace'],
  ['assignments', '05-assignments'],
  ['documents', '06-documents'],
  ['spreadsheets', '07-spreadsheets'],
  ['files', '08-files'],
  ['forms', '09-forms'],
  ['social', '10-social'],
  ['event-day', '11-eventday'],
  ['owner', '12-owner'],
  ['kit', '13-kit'],
  ['settings', '14-settings'],
];

for (const [path, name] of screens) {
  process.stdout.write(`visiting /${path}`);
  const res = await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle', timeout: 30000 })
    .catch((e) => { errors.push(`NAV /${path} :: ${e.message}`); return null; });
  console.log(res ? ` -> ${res.status()}` : ' -> FAILED');
  const body = await page.textContent('body').catch(() => '');
  if (/Application error|Unhandled Runtime Error|missing required error/i.test(body ?? '')) {
    errors.push(`RENDER /${path} :: error boundary shown`);
  }
  await shot(name);
}

await browser.close();

console.log(`\n=== ${errors.length} problem(s) ===`);
for (const e of [...new Set(errors)].slice(0, 40)) console.log(' -', e);
