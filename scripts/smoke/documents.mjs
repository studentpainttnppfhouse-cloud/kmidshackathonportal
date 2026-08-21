import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE='http://127.0.0.1:3000';
const OUT=process.env.SHOTS ?? '.smoke';
mkdirSync(OUT, { recursive: true });
const errs=[]; const res=[];
const ok=(n,c,d='')=>res.push(`${c?'PASS':'FAIL'}  ${n}${d?' :: '+d:''}`);
const browser=await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const ctx=await browser.newContext({viewport:{width:1400,height:950}});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{ if(m.type()==='error' && !/ERR_CONNECTION_RESET|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,160)); });

await page.goto(`${BASE}/signin`);
await page.fill('#email','mint@kmids.ac.th');
await page.click('button[type=submit]');
await page.waitForURL(/dashboard/,{timeout:20000});

await page.goto(`${BASE}/documents`);
await page.waitForLoadState('networkidle');
ok('document library lists seeded docs',(await page.locator('text=Judging rubric v3').count())>0);
await page.screenshot({path:`${OUT}/d1-library.png`});

await page.click('text=Judging rubric v3');
// Not `networkidle`: the editor polls the collaboration relay for as long as
// it is open, so the network on this route never goes idle. Wait for the
// editor surface itself, which is the thing being asserted anyway.
await page.waitForLoadState('domcontentloaded');
await page.waitForSelector('.tiptap', { timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(1500);
ok('editor opens',(await page.locator('.tiptap').count())>0);

const body = await page.textContent('.tiptap').catch(()=> '');
ok('editor loaded the stored content', /Clinical impact/.test(body ?? ''), (body ?? '').slice(0,60));
// Locally, collaboration is skipped entirely (no websocket server), so the
// indicator is absent. What must never happen is being stuck on "Connecting".
ok('not stuck connecting',(await page.locator('text=Connecting…').count())===0);
await page.screenshot({path:`${OUT}/d2-editor.png`});

// type and confirm autosave still runs in the fallback path
await page.click('.tiptap p >> nth=0');
await page.keyboard.press('End');
await page.keyboard.type(' Reviewed by Mint.');
await page.waitForTimeout(4000);
ok('autosave reports saved',(await page.locator('text=All changes saved').count())>0);
await page.screenshot({path:`${OUT}/d3-saved.png`});

// reload and confirm it persisted
// Again, not `networkidle` — see above.
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForSelector('.tiptap', { timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(2000);
const after = await page.textContent('.tiptap').catch(()=> '');
ok('edit persisted across reload', /Reviewed by Mint\./.test(after ?? ''));

// version snapshot
const snapBtn = page.locator('button:has-text("Save version")');
if (await snapBtn.count()) {
  page.once('dialog', d => d.accept('Before the rubric review'));
  await snapBtn.click();
  await page.waitForTimeout(2500);
  ok('named version created',(await page.locator('text=Before the rubric review').count())>0);
  await page.screenshot({path:`${OUT}/d4-versions.png`});
}

await browser.close();
console.log('\n'+res.join('\n'));
console.log(`\npage errors: ${errs.length}`);
for (const e of [...new Set(errs)].slice(0, 6)) console.log('  -', e);

const failed = res.filter((r) => r.startsWith('FAIL'));
if (failed.length > 0 || errs.length > 0) {
  console.error(`\n${failed.length} document flow(s) failed.`);
  process.exit(1);
}
console.log('\nAll document flows passed.');
