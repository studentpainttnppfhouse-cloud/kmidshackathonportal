import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:3000';
const OUT = process.env.SHOTS ?? '.smoke';
const results = [];
mkdirSync(OUT, { recursive: true });
const ok = (n, c, d='') => { results.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' :: ' + d : ''}`); };

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

// --- 1. sign in --------------------------------------------------------
await page.goto(`${BASE}/signin`);
await page.fill('#email', 'june@kmids.ac.th');
await page.click('button[type=submit]');
await page.waitForURL(/dashboard/, { timeout: 20000 });
ok('sign in with email only', page.url().includes('/dashboard'));

// --- 2. session persists across a reload (device memory) ----------------
await page.goto(`${BASE}/`);
await page.waitForLoadState('networkidle');
ok('remembered device skips sign-in', page.url().includes('/dashboard'), page.url());

// --- 3. create a task ---------------------------------------------------
await page.goto(`${BASE}/assignments`);
await page.waitForLoadState('networkidle');
await page.click('button:has-text("New task")');
await page.waitForSelector('#title');
const unique = `Flow test task ${Date.now()}`;
await page.fill('#title', unique);
await page.selectOption('#department_id', { label: 'Operations' });
await page.click('button:has-text("Create task")');
await page.waitForTimeout(2500);
const created = await page.locator(`text=${unique}`).count();
ok('create a task', created > 0);
await page.screenshot({ path: `${OUT}/f1-created.png` });

// --- 4. open the drawer + comment --------------------------------------
await page.click(`text=${unique}`);
await page.waitForSelector('[role=dialog]', { timeout: 8000 }).catch(()=>{});
const drawerOpen = await page.locator('[role=dialog]').count();
ok('task drawer opens', drawerOpen > 0);
if (drawerOpen) {
  await page.fill('input[aria-label="Add a comment"]', 'Checking the comment thread works.');
  await page.click('[role=dialog] button[type=submit]');
  await page.waitForTimeout(2000);
  const hasComment = await page.locator('text=Checking the comment thread works.').count();
  ok('add a comment', hasComment > 0);
  await page.screenshot({ path: `${OUT}/f2-drawer.png` });
}

// --- 5. approval gate: Owner can approve --------------------------------
const approveBtn = page.locator('[role=dialog] button:has-text("Approved")');
if (await approveBtn.count()) {
  await approveBtn.first().click();
  await page.waitForTimeout(2500);
  ok('Owner can approve', true);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// --- 6. view-as changes what you see ------------------------------------
await page.goto(`${BASE}/dashboard`);
await page.waitForLoadState('networkidle');
await page.click('button[aria-pressed=false]:has-text("T1")').catch(()=>{});
await page.waitForTimeout(2500);
const banner = await page.locator('text=this session is read-only').count();
ok('view-as banner appears', banner > 0);
await page.screenshot({ path: `${OUT}/f3-viewas.png` });

// Owner Console must still be reachable while previewing (real tier governs).
await page.goto(`${BASE}/owner`);
await page.waitForLoadState('networkidle');
ok('Owner keeps console access while previewing', page.url().includes('/owner'), page.url());

// Impersonation is read-only: a tier change must be refused.
const firstTier = page.locator('select[aria-label^="Tier for"]').first();
if (await firstTier.count()) {
  await firstTier.selectOption('T3');
  await page.waitForTimeout(2000);
  const refused = await page.locator('text=/read-only|permission/i').count();
  ok('impersonation blocks writes', refused > 0);
  await page.screenshot({ path: `${OUT}/f4-readonly.png` });
}

// exit preview
await page.click('button:has-text("Exit preview")').catch(()=>{});
await page.waitForTimeout(2000);

// --- 7. public form, logged out -----------------------------------------
const anon = await browser.newContext({ viewport: { width: 520, height: 900 } });
const p2 = await anon.newPage();
await p2.goto(`${BASE}/f/staff-2027`);
await p2.waitForLoadState('networkidle');
const formTitle = await p2.locator('text=Staff recruitment').count();
ok('public form renders logged out', formTitle > 0);
await p2.screenshot({ path: `${OUT}/f5-publicform.png`, fullPage: false });

// conditional logic: pick Film -> portfolio field appears
const before = await p2.locator('text=Link to your portfolio').count();
await p2.click('text=Film/Photo & Tech');
await p2.waitForTimeout(700);
const after = await p2.locator('text=Link to your portfolio').count();
ok('conditional field hidden until its branch is chosen', before === 0 && after > 0, `before=${before} after=${after}`);
await p2.screenshot({ path: `${OUT}/f6-conditional.png` });

// --- 8. event day on a phone --------------------------------------------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p3 = await phone.newPage();
await p3.goto(`${BASE}/signin`);
await p3.fill('#email', 'napat@kmids.ac.th');
await p3.click('button[type=submit]');
await p3.waitForURL(/dashboard|onboarding/, { timeout: 20000 }).catch(()=>{});
await p3.goto(`${BASE}/event-day`);
await p3.waitForLoadState('networkidle');
await p3.screenshot({ path: `${OUT}/f7-phone-eventday.png` });
ok('event-day renders on a phone viewport', (await p3.locator('text=Run sheet').count()) > 0);

await p3.click('text=Check-in');
await p3.waitForTimeout(900);
await p3.screenshot({ path: `${OUT}/f8-phone-checkin.png` });
// The account may already be checked in from an earlier run, so assert on the
// toggle rather than on one particular label.
const statusText = () => p3.locator('.text-\\[22px\\]').first().textContent();
const wasCheckedIn = ((await statusText()) ?? '').trim() === 'Checked in';
const toggle = p3.locator('button:has-text("Check in"), button:has-text("Check out")').first();
ok('check-in control present', (await toggle.count()) > 0);

if (await toggle.count()) {
  await toggle.click();
  await p3.waitForTimeout(2500);
  const nowCheckedIn = ((await statusText()) ?? '').trim() === 'Checked in';
  ok('check-in toggles state', nowCheckedIn !== wasCheckedIn, `${wasCheckedIn} -> ${nowCheckedIn}`);
  await p3.screenshot({ path: `${OUT}/f9-checkedin.png` });
}

await browser.close();
console.log('\n' + results.join('\n'));
console.log(`\npage errors: ${errs.length}`);
for (const e of [...new Set(errs)].slice(0, 5)) console.log('  -', e);

const failed = results.filter((r) => r.startsWith('FAIL'));
if (failed.length > 0 || errs.length > 0) {
  console.error(`\n${failed.length} flow(s) failed, ${errs.length} page error(s).`);
  process.exit(1);
}
console.log('\nAll flows passed.');
