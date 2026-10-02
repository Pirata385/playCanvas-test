import * as pc from 'playcanvas';
import { AudioEngine } from '../audio/AudioEngine';
import { clamp } from './math';
import { parseSeed } from './rng';
import { initRapier, Physics, type Stone } from '../physics/Physics';
import { CameraRig, type CameraMode } from '../player/CameraRig';
import { Input } from '../player/Input';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { PlayerController } from '../player/PlayerController';
import { CreatureRenderer } from '../render/CreatureRenderer';
import { Environment } from '../render/Environment';
import { TerrainRenderer } from '../render/TerrainRenderer';
import { VegetationRenderer } from '../render/VegetationRenderer';
import { WeatherFx } from '../render/WeatherFx';
import { SaveSystem, type GameSave } from '../save/SaveSystem';
import type { CreatureDetail } from '../sim/Ecosystem';
import type { SimSnapshot } from '../sim/protocol';
import { SimClient } from '../sim/SimClient';
import { Anim, SPECIES, SPECIES_COUNT, Species } from '../sim/species';
import { dayNumber, formatClock, hourOfDay } from '../sim/time';
import { initialWeather, type WeatherState } from '../sim/Weather';
import { DebugPanel } from '../ui/DebugPanel';
import { $, show } from '../ui/dom';
import { Hud } from '../ui/Hud';
import { Inspector } from '../ui/Inspector';
import { Menus, randomSeed, type Settings } from '../ui/Menus';
import { Minimap } from '../ui/Minimap';
import { Biome, extractNav, type WorldData } from '../world/types';
import { generateWorldAsync } from '../world/WorldGenClient';
import { WorldQuery } from '../world/WorldQuery';

const TIME_SCALES = [0, 1, 2, 5, 10, 30, 60];

/** Everything that belongs to one generated world; torn down on regeneration. */
interface WorldSession {
  seed: number;
  world: WorldData;
  query: WorldQuery;
  terrain: TerrainRenderer;
  vegetation: VegetationRenderer;
  creatures: CreatureRenderer;
  env: Environment;
  fx: WeatherFx;
  physics: Physics;
  sim: SimClient;
  player: PlayerController;
  avatar: PlayerAvatar;
  minimap: Minimap;
  stones: Map<Stone, pc.Entity>;
}

type GameState = 'menu' | 'loading' | 'playing' | 'paused' | 'map';

/** Top-level orchestrator: owns the PlayCanvas app and wires all systems together. */
export class Game {
  readonly app: pc.Application;
  private input: Input;
  private camera: CameraRig;
  private audio: AudioEngine | null = null;
  private hud = new Hud();
  private inspector = new Inspector();
  private debug = new DebugPanel();
  private menus = new Menus();
  private session: WorldSession | null = null;
  private state: GameState = 'menu';
  private timeScale = 1;
  private discovered = new Set<number>();
  private selectedId: number | null = null;
  private selectedDetail: CreatureDetail | null = null;
  private followId: number | null = null;
  private cursorMode = false;
  private intentionalUnlock = false;
  private pausedAt = 0;
  private thirdPersonDistance = 6;
  private hudVisible = true;
  private snapshotAt = 0;
  private lastSnapshot: SimSnapshot | null = null;
  private weather: WeatherState = initialWeather();
  private lastLightning = 0;
  private renderTime = 0;
  private throwCooldown = 0;
  private throwAnim = 0;
  private playerSendTimer = 0;
  private minimapTimer = 0;
  private debugTimer = 0;
  private callTimer = 3;
  private fps = 60;
  private frameMs = 16;
  private entityCount = 0;
  private stoneMaterial: pc.StandardMaterial;
  private stoneHitSpeed = 4;

  constructor(canvas: HTMLCanvasElement) {
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: true, powerPreference: 'high-performance' }
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 1.5);
    window.addEventListener('resize', () => this.app.resizeCanvas());
    this.app.scene.ambientLight = new pc.Color(0.4, 0.4, 0.45);
    this.camera = new CameraRig(this.app);
    this.input = new Input(canvas);
    this.stoneMaterial = new pc.StandardMaterial();
    this.stoneMaterial.diffuse = new pc.Color(0.45, 0.43, 0.4);
    this.stoneMaterial.update();
    this.applySettings(this.menus.settings);
    this.wireUi(canvas);
    this.app.on('update', (dt: number) => this.update(dt));
    this.app.start();
    this.idleBackdrop();
  }

  // ------------------------------------------------------------------ UI wiring

  private wireUi(canvas: HTMLCanvasElement): void {
    const m = this.menus;
    m.onStart = (seed) => void this.startWorld(parseSeed(seed));
    m.onResume = () => this.resume();
    m.onRegenerate = () => this.session && void this.startWorld(this.session.seed);
    m.onNewWorld = (seed) => void this.startWorld(parseSeed(seed));
    m.onSaveSlot = (slot) => void this.saveToSlot(slot);
    m.onLoadSlot = (slot) => {
      try {
        const save = SaveSystem.read(slot);
        if (save) void this.loadSave(save);
      } catch (err) {
        this.showError(err);
      }
    };
    m.onExport = async () => {
      const save = await this.buildSave();
      if (save) SaveSystem.exportFile(save);
    };
    m.onImport = (save) => void this.loadSave(save);
    m.onSettings = (s) => this.applySettings(s);

    this.hud.onTimeScale = (s) => this.setTimeScale(s);
    this.inspector.onClose = () => this.select(null);
    this.inspector.onFollow = () => this.toggleFollow();

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.cursorMode && !this.intentionalUnlock) this.pause();
      this.intentionalUnlock = false;
    };
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.cursorMode) this.input.requestLock();
    });
    $('bigmap-canvas').addEventListener('click', (e) => this.onMapClick(e as MouseEvent));
    $('map-legend').innerHTML = Minimap.legendHtml();
    window.addEventListener('keydown', (e) => {
      // the Escape that released pointer lock must not immediately resume
      if (e.code === 'Escape' && this.state === 'paused' && performance.now() - this.pausedAt > 400) this.resume();
      else if (e.code === 'Escape' && this.state === 'map') this.toggleMap();
    });
  }

  private applySettings(s: Settings): void {
    this.audio?.setVolume(s.volume);
    this.camera.sensitivity = s.sensitivity;
    if (this.session) this.session.env.shadowsEnabled = s.shadows;
    this.debug.toggle(s.debug && this.state !== 'menu');
  }

  private showError(err: unknown): void {
    const box = $('error-box');
    box.textContent = err instanceof Error ? err.message : String(err);
    show(box, true);
    setTimeout(() => show(box, false), 6000);
    console.error(err);
  }

  /** Slowly orbiting camera behind the title screen. */
  private idleBackdrop(): void {
    this.camera.entity.setPosition(0, 40, 0);
  }

  // ------------------------------------------------------------------ world lifecycle

  async startWorld(seed: number, save?: GameSave): Promise<void> {
    if (this.state === 'loading') return;
    this.state = 'loading';
    if (!this.audio) {
      try {
        this.audio = new AudioEngine();
        this.audio.setVolume(this.menus.settings.volume);
      } catch {
        this.audio = null;
      }
    }
    this.audio?.resume();
    this.menus.showStart(false);
    this.menus.showPause(false);
    show($('bigmap'), false);
    this.menus.showLoading(true, save ? 'Restoring saved island…' : `Generating island #${seed}…`);
    this.input.exitLock();
    try {
      this.disposeSession();
      const [world] = await Promise.all([
        generateWorldAsync(seed, (stage, f) => this.menus.progress(stage, f * 0.8)),
        initRapier()
      ]);
      this.menus.progress('Building meshes', 0.82);
      await nextFrame();
      this.session = this.buildSession(world, save);
      this.menus.progress('Waking the wildlife', 0.95);
      await this.session.sim.ready;
      this.discovered = new Set(save?.discovered ?? []);
      this.hud.setJournal(this.discovered);
      this.select(null);
      this.followId = null;
      this.timeScale = save?.timeScale || 1;
      this.session.sim.setTimeScale(this.timeScale);
      this.hud.setTimeScale(this.timeScale);
      if (save) {
        this.camera.yaw = save.camera.yaw;
        this.camera.pitch = save.camera.pitch;
        this.camera.distance = save.camera.distance;
        this.camera.setMode(save.camera.mode === 'follow' ? 'third' : save.camera.mode);
      } else {
        this.camera.setMode('third');
        this.camera.yaw = 200;
        this.camera.pitch = -12;
      }
      const url = new URL(location.href);
      url.searchParams.set('seed', String(seed));
      history.replaceState(null, '', url);
      this.menus.canSave = true;
      this.menus.showLoading(false);
      show(this.hud.root, this.hudVisible);
      this.debug.toggle(this.menus.settings.debug);
      this.state = 'playing';
      this.cursorMode = false;
      this.hud.info(save ? `Loaded island #${seed}` : `Welcome to island #${seed}. Click the view to look around.`);
      this.countEntities();
    } catch (err) {
      this.state = 'menu';
      this.menus.showLoading(false);
      this.menus.showStart(true);
      this.showError(err);
    }
  }

  private buildSession(world: WorldData, save?: GameSave): WorldSession {
    const query = new WorldQuery(world);
    const terrain = new TerrainRenderer(this.app, world);
    const vegetation = new VegetationRenderer(this.app, world);
    const creatures = new CreatureRenderer(this.app, query);
    const env = new Environment(this.app, world.size, world.seed);
    env.shadowsEnabled = this.menus.settings.shadows;
    const fx = new WeatherFx(this.app);
    const [sx, sz] = world.spawn;
    const spawn = save ? { x: save.player.x, y: save.player.y - 1.2, z: save.player.z } : { x: sx, y: query.heightAt(sx, sz), z: sz };
    const physics = new Physics(world, spawn);
    const player = new PlayerController(physics, query);
    if (save) player.facing = save.player.facing;
    const avatar = new PlayerAvatar(this.app);
    avatar.onFootstep = (speed) => this.footstep(speed);
    player.onEvent = (kind) => {
      if (kind === 'splash') this.audio?.splash();
    };
    const sim = new SimClient(extractNav(world), save?.sim);
    sim.onSnapshot = (s) => this.onSnapshot(s);
    sim.onError = (msg) => this.showError(new Error(`Simulation: ${msg}`));
    const minimap = new Minimap(world);
    this.lastSnapshot = null;
    this.lastLightning = -1;
    return { seed: world.seed, world, query, terrain, vegetation, creatures, env, fx, physics, sim, player, avatar, minimap, stones: new Map() };
  }

  private disposeSession(): void {
    const s = this.session;
    if (!s) return;
    s.sim.dispose();
    s.terrain.destroy();
    s.vegetation.destroy();
    s.creatures.destroy();
    s.env.destroy();
    s.fx.destroy();
    s.avatar.destroy();
    for (const e of s.stones.values()) e.destroy();
    s.physics.destroy();
    this.session = null;
  }

  // ------------------------------------------------------------------ sim bridge

  private onSnapshot(s: SimSnapshot): void {
    const sess = this.session;
    if (!sess) return;
    const now = performance.now() / 1000;
    sess.creatures.applySnapshot(s.buffer, s.count, now);
    this.lastSnapshot = s;
    this.snapshotAt = now;
    this.weather = s.weather;
    if (this.lastLightning < 0) this.lastLightning = s.weather.lightning;
    if (s.weather.lightning > this.lastLightning) {
      this.lastLightning = s.weather.lightning;
      sess.env.lightning();
      this.audio?.thunder(150 + Math.random() * 700);
    }
    if (s.events.length) this.hud.pushEvents(s.events, (t) => formatClock(t));
    if (s.history) this.debug.drawHistory(s.history);
    this.selectedDetail = s.selected;
    if (this.selectedId !== null) {
      if (s.selected) this.inspector.update(s.selected);
      else this.select(null);
    }
  }

  private setTimeScale(scale: number): void {
    this.timeScale = scale;
    this.session?.sim.setTimeScale(this.state === 'playing' || this.state === 'map' ? scale : 0);
    this.hud.setTimeScale(scale);
    this.hud.toast(scale === 0 ? 'Simulation paused' : `Time ×${scale}`, 1.2);
  }

  // ------------------------------------------------------------------ pause / menus

  private pause(): void {
    if (this.state !== 'playing' && this.state !== 'map') return;
    show($('bigmap'), false);
    this.state = 'paused';
    this.pausedAt = performance.now();
    this.session?.sim.setTimeScale(0);
    const t = this.lastSnapshot?.time ?? 0;
    this.menus.showPause(true, this.session ? `Island #${this.session.seed} · Day ${dayNumber(t)} ${formatClock(t)}` : '');
    this.input.exitLock();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.menus.showPause(false);
    this.state = 'playing';
    this.session?.sim.setTimeScale(this.timeScale);
    if (!this.cursorMode) this.input.requestLock();
  }

  private toggleMap(): void {
    if (!this.session) return;
    if (this.state === 'map') {
      show($('bigmap'), false);
      this.state = 'playing';
      if (!this.cursorMode) this.input.requestLock();
    } else if (this.state === 'playing') {
      this.state = 'map';
      this.intentionalUnlock = this.input.locked;
      this.input.exitLock();
      show($('bigmap'), true);
      this.drawBigMap();
    }
  }

  private drawBigMap(): void {
    const s = this.session;
    if (!s) return;
    s.minimap.drawFull($<HTMLCanvasElement>('bigmap-canvas'), s.player.x, s.player.z, this.camera.yawRad, s.creatures.creatures.values(), this.selectedId);
  }

  private onMapClick(e: MouseEvent): void {
    const s = this.session;
    if (!s || this.state !== 'map') return;
    const c = e.currentTarget as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * s.world.size;
    const z = ((e.clientY - r.top) / r.height) * s.world.size;
    if (!s.query.isWalkable(x, z)) {
      this.hud.toast('Pick a spot on dry land');
      return;
    }
    s.player.teleport(x, z);
    this.stopFollowing();
    if (this.camera.mode !== 'third') this.camera.setMode('third');
    this.audio?.blip(660);
    this.toggleMap();
    this.hud.toast(`Travelled to ${s.world.size > 0 ? Biome[s.query.biomeAt(x, z)] : ''}`);
  }

  // ------------------------------------------------------------------ save / load

  private async buildSave(): Promise<GameSave | null> {
    const s = this.session;
    if (!s) return null;
    const sim = await s.sim.save();
    return {
      version: 1,
      seed: s.seed,
      savedAt: Date.now(),
      sim,
      player: { x: s.player.x, y: s.player.y, z: s.player.z, facing: s.player.facing },
      camera: { mode: this.camera.mode, yaw: this.camera.yaw, pitch: this.camera.pitch, distance: this.camera.distance },
      timeScale: this.timeScale,
      discovered: [...this.discovered]
    };
  }

  private async saveToSlot(slot: number): Promise<void> {
    try {
      const save = await this.buildSave();
      if (!save) return;
      const pops = [0, 0, 0, 0];
      for (const c of save.sim.creatures) if (c.cause === null) pops[c.sp]++;
      SaveSystem.write(slot, save, { seed: save.seed, savedAt: save.savedAt, day: dayNumber(save.sim.time), hour: formatClock(save.sim.time), populations: pops });
      this.hud.toast(`Saved to slot ${slot}`);
      this.audio?.blip(990);
      this.menus.renderSlots();
    } catch (err) {
      this.showError(err);
    }
  }

  private async loadSave(save: GameSave): Promise<void> {
    const s = this.session;
    if (s && s.seed === save.seed && this.state !== 'loading') {
      // same island: restore in place without regenerating
      s.sim.load(save.sim);
      s.player.teleport(save.player.x, save.player.z);
      s.player.facing = save.player.facing;
      this.discovered = new Set(save.discovered);
      this.hud.setJournal(this.discovered);
      this.camera.yaw = save.camera.yaw;
      this.camera.pitch = save.camera.pitch;
      this.select(null);
      this.followId = null;
      this.camera.setMode('third');
      this.timeScale = save.timeScale;
      this.hud.setTimeScale(this.timeScale);
      this.lastLightning = -1;
      this.hud.toast(`Loaded day ${dayNumber(save.sim.time)} ${formatClock(save.sim.time)}`);
      if (this.state === 'paused') this.resume();
      else s.sim.setTimeScale(this.timeScale);
      return;
    }
    this.menus.showPause(false);
    await this.startWorld(save.seed, save);
  }

  // ------------------------------------------------------------------ selection

  private select(id: number | null): void {
    this.selectedId = id;
    this.session?.sim.select(id);
    if (this.session) this.session.creatures.selectedId = id;
    this.inspector.setVisible(id !== null);
    if (id === null && this.followId !== null) this.stopFollowing();
    else if (id !== null && this.followId !== null) this.followId = id;
    this.inspector.setFollowing(this.followId !== null);
    if (id === null) this.selectedDetail = null;
  }

  private toggleFollow(): void {
    if (this.selectedId === null) return;
    if (this.followId !== null) this.stopFollowing();
    else {
      this.followId = this.selectedId;
      this.thirdPersonDistance = this.camera.distance;
      this.camera.setMode('follow');
      if (this.session) this.camera.distance = this.session.creatures.viewDistance(this.followId);
    }
    this.inspector.setFollowing(this.followId !== null);
  }

  private stopFollowing(): void {
    if (this.followId === null) return;
    this.followId = null;
    this.camera.setMode('third');
    this.camera.distance = this.thirdPersonDistance;
    this.inspector.setFollowing(false);
  }

  private inspect(id: number): void {
    const s = this.session;
    if (!s) return;
    const c = s.creatures.creatures.get(id);
    if (!c) return;
    this.select(id);
    this.audio?.blip(780);
    if (!this.discovered.has(c.species)) {
      this.discovered.add(c.species);
      this.hud.setJournal(this.discovered);
      const def = SPECIES[c.species];
      this.hud.toast(`📖 New species recorded: ${def.name}`, 3);
      if (this.discovered.size === SPECIES_COUNT) {
        this.hud.info('Field journal complete — every species on the island has been documented!');
      }
    }
  }

  // ------------------------------------------------------------------ main loop

  private update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    this.frameMs = this.frameMs * 0.95 + dt * 1000 * 0.05;
    const s = this.session;
    if (!s) {
      // title backdrop: slow orbit
      this.input.endFrame();
      return;
    }
    const playing = this.state === 'playing';
    this.handleKeys();

    // --- player & physics
    const look = playing && (this.input.locked || (this.cursorMode && this.input.rightDrag));
    const controlPlayer = playing && this.camera.mode === 'third';
    if (playing || this.state === 'map') {
      s.player.update(dt, this.input, this.camera.yawRad, controlPlayer);
      this.updateProxies(s);
      s.physics.update(dt);
      this.updateStones(s);
    }
    this.throwCooldown -= dt;
    this.throwAnim = Math.max(0, this.throwAnim - dt * 3);
    s.avatar.update(dt, s.player.x, s.player.feetY, s.player.z, s.player.facing, s.player.speed, s.player.grounded, s.player.swimming, this.throwAnim);

    // --- sim interpolation
    const scale = playing || this.state === 'map' ? this.timeScale : 0;
    const now = performance.now() / 1000;
    if (this.lastSnapshot) {
      this.renderTime = this.lastSnapshot.time + Math.min(now - this.snapshotAt, 0.25) * scale;
    }
    s.creatures.update(dt, this.camera.position.x, this.camera.position.z, scale);

    // --- camera
    const target = new pc.Vec3(s.player.x, s.player.y + 0.75, s.player.z);
    if (this.camera.mode === 'follow' && this.followId !== null) {
      const c = s.creatures.creatures.get(this.followId);
      if (c) target.set(c.x, c.y + 0.5 + SPECIES[c.species].radius, c.z);
      else this.select(null);
    }
    this.camera.update(dt, this.input, target, s.physics, s.query, look);
    s.avatar.visible = this.camera.mode !== 'third' || this.camera.distance > 1.6;
    const cam = this.camera.position;

    // --- environment
    s.env.update(dt, this.renderTime, this.weather, cam);
    s.terrain.update(dt, this.weather.wind, this.weather.windDir);
    s.terrain.followCamera(cam.x, cam.z);
    s.vegetation.update(cam.x, cam.z);
    const ground = s.query.heightAt(cam.x, cam.z);
    const biome = s.query.biomeAt(cam.x, cam.z);
    const grassy = biome === Biome.Grassland || biome === Biome.Forest || biome === Biome.Marsh || biome === Biome.Savanna;
    s.fx.update(cam, ground, this.weather, s.env.state.isNight, grassy);

    // --- network to sim
    this.playerSendTimer -= dt;
    if (this.playerSendTimer <= 0 && (playing || this.state === 'map')) {
      this.playerSendTimer = 0.1;
      s.sim.setPlayer(s.player.x, s.player.z, this.camera.mode === 'third' ? s.player.speed : 0);
    }

    // --- picking & hints
    this.updatePicking(s, playing);

    // --- audio
    this.updateAudio(s, dt);

    // --- HUD
    this.hud.update(dt);
    this.hud.setClock(this.renderTime, this.weather);
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1;
      s.minimap.drawMini($<HTMLCanvasElement>('minimap'), s.player.x, s.player.z, this.camera.yawRad, s.creatures.creatures.values(), this.selectedId);
      if (this.state === 'map') this.drawBigMap();
    }
    this.debugTimer -= dt;
    if (this.debugTimer <= 0) {
      this.debugTimer = 0.25;
      this.updateDebug(s);
    }
    this.input.endFrame();
  }

  private handleKeys(): void {
    const i = this.input;
    const s = this.session!;
    if (this.state === 'map') {
      if (i.pressed('KeyM')) this.toggleMap();
      return;
    }
    if (this.state !== 'playing') {
      if (i.pressed('KeyP') && this.state === 'paused') this.resume();
      return;
    }
    if (i.pressed('KeyP') || i.pressed('Escape')) this.pause();
    if (i.pressed('KeyM')) this.toggleMap();
    if (i.pressed('F3')) {
      this.debug.toggle();
      this.menus.setDebugChecked(this.debug.visible);
    }
    if (i.pressed('KeyH')) {
      this.hudVisible = !this.hudVisible;
      show(this.hud.root, this.hudVisible);
    }
    if (i.pressed('Tab')) {
      this.cursorMode = !this.cursorMode;
      if (this.cursorMode) {
        this.intentionalUnlock = this.input.locked;
        this.input.exitLock();
        this.hud.toast('Cursor mode — click creatures, right-drag to look, Tab to return');
      } else this.input.requestLock();
    }
    if (i.pressed('KeyV')) {
      const next: CameraMode = this.camera.mode === 'third' ? 'free' : 'third';
      this.stopFollowing();
      this.camera.setMode(next);
      this.hud.toast(next === 'free' ? 'Free camera — WASD, Q/E, Shift for speed' : 'Third-person camera');
    }
    TIME_SCALES.forEach((v, k) => {
      if (i.pressed(`Digit${k}`)) this.setTimeScale(v);
    });
    if (i.pressed('BracketLeft') || i.pressed('BracketRight')) {
      const idx = TIME_SCALES.indexOf(this.timeScale);
      const next = clamp(idx + (i.pressed('BracketRight') ? 1 : -1), 0, TIME_SCALES.length - 1);
      this.setTimeScale(TIME_SCALES[next]);
    }
    if (i.pressed('F5')) void this.saveToSlot(1);
    if (i.pressed('F9')) {
      try {
        const save = SaveSystem.read(1);
        if (save) void this.loadSave(save);
        else this.hud.toast('Slot 1 is empty');
      } catch (err) {
        this.showError(err);
      }
    }
    if (i.pressed('KeyF')) this.throwStone(s);
    if (i.pressed('KeyE')) this.tryInspectCrosshair(s);
    for (const click of i.clicks) {
      if (click.button === 2 && this.input.locked) this.throwStone(s);
      if (click.button !== 0) continue;
      if (this.input.locked) this.tryInspectCrosshair(s);
      else if (this.cursorMode) {
        const id = this.pickAtScreen(s, click.x, click.y);
        if (id !== null) this.inspect(id);
      }
    }
  }

  private crosshairRay(): { origin: pc.Vec3; dir: pc.Vec3 } {
    return { origin: this.camera.entity.getPosition().clone(), dir: this.camera.entity.forward.clone() };
  }

  private pickAtScreen(s: WorldSession, x: number, y: number): number | null {
    const cam = this.camera.entity.camera!;
    const far = cam.screenToWorld(x, y, 200);
    const origin = this.camera.entity.getPosition().clone();
    const dir = far.sub(origin).normalize();
    return s.creatures.pick(origin, dir, 120);
  }

  private tryInspectCrosshair(s: WorldSession): void {
    const { origin, dir } = this.crosshairRay();
    const id = s.creatures.pick(origin, dir, 90);
    if (id !== null) this.inspect(id);
  }

  private updatePicking(s: WorldSession, playing: boolean): void {
    this.hud.setCrosshairVisible(playing && this.input.locked);
    if (!playing || !this.input.locked) {
      this.hud.hint(this.cursorMode && playing ? 'Cursor mode · Tab to look around' : '', false);
      this.hud.setMode(this.modeLabel());
      return;
    }
    const { origin, dir } = this.crosshairRay();
    const id = s.creatures.pick(origin, dir, 90);
    if (id !== null) {
      const c = s.creatures.creatures.get(id)!;
      const def = SPECIES[c.species];
      const known = this.discovered.has(c.species);
      this.hud.hint(`${known ? def.name : 'Unknown creature'}${c.anim === Anim.Dead ? ' (carcass)' : ''} — click or E to inspect`, true);
    } else this.hud.hint('', false);
    this.hud.setMode(this.modeLabel());
  }

  private modeLabel(): string {
    const cam = this.camera.mode === 'third' ? 'Third-person' : this.camera.mode === 'free' ? 'Free camera' : 'Following';
    return `${cam} · ${this.timeScale === 0 ? 'sim paused' : `time ×${this.timeScale}`} · Esc menu`;
  }

  // ------------------------------------------------------------------ stones & proxies

  private throwStone(s: WorldSession): void {
    if (this.throwCooldown > 0) return;
    this.throwCooldown = 0.45;
    this.throwAnim = 1;
    const fwd = this.camera.entity.forward;
    let from: { x: number; y: number; z: number };
    if (this.camera.mode === 'third') {
      from = { x: s.player.x + Math.sin(s.player.facing) * 0.4, y: s.player.y + 0.9, z: s.player.z + Math.cos(s.player.facing) * 0.4 };
      s.player.facing = Math.atan2(fwd.x, fwd.z);
    } else {
      const p = this.camera.position;
      from = { x: p.x + fwd.x, y: p.y + fwd.y, z: p.z + fwd.z };
    }
    const speed = 17;
    const stone = s.physics.throwStone(from, { x: fwd.x * speed, y: fwd.y * speed + 3.5, z: fwd.z * speed });
    const e = new pc.Entity('Stone');
    e.addComponent('render', { type: 'sphere', material: this.stoneMaterial, castShadows: true });
    e.setLocalScale(0.26, 0.22, 0.26);
    this.app.root.addChild(e);
    s.stones.set(stone, e);
    this.audio?.footstep('rock', 3);
  }

  private updateStones(s: WorldSession): void {
    for (const [stone, e] of s.stones) {
      if (!s.physics.stones.includes(stone) || stone.age > 25) {
        if (s.physics.stones.includes(stone)) s.physics.removeStone(stone);
        e.destroy();
        s.stones.delete(stone);
        continue;
      }
      const p = stone.body.translation();
      const r = stone.body.rotation();
      e.setPosition(p.x, p.y, p.z);
      e.setRotation(r.x, r.y, r.z, r.w);
      const v = stone.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (!stone.hit && speed > this.stoneHitSpeed) {
        for (const c of s.creatures.creatures.values()) {
          if (c.anim === Anim.Dead) continue;
          const r2 = (SPECIES[c.species].radius * c.growth + 0.5) ** 2;
          const dy = p.y - (c.y + SPECIES[c.species].radius);
          if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 + dy * dy < r2 * 2) {
            stone.hit = true;
            s.sim.scare(c.x, c.z, 14);
            this.hud.toast(`Bonk! The ${SPECIES[c.species].name.toLowerCase()} bolts`);
            this.audio?.call(c.species === Species.Rabbit ? 'squeak' : c.species === Species.Deer ? 'bellow' : 'bark', 0, 10);
            break;
          }
        }
      }
      if (!stone.landed && stone.age > 0.2 && speed < 2) {
        stone.landed = true;
        s.sim.scare(p.x, p.z, 7);
      }
      if (p.y < -30) stone.age = 99;
    }
  }

  private updateProxies(s: WorldSession): void {
    const px = s.player.x;
    const pz = s.player.z;
    const list: Array<{ x: number; y: number; z: number; r: number; d: number }> = [];
    for (const c of s.creatures.creatures.values()) {
      if (c.anim === Anim.Dead) continue;
      const d = (c.x - px) ** 2 + (c.z - pz) ** 2;
      if (d > 45 * 45) continue;
      list.push({ x: c.x, y: c.y, z: c.z, r: Math.max(0.2, SPECIES[c.species].radius * c.growth), d });
    }
    list.sort((a, b) => a.d - b.d);
    s.physics.setProxies(list);
  }

  // ------------------------------------------------------------------ audio

  private footstep(speed: number): void {
    const s = this.session;
    if (!s || !this.audio) return;
    const p = s.player;
    const b = s.query.biomeAt(p.x, p.z);
    const wet = s.query.waterAt(p.x, p.z) > p.feetY + 0.05;
    this.audio.footstep(wet ? 'water' : b === Biome.Beach ? 'sand' : b === Biome.Rock || b === Biome.Snow ? 'rock' : 'grass', speed);
  }

  private updateAudio(s: WorldSession, dt: number): void {
    if (!this.audio) return;
    const cam = this.camera.position;
    let forest = 0;
    for (const [ox, oz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) {
      const b = s.query.biomeAt(cam.x + ox, cam.z + oz);
      if (b === Biome.Forest || b === Biome.Taiga) forest += 0.2;
    }
    this.audio.update(dt, {
      daylight: s.env.state.daylight,
      rain: this.weather.rain,
      wind: this.weather.wind,
      oceanDist: s.query.oceanDistAt(cam.x, cam.z),
      freshDist: s.query.freshDistAt(cam.x, cam.z),
      forest,
      altitude: cam.y,
      underwater: cam.y < s.query.waterAt(cam.x, cam.z),
      paused: this.state === 'paused' || this.state === 'loading'
    });
    // occasional animal calls from creatures near the listener
    if (this.state !== 'playing') return;
    this.callTimer -= dt;
    if (this.callTimer > 0) return;
    this.callTimer = 1 + Math.random() * 3;
    const night = s.env.state.isNight;
    const right = this.camera.entity.right;
    for (const c of s.creatures.creatures.values()) {
      if (c.anim === Anim.Dead || c.anim === Anim.Sleep) continue;
      const dx = c.x - cam.x;
      const dz = c.z - cam.z;
      const d = Math.hypot(dx, dz);
      if (d > 130) continue;
      let kind: 'howl' | 'bark' | 'squeak' | 'bellow' | null = null;
      if (c.species === Species.Wolf && night && Math.random() < 0.08) kind = 'howl';
      else if (c.species === Species.Fox && Math.random() < 0.02) kind = 'bark';
      else if (c.species === Species.Deer && Math.random() < 0.006) kind = 'bellow';
      else if (c.species === Species.Rabbit && c.speed > 4 && Math.random() < 0.05) kind = 'squeak';
      if (!kind) continue;
      const pan = (dx * right.x + dz * right.z) / Math.max(d, 1);
      this.audio.call(kind, pan, d);
      break;
    }
  }

  // ------------------------------------------------------------------ debug

  private countEntities(): void {
    let n = 0;
    const walk = (e: pc.GraphNode) => {
      n++;
      for (const c of e.children) walk(c);
    };
    walk(this.app.root);
    this.entityCount = n;
  }

  private updateDebug(s: WorldSession): void {
    const snap = this.lastSnapshot;
    if (Math.random() < 0.1) this.countEntities();
    const stats = this.app.stats as unknown as { drawCalls: { total: number } };
    this.debug.update({
      fps: this.fps,
      frameMs: this.frameMs,
      drawCalls: stats.drawCalls?.total ?? 0,
      triangles: s.terrain.triangles,
      sceneEntities: this.entityCount,
      creatures: s.creatures.creatures.size,
      populations: snap?.populations ?? [0, 0, 0, 0],
      tick: snap?.tick ?? 0,
      timeScale: this.state === 'paused' ? 0 : this.timeScale,
      ticksPerSecond: snap?.ticksPerSecond ?? 0,
      msPerTick: snap?.msPerTick ?? 0,
      seed: s.seed,
      physicsBodies: s.physics.bodyCount,
      physicsColliders: s.physics.colliderCount,
      vegetation: s.vegetation.instanceCount,
      particles: s.fx.activeParticleSystems,
      food: snap?.foodLevel ?? 0,
      births: snap ? snap.stats.births.reduce((a, b) => a + b, 0) : 0,
      deaths: snap?.stats.deaths ?? {},
      camera: this.camera.mode,
      position: `${s.player.x.toFixed(0)}, ${s.player.y.toFixed(1)}, ${s.player.z.toFixed(0)} @${hourOfDay(this.renderTime).toFixed(1)}h`
    });
  }

  /** For automated tests / console poking. */
  get debugState(): Record<string, unknown> {
    const s = this.session;
    return {
      state: this.state,
      seed: s?.seed,
      tick: this.lastSnapshot?.tick,
      creatures: s?.creatures.creatures.size,
      populations: this.lastSnapshot?.populations,
      bodies: s?.physics.bodyCount,
      player: s ? [s.player.x, s.player.y, s.player.z] : null,
      selected: this.selectedDetail?.name ?? null
    };
  }

  /** Default seed used when the title screen is skipped via ?autostart. */
  static randomSeed(): string {
    return randomSeed();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
