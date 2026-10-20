// Usage: pnpm --filter @dontstarve-web/map dev   (in another shell)
//        pnpm --filter @dontstarve-web/map bench [main|worker] [load]
import { chromium } from '../../ui/node_modules/@playwright/test/index.mjs';

const mode = process.argv[2] ?? 'main';
const load = (process.argv[3] === 'load' ? '&load=1' : '') + (process.argv[4] ? `&heading=${process.argv[4]}` : '') + (process.argv[5] ? `&element=${process.argv[5]}` : '');
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', message => { if (message.type() === 'error') console.log('console.error', message.text().slice(0, 200)); });
page.on('pageerror', error => console.log('pageerror', error.message));
await page.goto(`http://127.0.0.1:4176/?mode=${mode}${load}`);
await page.waitForFunction(() => window.bench?.done, null, { timeout: 280_000 });
console.log(JSON.stringify(await page.evaluate(() => window.bench), null, 1));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
