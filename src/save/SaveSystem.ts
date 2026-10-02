import type { SimSave } from '../sim/Ecosystem';
import type { CameraMode } from '../player/CameraRig';

export const SAVE_SLOTS = 3;
const PREFIX = 'isle-of-seeds';

export interface GameSave {
  version: 1;
  seed: number;
  savedAt: number;
  sim: SimSave;
  player: { x: number; y: number; z: number; facing: number };
  camera: { mode: CameraMode; yaw: number; pitch: number; distance: number };
  timeScale: number;
  discovered: number[];
}

export interface SaveMeta {
  seed: number;
  savedAt: number;
  day: number;
  hour: string;
  populations: number[];
}

/** LocalStorage save slots plus JSON file export/import. */
export class SaveSystem {
  static meta(slot: number): SaveMeta | null {
    try {
      const raw = localStorage.getItem(`${PREFIX}:meta:${slot}`);
      return raw ? (JSON.parse(raw) as SaveMeta) : null;
    } catch {
      return null;
    }
  }

  static write(slot: number, save: GameSave, meta: SaveMeta): void {
    try {
      localStorage.setItem(`${PREFIX}:slot:${slot}`, JSON.stringify(save));
      localStorage.setItem(`${PREFIX}:meta:${slot}`, JSON.stringify(meta));
    } catch (err) {
      throw new Error(`Could not save (storage full?): ${err instanceof Error ? err.message : err}`);
    }
  }

  static read(slot: number): GameSave | null {
    const raw = localStorage.getItem(`${PREFIX}:slot:${slot}`);
    if (!raw) return null;
    return SaveSystem.validate(JSON.parse(raw));
  }

  static remove(slot: number): void {
    localStorage.removeItem(`${PREFIX}:slot:${slot}`);
    localStorage.removeItem(`${PREFIX}:meta:${slot}`);
  }

  static exportFile(save: GameSave): void {
    const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `isle-of-seeds-${save.seed}-day${Math.floor(save.sim.time / 480) + 1}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  static async importFile(file: File): Promise<GameSave> {
    return SaveSystem.validate(JSON.parse(await file.text()));
  }

  static validate(data: unknown): GameSave {
    const s = data as GameSave;
    if (!s || s.version !== 1 || typeof s.seed !== 'number' || !s.sim || !Array.isArray(s.sim.creatures) || !s.player) {
      throw new Error('Not a valid Isle of Seeds save file');
    }
    return s;
  }
}
