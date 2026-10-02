import { SPECIES, SPECIES_COUNT, Species } from '../sim/species';
import { $, show } from './dom';

export interface DebugStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  sceneEntities: number;
  creatures: number;
  populations: number[];
  tick: number;
  timeScale: number;
  ticksPerSecond: number;
  msPerTick: number;
  seed: number;
  physicsBodies: number;
  physicsColliders: number;
  vegetation: number;
  particles: number;
  food: number;
  births: number;
  deaths: Record<string, number>;
  camera: string;
  position: string;
}

/** Engine / simulation diagnostics with a live population graph. */
export class DebugPanel {
  private root = $('debug');
  private table = $('debug-table');
  private graph = $<HTMLCanvasElement>('pop-graph');
  visible = false;

  constructor() {
    $('pop-legend').innerHTML = Object.values(SPECIES).map((d) => `<span style="--c:${d.color}">${d.plural}</span>`).join('');
  }

  toggle(v = !this.visible): void {
    this.visible = v;
    show(this.root, v);
  }

  update(s: DebugStats): void {
    if (!this.visible) return;
    const pops = s.populations.map((p, i) => `${SPECIES[i as Species].plural.slice(0, 4)} ${p}`);
    const rows: Array<[string, string]> = [
      ['FPS', `${s.fps.toFixed(0)} (${s.frameMs.toFixed(1)} ms)`],
      ['Draw calls', String(s.drawCalls)],
      ['Terrain tris', `${(s.triangles / 1000).toFixed(0)}k`],
      ['Scene entities', String(s.sceneEntities)],
      ['Sim agents', String(s.creatures)],
      ['Populations', pops.join(' · ')],
      ['Sim tick', s.tick.toLocaleString()],
      ['Time scale', s.timeScale === 0 ? 'paused' : `${s.timeScale}×`],
      ['Ticks/s · ms/tick', `${s.ticksPerSecond.toFixed(0)} · ${s.msPerTick.toFixed(3)}`],
      ['Seed', String(s.seed)],
      ['Physics bodies', String(s.physicsBodies)],
      ['Physics colliders', String(s.physicsColliders)],
      ['Vegetation inst.', s.vegetation.toLocaleString()],
      ['Particle systems', String(s.particles)],
      ['Grazing food', `${(s.food * 100).toFixed(0)}%`],
      ['Births / deaths', `${s.births} / ${Object.values(s.deaths).reduce((a, b) => a + b, 0)}`],
      ['Camera', s.camera],
      ['Position', s.position]
    ];
    this.table.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  }

  drawHistory(history: number[][]): void {
    const ctx = this.graph.getContext('2d')!;
    const W = this.graph.width;
    const H = this.graph.height;
    ctx.clearRect(0, 0, W, H);
    if (history.length < 2) return;
    let max = 10;
    for (const h of history) for (const v of h) max = Math.max(max, v);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
      ctx.stroke();
    }
    for (let s = 0; s < SPECIES_COUNT; s++) {
      ctx.strokeStyle = SPECIES[s as Species].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      history.forEach((h, i) => {
        const x = (i / (history.length - 1)) * W;
        const y = H - 3 - (h[s] / max) * (H - 6);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px monospace';
    ctx.fillText(String(max), 3, 10);
  }
}
