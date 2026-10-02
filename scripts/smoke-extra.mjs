// Second headless scenario: title screen, rain/storm particles, swimming and the pause menu.
// Usage: npm run build && node scripts/smoke-extra.mjs [outDir]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'smoke-output';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
let failed = false;
try {
  await page.goto('http://localhost:4174/?seed=42');
  await page.waitForTimeout(1500);
  await shot('10-title');
  await page.click('#start-button');
  await page.waitForFunction(() => window.game?.debugState?.state === 'playing', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  // rain: Clear -> Cloudy -> Rain, let it build up at 10x
  await page.evaluate(() => { window.game.session.sim.forceWeather(); window.game.session.sim.forceWeather(); });
  await page.keyboard.press('Digit4');
  await page.waitForFunction(() => window.game.weather.rain > 0.45, null, { timeout: 60000 });
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(1500);
  await shot('11-rain');
  await page.evaluate(() => window.game.session.sim.forceWeather());
  await page.keyboard.press('Digit4');
  await page.waitForFunction(() => window.game.weather.rain > 0.85, null, { timeout: 60000 });
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(1000);
  await shot('12-storm');
  // swim in the nearest lake
  const lake = await page.evaluate(() => {
    const g = window.game;
    const w = g.session.world;
    const p = g.session.player;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < w.res * w.res; i++) {
      if (w.waterType[i] !== 2 || w.waterLevel[i] - w.heights[i] < 2.5) continue;
      const x = (i % w.res) * w.cell;
      const z = Math.floor(i / w.res) * w.cell;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = { x, z }; }
    }
    g.session.player.teleport(best.x, best.z);
    g.session.sim.forceWeather();
    return best;
  });
  console.log('lake', JSON.stringify(lake));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const swim = await page.evaluate(() => {
    const p = window.game.session.player;
    return { swimming: p.swimming, feet: p.feetY, water: window.game.session.query.waterAt(p.x, p.z), state: window.game.state };
  });
  console.log('swimming', JSON.stringify(swim));
  if (!swim.swimming) throw new Error('expected the player to be swimming');
  await shot('13-swim');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await shot('14-pause');
  console.log('state', JSON.stringify(await page.evaluate(() => window.game.debugState)));
} catch (e) {
  failed = true;
  console.log('FAILED', e.message);
  await shot('failure');
} finally {
  console.log(errors.length ? errors.slice(0, 40).join('\n') : 'no console errors');
  if (errors.some((e) => e.startsWith('[error]') || e.startsWith('[pageerror]'))) failed = true;
  await browser.close();
  server.kill();
  process.exit(failed ? 1 : 0);
}
