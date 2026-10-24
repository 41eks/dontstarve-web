# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: moonbase.spec.ts >> shows native charge layers, resumes after a downloaded save, and returns the transformed moonstaff
- Location: tests/moonbase.spec.ts:118:1

# Error details

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
```

# Test source

```ts
  60  |       mesh.localToWorld(center).project(camera);
  61  |       const rect = renderer.domElement.getBoundingClientRect();
  62  |       return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  63  |     });
  64  |     await page.mouse.click(point.x, point.y, { button });
  65  |   };
  66  |   const samples = () => page.evaluate(() => ((window as any).moonbaseAudio as { duration: number; loop: boolean }[]).filter(sample => !sample.loop));
  67  |   const clearSamples = () => page.evaluate(() => { (window as any).moonbaseAudio.length = 0; });
  68  |   const bar = page.locator('dst-inventory-bar .inventory-bar__items');
  69  | 
  70  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  71  |   await submit('c_spawn("moonbase")');
  72  |   await expect.poll(state).toMatchObject({ workleft: 4, animation: 'med' });
  73  |   await submit('c_give("moonrocknugget", 2)');
  74  |   await bar.locator('[data-item-id="moonrocknugget"]').click();
  75  |   await clearSamples();
  76  |   await clickMoonbase('right'); // The action walks to range before the long repair action.
  77  |   await expect.poll(async () => (await state())?.workleft, { timeout: 30_000 }).toBe(6);
  78  |   const repairSamples = await samples();
  79  |   expect(repairSamples).toHaveLength(3);
  80  |   expect(repairSamples[0].duration).toBeCloseTo(34346 / 44100, 5);
  81  |   expect(repairSamples[2].duration).toBeCloseTo(19081 / 44100, 5);
  82  |   await expect.poll(async () => (await state())?.animation).toBe('full');
  83  | 
  84  |   await bar.locator('[data-item-id="yellowstaff"]').click();
  85  |   await clearSamples(); await clickMoonbase();
  86  |   await expect.poll(async () => (await state())?.held).toMatchObject({ entityId: 'moonbase_browser_staff', skinId: 'starstaff_crystal', remainingUses: 7 });
  87  |   expect(await samples()).toHaveLength(2);
  88  |   const saved = await saveGame(), moonbase = saved.world.entities.moonbase[0];
  89  |   expect(moonbase.components.workable).toEqual({ maxwork: 6, workleft: 6 });
  90  |   expect(JSON.stringify(saved.players.local.inventory)).not.toContain('yellowstaff');
  91  |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  92  |   await page.reload(); await prepare();
  93  |   await expect.poll(async () => (await state())?.held).toEqual(moonbase.components.moonbase.staff);
  94  |   expect((await saveGame()).world.entities.moonbase[0]).toEqual(moonbase);
  95  | 
  96  |   await clearSamples(); await clickMoonbase();
  97  |   await expect.poll(async () => (await state())?.held).toBeUndefined();
  98  |   expect(await samples()).toHaveLength(2);
  99  |   await expect(bar.locator('[data-item-id="yellowstaff"]')).toHaveAttribute('data-skin-id', 'starstaff_crystal');
  100 |   await submit('c_spawn("moonrocknugget")');
  101 |   await expect.poll(() => page.evaluate(() => (window as any).moonbaseGame.scene.children
  102 |     .some((model: any) => model.userData.itemId === 'moonrocknugget'))).toBe(true);
  103 |   const taken = await saveGame();
  104 |   expect(taken.world.entities.moonbase[0].components.moonbase).toBeUndefined();
  105 |   const slots = Object.values(taken.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  106 |   expect(slots.find(slot => slot.item.itemId === 'yellowstaff').item).toEqual(moonbase.components.moonbase.staff);
  107 |   expect(slots.find(slot => slot.item.itemId === 'moonrocknugget').item.count).toBe(1);
  108 |   const groundRock = taken.world.entities.ground_item.find((entity: any) => entity.components.stack.itemId === 'moonrocknugget');
  109 |   expect(groundRock.components.stack.count).toBe(1);
  110 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: taken }));
  111 |   await page.reload(); await prepare();
  112 |   const final = await saveGame();
  113 |   expect(final.world.entities.ground_item).toEqual(taken.world.entities.ground_item);
  114 |   expect(final.players.local.inventory).toEqual(taken.players.local.inventory);
  115 |   expect(errors).toEqual([]);
  116 | });
  117 | 
  118 | test('shows native charge layers, resumes after a downloaded save, and returns the transformed moonstaff', async ({ page }) => {
  119 |   test.setTimeout(180_000);
  120 |   const errors: string[] = [];
  121 |   page.on('pageerror', error => errors.push(error.message));
  122 |   page.on('console', message => {
  123 |     if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) errors.push(message.text());
  124 |   });
  125 |   await page.addInitScript(() => {
  126 |     const sounds: { duration: number; channels: number; loop: boolean; stopped: boolean }[] = [];
  127 |     (window as any).chargeAudio = sounds;
  128 |     const original = AudioContext.prototype.createBufferSource;
  129 |     AudioContext.prototype.createBufferSource = function () {
  130 |       const source = original.call(this), start = source.start.bind(source), stop = source.stop.bind(source);
  131 |       let sound: typeof sounds[number] | undefined;
  132 |       source.start = (...args: Parameters<typeof start>) => {
  133 |         if (source.buffer) {
  134 |           sound = { duration: source.buffer.duration, channels: source.buffer.numberOfChannels, loop: source.loop, stopped: false };
  135 |           sounds.push(sound);
  136 |         }
  137 |         start(...args);
  138 |       };
  139 |       source.stop = (...args: Parameters<typeof stop>) => { if (sound) sound.stopped = true; stop(...args); };
  140 |       return source;
  141 |     };
  142 |   });
  143 |   await page.route('**/saves/initial-world.json', async route => {
  144 |     const response = await route.fetch(), save = await response.json();
  145 |     save.world.elapsedSeconds = 10 * 480 + 420; // Day 11, beginning of the full-moon night.
  146 |     save.world.entities = { moonbase: [{ id: 'browser_charge_base', transform: { position: [0, 0, -10], rotationY: 0 },
  147 |       components: { building: { state: 'idle' }, workable: { workleft: 6, maxwork: 6 }, moonbase: {
  148 |         staff: { entityId: 'browser_charge_yellow', itemId: 'yellowstaff', count: 1, skinId: 'starstaff_crystal', remainingUses: 7 },
  149 |       } } }] };
  150 |     save.players.local.transform.position = [0, 0, 0];
  151 |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  152 |     save.players.local.inventory.bufferedBuilds = [];
  153 |     await route.fulfill({ response, json: save });
  154 |   });
  155 |   const prepare = () => page.evaluate(async urls => {
  156 |     await import(urls.main);
  157 |     const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
  158 |     (window as any).chargeGame = { scene, renderer, camera };
  159 |   }, urls);
> 160 |   const current = () => page.evaluate(() => {
      |                              ^ Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
  161 |     const { scene } = (window as any).chargeGame, model = scene.children.find((model: any) => model.name === 'MoonBase');
  162 |     const state = model.userData.moonbase;
  163 |     const order = (name: string) => scene.children.find((model: any) => model.name === name)?.children[0].renderOrder;
  164 |     return { phase: state.charge.peek(), staff: state.staff.peek()?.snapshot(),
  165 |       orders: [order('positronbeam_back'), model.children[0].renderOrder, order('positronbeam_front'), order('positronpulse')],
  166 |       cold: scene.children.some((model: any) => model.name === 'staffcoldlightfx'),
  167 |       intense: model.userData.actionEntity.hasTag('intense') };
  168 |   });
  169 |   const audio = () => page.evaluate(() => (window as any).chargeAudio as {
  170 |     duration: number; channels: number; loop: boolean; stopped: boolean;
  171 |   }[]);
  172 |   const saveGame = async () => {
  173 |     const download = page.waitForEvent('download');
  174 |     await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
  175 |       new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  176 |     return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  177 |   };
  178 |   await page.goto('/tests/dst-lighting.html'); await prepare();
  179 |   await page.keyboard.press('Shift'); // Resume Web Audio with an actual user gesture.
  180 |   await expect.poll(async () => (await current()).phase, { timeout: 45_000 }).toBe('charging_2');
  181 |   const second = await current();
  182 |   expect(second.intense).toBe(true);
  183 |   expect(second.orders[0]).toBeLessThan(second.orders[1]);
  184 |   expect(second.orders[1]).toBeLessThan(second.orders[2]);
  185 |   expect(second.orders[2]).toBeLessThan(second.orders[3]);
  186 |   const initialSounds = await audio();
  187 |   expect(initialSounds.some(sound => sound.loop && Math.abs(sound.duration - 207153 / 32000) < .001)).toBe(true);
  188 |   expect(initialSounds.some(sound => sound.loop && sound.channels === 2)).toBe(true);
  189 |   await page.screenshot({ path: '/tmp/moonbase-charge-stage2.png' });
  190 |   const saved = await saveGame(), savedBase = saved.world.entities.moonbase[0];
  191 |   expect(savedBase.components.moonbase.timer.timers).toHaveProperty('mooncharge3');
  192 |   expect(savedBase.components.moonbase.timer.timers).not.toHaveProperty('mooncharge2');
  193 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  194 |   await page.reload(); await prepare(); await page.keyboard.press('Shift');
  195 |   await expect.poll(async () => (await current()).phase).toBe('charging_2');
  196 |   await expect.poll(async () => (await current()).phase, { timeout: 60_000 }).toBe('complete');
  197 |   const complete = await current();
  198 |   expect(complete.staff).toMatchObject({ itemId: 'opalstaff', count: 1, skinId: 'moonstaff_crystal', remainingUses: 50 });
  199 |   expect(complete.staff.entityId).not.toBe(savedBase.components.moonbase.staff.entityId);
  200 |   expect(complete.intense).toBe(false); expect(complete.cold).toBe(true);
  201 |   const sounds = await audio();
  202 |   expect(sounds.some(sound => !sound.loop && Math.abs(sound.duration - 171990 / 44100) < .001)).toBe(true);
  203 |   expect(sounds.filter(sound => sound.loop && Math.abs(sound.duration - 207153 / 32000) < .001).every(sound => sound.stopped)).toBe(true);
  204 |   await page.screenshot({ path: '/tmp/moonbase-charge-complete.png' });
  205 |   const morphed = await saveGame();
  206 |   expect(morphed.world.entities.moonbase[0].components.moonbase.staff).toEqual(complete.staff);
  207 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: morphed }));
  208 |   await page.reload(); await prepare();
  209 |   await expect.poll(async () => (await current()).cold).toBe(true);
  210 |   const point = await page.evaluate(() => {
  211 |     const { scene, camera, renderer } = (window as any).chargeGame;
  212 |     const model = scene.children.find((model: any) => model.name === 'MoonBase'), mesh = model.children[0].children[0];
  213 |     mesh.geometry.computeBoundingBox();
  214 |     const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
  215 |     const rect = renderer.domElement.getBoundingClientRect();
  216 |     return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  217 |   });
  218 |   await page.mouse.click(point.x, point.y);
  219 |   await expect.poll(async () => (await current()).staff).toBeUndefined();
  220 |   await expect(page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="opalstaff"]')).toHaveAttribute('data-skin-id', 'moonstaff_crystal');
  221 |   expect((await audio()).filter(sound => sound.loop).every(sound => sound.stopped)).toBe(true);
  222 |   const taken = await saveGame();
  223 |   const slots = Object.values(taken.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  224 |   expect(slots.find(slot => slot.item.itemId === 'opalstaff').item).toEqual(complete.staff);
  225 |   expect(taken.world.entities.moonbase[0].components.moonbase).toBeUndefined();
  226 |   expect(errors).toEqual([]);
  227 | });
  228 | 
```