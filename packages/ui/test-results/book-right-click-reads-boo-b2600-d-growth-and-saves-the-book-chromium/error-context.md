# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: book.spec.ts >> right-click reads book_silviculture with the source states, sounds and growth, and saves the book
- Location: tests/book.spec.ts:8:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('dst-status-hud .survival-meter--sanity output')
Expected: "67"
Received: "166"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('dst-status-hud .survival-meter--sanity output') with timeout 5000ms
  - waiting for locator('dst-status-hud .survival-meter--sanity output')
    11 × locator resolved to <output class="survival-meter__value">166</output>
       - unexpected value "166"

```

```yaml
- status: "166"
```

# Test source

```ts
  1   | import { readSaveDownload } from './save-download';
  2   | import { fileURLToPath } from 'node:url';
  3   | import { expect, test } from '@playwright/test';
  4   | 
  5   | const modules = Object.fromEntries(['main', 'player', 'universal', 'playerStats', 'scene'].map(name =>
  6   |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7   | 
  8   | test('right-click reads book_silviculture with the source states, sounds and growth, and saves the book', async ({ page }) => {
  9   |   test.setTimeout(150_000);
  10  |   const errors: string[] = [];
  11  |   page.on('pageerror', error => errors.push(error.message));
  12  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13  |   // Record which decoded WAV each started buffer source plays.
  14  |   await page.addInitScript(() => {
  15  |     const urls = new WeakMap<object, string>();
  16  |     const started: string[] = [];
  17  |     (window as any).startedSounds = started;
  18  |     const fetch = window.fetch;
  19  |     window.fetch = async (...args) => {
  20  |       const response = await fetch(...args);
  21  |       const url = String(args[0]);
  22  |       if (!url.includes('/sound/')) return response;
  23  |       const arrayBuffer = response.arrayBuffer.bind(response);
  24  |       response.arrayBuffer = async () => { const data = await arrayBuffer(); urls.set(data, url); return data; };
  25  |       return response;
  26  |     };
  27  |     const decode = BaseAudioContext.prototype.decodeAudioData;
  28  |     BaseAudioContext.prototype.decodeAudioData = async function (data: ArrayBuffer) {
  29  |       const url = urls.get(data);
  30  |       const buffer = await decode.call(this, data);
  31  |       if (url) urls.set(buffer, url.slice(url.lastIndexOf('/') + 1));
  32  |       return buffer;
  33  |     } as typeof decode;
  34  |     const start = AudioBufferSourceNode.prototype.start;
  35  |     AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
  36  |       started.push(this.buffer ? urls.get(this.buffer) ?? 'unknown' : 'empty');
  37  |       return start.apply(this, args);
  38  |     };
  39  |   });
  40  |   await page.route('**/saves/initial-world.json', async route => {
  41  |     const response = await route.fetch(), save = await response.json();
  42  |     save.players.local.stats = { health: 150, hunger: 150, sanity: 100 };
  43  |     await route.fulfill({ response, json: save });
  44  |   });
  45  |   const prepare = () => page.evaluate(async paths => {
  46  |     const main = await import(paths.main), { player } = await import(paths.player);
  47  |     const { scene } = await import(paths.universal);
  48  |     const stats = await import(paths.playerStats);
  49  |     (window as any).bookGame = { main, player, scene, stats };
  50  |   }, modules);
  51  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  52  |   await page.evaluate(() => {
  53  |     const { main, scene } = (window as any).bookGame;
  54  |     main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
  55  |       .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
  56  |     (window as any).existingIds = scene.children.map((model: any) => model.userData.instance?.entityId);
  57  |   });
  58  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  59  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  60  |   const newModel = (prefab: string) => page.evaluate(prefab => (window as any).bookGame.scene.children.find((model: any) =>
  61  |     (model.userData.itemId ?? model.userData.instance?.prefab) === prefab
  62  |     && !(window as any).existingIds.includes(model.userData.instance?.entityId))?.userData.instance?.entityId ?? null, prefab);
  63  |   const stateName = () => page.evaluate(() => (window as any).bookGame.player.userData.stategraph.stateName);
  64  |   const sanity = page.locator('dst-status-hud .survival-meter--sanity output');
  65  | 
  66  |   await submit('c_spawn("grass")');
  67  |   await expect.poll(() => newModel('grass')).not.toBeNull();
  68  |   const grassId = await newModel('grass');
  69  |   const pickGrass = () => page.evaluate(id => {
  70  |     const model = (window as any).bookGame.scene.children.find((model: any) => model.userData.instance?.entityId === id);
  71  |     return model.userData.components.pickable.pick({ giveItem: () => true });
  72  |   }, grassId);
  73  |   const grassReady = () => page.evaluate(id => (window as any).bookGame.scene.children
  74  |     .find((model: any) => model.userData.instance?.entityId === id).userData.components.pickable.canBePicked, grassId);
  75  |   expect(await pickGrass()).toBe(true);
  76  |   expect(await grassReady()).toBe(false);
  77  | 
  78  |   await submit('c_give("book_silviculture")');
  79  |   const book = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="book_silviculture"]');
  80  |   await expect(book).toBeVisible();
  81  |   await book.click({ button: 'right' });
  82  |   await expect.poll(stateName).toBe('book2');
  83  |   await page.waitForTimeout(600); // Reach the open book and both FX before the frame-50 commit.
  84  |   await page.screenshot({ path: test.info().outputPath('reading.png') });
  85  |   await expect.poll(stateName, { timeout: 10_000 }).toBe('idle');
  86  |   expect(await grassReady()).toBe(true);
> 87  |   await expect(sanity).toHaveText('67');
      |                        ^ Error: expect(locator).toHaveText(expected) failed
  88  |   const uses = () => page.evaluate(() => (window as any).bookGame.main.inventory.exportState().slots
  89  |     .find((slot: any) => slot.item?.itemId === 'book_silviculture')?.item.remainingUses);
  90  |   expect(await uses()).toBe(4);
  91  |   const started = () => page.evaluate(() => [...(window as any).startedSounds] as string[]);
  92  |   const readSounds = await started();
  93  |   for (const pattern of [/^together\.fsb-48[1-4]\.wav$/, /^wickerbottom_rework\.fsb-13\.wav$/, /^wickerbottom_rework\.fsb-20\.wav$/,
  94  |     /^common\.fsb-148\.wav$/, /^sfx\.fsb-(347|348|349|350)\.wav$/]) {
  95  |     expect(readSounds.some(file => pattern.test(file)), String(pattern)).toBe(true);
  96  |   }
  97  | 
  98  |   // No picked silviculture plant in range: book_fx fails and nothing is spent.
  99  |   await book.click({ button: 'right' });
  100 |   await expect.poll(stateName).toBe('book2');
  101 |   await expect.poll(stateName, { timeout: 10_000 }).toBe('idle');
  102 |   expect((await started()).includes('wickerbottom_rework.fsb-3.wav')).toBe(true);
  103 |   expect(await uses()).toBe(4);
  104 |   await expect(sanity).toHaveText('67');
  105 | 
  106 |   await submit('c_spawn("book_silviculture")');
  107 |   await expect.poll(() => newModel('book_silviculture')).not.toBeNull();
  108 |   const groundId = await newModel('book_silviculture');
  109 |   const savedBook = await page.evaluate(() => (window as any).bookGame.main.inventory.exportState().slots
  110 |     .find((slot: any) => slot.item?.itemId === 'book_silviculture').item);
  111 |   const download = page.waitForEvent('download'); await submit('c_save()');
  112 |   const save = JSON.parse(await readSaveDownload((await (await download).path())!));
  113 |   const ground = save.world.entities.ground_item.find((entity: any) => entity.id === groundId);
  114 |   expect(ground.components.stack).toMatchObject({ itemId: 'book_silviculture', count: 1 });
  115 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  116 |   await page.reload(); await prepare();
  117 |   await expect(sanity).toHaveText('67');
  118 |   expect(await page.evaluate(() => (window as any).bookGame.main.inventory.exportState().slots
  119 |     .find((slot: any) => slot.item?.itemId === 'book_silviculture').item)).toEqual(savedBook);
  120 |   expect(savedBook.remainingUses).toBe(4);
  121 |   expect(await page.evaluate(id => {
  122 |     const { main, scene } = (window as any).bookGame;
  123 |     const model = scene.children.find((model: any) => model.userData.instance?.entityId === id);
  124 |     const entity = main.inventory.entities.get(id);
  125 |     return { itemId: entity.prefab, count: entity.components.stackable.count, position: model.position.toArray(),
  126 |       book: entity.hasTag('book') };
  127 |   }, groundId)).toEqual({ itemId: 'book_silviculture', count: 1, position: ground.transform.position, book: true });
  128 |   expect(errors).toEqual([]);
  129 | });
  130 | 
  131 | test('right-click reads book_rain: its fx and sounds play, moisture starts the rain, and a second read stops it', async ({ page }) => {
  132 |   test.setTimeout(180_000);
  133 |   const errors: string[] = [];
  134 |   const sounds: string[] = [];
  135 |   page.on('pageerror', error => errors.push(error.message));
  136 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  137 |   page.on('request', request => { if (request.url().endsWith('.wav')) sounds.push(new URL(request.url()).pathname.split('/').pop()!); });
  138 |   await page.route('**/saves/initial-world.json', async route => {
  139 |     const response = await route.fetch(), save = await response.json();
  140 |     save.players.local.stats = { health: 150, hunger: 150, sanity: 100 };
  141 |     await route.fulfill({ response, json: save });
  142 |   });
  143 |   await page.goto('/tests/dst-lighting.html');
  144 |   await page.evaluate(async paths => {
  145 |     const main = await import(paths.main), { player } = await import(paths.player);
  146 |     const { scene } = await import(paths.universal);
  147 |     const { worldState } = await import(paths.scene);
  148 |     (window as any).rainGame = { main, player, scene, weather: worldState.weather };
  149 |     main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
  150 |       .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
  151 |   }, modules);
  152 |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  153 |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  154 |   const stateName = () => page.evaluate(() => (window as any).rainGame.player.userData.stategraph.stateName);
  155 |   const weather = () => page.evaluate(() => {
  156 |     const { weather } = (window as any).rainGame;
  157 |     return { type: weather.preciptype.peek(), moisture: weather.moisture.peek(), ceil: weather.moistureceil.peek(),
  158 |       floor: weather.moisturefloor.peek(), rate: weather.rainRate.peek() };
  159 |   });
  160 |   const rainQuads = () => page.evaluate(() => (window as any).rainGame.scene.getObjectByName('rain')?.geometry.drawRange.count / 6);
  161 |   const fxCount = () => page.evaluate(() => (window as any).rainGame.scene.children.filter((model: any) => model.userData.instance?.prefab === 'fx_book_rain').length);
  162 |   expect((await weather()).type).toBe('none');
  163 |   expect(await rainQuads()).toBe(0);
  164 | 
  165 |   await submit('c_give("book_rain")');
  166 |   const book = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="book_rain"]');
  167 |   await expect(book).toBeVisible();
  168 |   await book.click({ button: 'right' });
  169 |   await expect.poll(stateName).toBe('book2');
  170 |   // The fx.lua effect appears at the reader at the frame-50 commit, which also moves moisture to its ceiling.
  171 |   await expect.poll(fxCount, { timeout: 30_000 }).toBe(1);
  172 |   expect(sounds).toEqual(expect.arrayContaining(['wickerbottom_rework.fsb-10.wav', 'wickerbottom_rework.fsb-11.wav']));
  173 |   await expect.poll(async () => (await weather()).type, { timeout: 60_000 }).toBe('rain');
  174 |   const raining = await weather();
  175 |   expect(raining.rate).toBeGreaterThan(0);
  176 |   expect(raining.moisture).toBeLessThanOrEqual(raining.ceil);
  177 |   await expect.poll(rainQuads, { timeout: 20_000 }).toBeGreaterThan(0);
  178 |   expect(sounds).toEqual(expect.arrayContaining(['forest_stream.fsb-74.wav', 'forest_stream.fsb-75.wav', 'forest_stream.fsb-76.wav']));
  179 |   await expect.poll(stateName, { timeout: 20_000 }).toBe('idle');
  180 |   expect(await page.evaluate(() => (window as any).rainGame.main.inventory.exportState().slots
  181 |     .find((slot: any) => slot.item?.itemId === 'book_rain').item.remainingUses)).toBe(4);
  182 | 
  183 |   // Reading during rain forces the moisture floor, which stops precipitation and removes the particles.
  184 |   await book.click({ button: 'right' });
  185 |   await expect.poll(async () => (await weather()).type, { timeout: 90_000 }).toBe('none');
  186 |   await expect.poll(rainQuads, { timeout: 20_000 }).toBe(0);
  187 |   expect(errors).toEqual([]);
```