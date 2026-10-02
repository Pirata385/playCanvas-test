import { SAVE_SLOTS, SaveSystem, type GameSave } from '../save/SaveSystem';
import { SPECIES, Species } from '../sim/species';
import { $, escapeHtml, renderHelp, show } from './dom';

export interface Settings {
  volume: number;
  sensitivity: number;
  shadows: boolean;
  debug: boolean;
}

const SETTINGS_KEY = 'isle-of-seeds:settings';

export function loadSettings(): Settings {
  const defaults: Settings = { volume: 0.7, sensitivity: 0.12, shadows: true, debug: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function randomSeed(): string {
  return String(Math.floor(Math.random() * 1e9));
}

/** Title screen, loading screen and pause menu (save slots, world regeneration, settings). */
export class Menus {
  settings = loadSettings();
  onStart: (seedText: string) => void = () => {};
  onLoadSlot: (slot: number) => void = () => {};
  onSaveSlot: (slot: number) => void = () => {};
  onResume: () => void = () => {};
  onRegenerate: () => void = () => {};
  onNewWorld: (seedText: string) => void = () => {};
  onExport: () => void = () => {};
  onImport: (save: GameSave) => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  /** Whether saving is possible (a world is loaded). */
  canSave = false;

  constructor() {
    renderHelp($('help-grid-start'));
    renderHelp($('help-grid-pause'));
    const seedInput = $<HTMLInputElement>('seed-input');
    const params = new URLSearchParams(location.search);
    seedInput.value = params.get('seed') ?? '1337';
    $('seed-random').addEventListener('click', () => (seedInput.value = randomSeed()));
    $('start-button').addEventListener('click', () => this.onStart(seedInput.value || '1337'));
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onStart(seedInput.value || '1337');
    });

    const newSeed = $<HTMLInputElement>('new-seed-input');
    newSeed.value = randomSeed();
    $('new-seed-random').addEventListener('click', () => (newSeed.value = randomSeed()));
    $('btn-newworld').addEventListener('click', () => this.onNewWorld(newSeed.value || randomSeed()));
    $('btn-resume').addEventListener('click', () => this.onResume());
    $('btn-regen').addEventListener('click', () => this.onRegenerate());
    $('btn-export').addEventListener('click', () => this.onExport());
    $<HTMLInputElement>('import-file').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        this.onImport(await SaveSystem.importFile(file));
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });

    const vol = $<HTMLInputElement>('volume');
    const sens = $<HTMLInputElement>('sensitivity');
    const shadows = $<HTMLInputElement>('shadows');
    const debug = $<HTMLInputElement>('show-debug');
    vol.value = String(Math.round(this.settings.volume * 100));
    sens.value = String(Math.round(this.settings.sensitivity * 100));
    shadows.checked = this.settings.shadows;
    debug.checked = this.settings.debug;
    $('vol-label').textContent = `${vol.value}%`;
    const changed = () => {
      this.settings = {
        volume: Number(vol.value) / 100,
        sensitivity: Number(sens.value) / 100,
        shadows: shadows.checked,
        debug: debug.checked
      };
      $('vol-label').textContent = `${vol.value}%`;
      saveSettings(this.settings);
      this.onSettings(this.settings);
    };
    for (const el of [vol, sens, shadows, debug]) el.addEventListener('input', changed);
    this.renderStartSaves();
  }

  /** Reflect a setting changed elsewhere (e.g. F3 toggles debug). */
  setDebugChecked(v: boolean): void {
    $<HTMLInputElement>('show-debug').checked = v;
    this.settings.debug = v;
    saveSettings(this.settings);
  }

  showStart(v: boolean): void {
    show($('start-screen'), v);
    if (v) this.renderStartSaves();
  }

  showLoading(v: boolean, title = 'Generating island…'): void {
    show($('loading-screen'), v);
    $('loading-title').textContent = title;
    if (v) this.progress('Preparing', 0);
  }

  progress(stage: string, f: number): void {
    $('loading-stage').textContent = stage;
    $('loading-bar').style.width = `${Math.round(f * 100)}%`;
  }

  showPause(v: boolean, info = ''): void {
    show($('pause-screen'), v);
    if (v) {
      $('pause-info').textContent = info;
      this.renderSlots();
    }
  }

  renderSlots(): void {
    const el = $('slots');
    let html = '';
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const m = SaveSystem.meta(slot);
      const desc = m
        ? `Seed ${m.seed} · Day ${m.day} ${m.hour}<br><span class="muted">${new Date(m.savedAt).toLocaleString()} · ${popSummary(m.populations)}</span>`
        : '<span class="muted">Empty</span>';
      html += `<div class="slot"><div class="slot-head"><strong>Slot ${slot}</strong></div><div>${desc}</div>
        <div class="slot-actions" style="margin-top:6px">
          <button data-save="${slot}" ${this.canSave ? '' : 'disabled'}>Save</button>
          <button data-load="${slot}" ${m ? '' : 'disabled'}>Load</button>
          <button data-del="${slot}" ${m ? '' : 'disabled'}>Delete</button>
        </div></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll<HTMLButtonElement>('button[data-save]').forEach((b) => b.addEventListener('click', () => this.onSaveSlot(Number(b.dataset.save))));
    el.querySelectorAll<HTMLButtonElement>('button[data-load]').forEach((b) => b.addEventListener('click', () => this.onLoadSlot(Number(b.dataset.load))));
    el.querySelectorAll<HTMLButtonElement>('button[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        if (confirm(`Delete save slot ${b.dataset.del}?`)) {
          SaveSystem.remove(Number(b.dataset.del));
          this.renderSlots();
        }
      })
    );
  }

  private renderStartSaves(): void {
    const el = $('start-saves');
    let html = '';
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const m = SaveSystem.meta(slot);
      if (!m) continue;
      html += `<div class="save-row"><span>Slot ${slot}: seed ${escapeHtml(String(m.seed))}, day ${m.day} ${m.hour}</span><button data-continue="${slot}">Continue</button></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll<HTMLButtonElement>('button[data-continue]').forEach((b) =>
      b.addEventListener('click', () => this.onLoadSlot(Number(b.dataset.continue)))
    );
  }
}

function popSummary(p: number[]): string {
  return p.map((n, i) => `${n} ${SPECIES[i as Species].plural.toLowerCase()}`).join(', ');
}
