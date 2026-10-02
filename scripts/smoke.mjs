// Headless smoke test: loads the production build, plays through a few scenarios,
// captures screenshots and reports console errors.
// Usage: npm run build && node scripts/smoke.mjs [outDir]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'smoke-output';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const log = (...a) => console.log(...a);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
/** Place the free camera (x, y, z, yaw°, pitch°) for a screenshot. */
const pose = (x, y, z, yaw, pitch) =>
  page.evaluate(([x, y, z, yaw, pitch]) => {
    const g = window.game;
    g.camera.setMode('free');
    g.camera.pos.set(x, y, z);
    g.camera.yaw = yaw;
    g.camera.pitch = pitch;
  }, [x, y, z, yaw, pitch]);
let failed = false;
try {
  await page.goto('http://localhost:4173/?autostart&seed=' + (process.env.SEED ?? '1337'));
  await page.waitForFunction(() => window.game?.debugState?.state === 'playing', null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await shot('01-third-person');
  log('state', JSON.stringify(await page.evaluate(() => window.game.debugState)));
  // close-up of the nearest creature, inspected
  const near = await page.evaluate(() => {
    const g = window.game;
    const list = [...g.session.creatures.creatures.values()].filter((c) => c.anim !== 4);
    const p = g.session.player;
    list.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    const c = list[0];
    g.inspect(c.id);
    return { id: c.id, x: c.x, y: c.y, z: c.z, sp: c.species };
  });
  log('nearest creature', JSON.stringify(near));
  await page.evaluate(() => window.game.toggleFollow());
  await page.waitForTimeout(2500);
  await shot('02-follow-inspect');
  log('state', JSON.stringify(await page.evaluate(() => window.game.debugState)));
  await page.evaluate(() => window.game.toggleFollow());
  // throw a few stones in third person
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(500);
  }
  await shot('03-stones');
  log('bodies after throws', await page.evaluate(() => window.game.session.physics.bodyCount));
  // quick save / load roundtrip
  await page.keyboard.press('F5');
  await page.waitForTimeout(800);
  await page.keyboard.press('F9');
  await page.waitForTimeout(1500);
  log('after quickload', JSON.stringify(await page.evaluate(() => window.game.debugState)));
  await page.keyboard.press('F3');
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(2500);
  await pose(256, 160, 560, 0, -35);
  await page.waitForTimeout(1500);
  await shot('04-aerial-debug');
  // night time at 60x
  await page.keyboard.press('Digit6');
  await page.waitForFunction(() => {
    const h = (7 + (window.game.renderTime / 480) * 24) % 24;
    return h > 21 || h < 4;
  }, null, { timeout: 60000 });
  await page.keyboard.press('Digit1');
  await pose(256, 60, 400, 30, -20);
  await page.waitForTimeout(1500);
  await shot('05-night');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(500);
  await shot('06-map');
  await page.keyboard.press('KeyM');
  log('state', JSON.stringify(await page.evaluate(() => window.game.debugState)));
} catch (e) {
  failed = true;
  log('FAILED', e.message);
  await shot('failure');
} finally {
  log(errors.length ? errors.slice(0, 40).join('\n') : 'no console errors');
  await browser.close();
  server.kill();
  process.exit(failed ? 1 : 0);
}
