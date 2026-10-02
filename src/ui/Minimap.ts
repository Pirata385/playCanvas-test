import { SPECIES, Species } from '../sim/species';
import { BIOMES, Biome, type WorldData } from '../world/types';
import type { RenderCreature } from '../render/CreatureRenderer';

/** Hill-shaded island map rendered to a 2D canvas, used for the HUD minimap and the full map. */
export class Minimap {
  private base: HTMLCanvasElement;
  private size: number;

  constructor(private world: WorldData) {
    this.size = world.size;
    this.base = document.createElement('canvas');
    this.base.width = world.res;
    this.base.height = world.res;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(world.res, world.res);
    img.data.set(world.mapPixels);
    ctx.putImageData(img, 0, 0);
  }

  /** Circular minimap centred on the player, north-up. */
  drawMini(canvas: HTMLCanvasElement, px: number, pz: number, yaw: number, creatures: Iterable<RenderCreature>, selected: number | null): void {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const radius = 95; // metres shown from centre to edge
    const scale = W / 2 / radius;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1b4d6b';
    ctx.fillRect(0, 0, W, W);
    const k = this.world.res / this.size;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, (px - radius) * k, (pz - radius) * k, radius * 2 * k, radius * 2 * k, 0, 0, W, W);
    for (const c of creatures) {
      const dx = (c.x - px) * scale + W / 2;
      const dz = (c.z - pz) * scale + W / 2;
      if (dx < 0 || dz < 0 || dx > W || dz > W) continue;
      ctx.fillStyle = c.anim === 4 ? '#555' : SPECIES[c.species].color;
      ctx.beginPath();
      ctx.arc(dx, dz, c.id === selected ? 4 : c.species === Species.Rabbit ? 2 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (c.id === selected) {
        ctx.strokeStyle = '#f2c14e';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    this.drawPlayer(ctx, W / 2, W / 2, yaw, 7);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 12);
  }

  /** Whole-island map with all creatures. */
  drawFull(canvas: HTMLCanvasElement, px: number, pz: number, yaw: number, creatures: Iterable<RenderCreature>, selected: number | null): void {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    ctx.fillStyle = '#1b4d6b';
    ctx.fillRect(0, 0, W, W);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, W, W);
    const s = W / this.size;
    for (const c of creatures) {
      ctx.fillStyle = c.anim === 4 ? '#444' : SPECIES[c.species].color;
      ctx.beginPath();
      ctx.arc(c.x * s, c.z * s, c.id === selected ? 5 : c.species === Species.Rabbit ? 2 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawPlayer(ctx, px * s, pz * s, yaw, 10);
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, yaw: number, size: number): void {
    ctx.save();
    ctx.translate(x, y);
    // camera yaw 0 looks towards -Z, which is "up" on the map
    ctx.rotate(-yaw);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.65, size * 0.7);
    ctx.lineTo(0, size * 0.35);
    ctx.lineTo(-size * 0.65, size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  static legendHtml(): string {
    const species = Object.values(SPECIES).map((d) => `<span style="--c:${d.color}">${d.plural}</span>`).join('');
    const biomes = [Biome.Beach, Biome.Grassland, Biome.Forest, Biome.Taiga, Biome.Savanna, Biome.Marsh, Biome.Rock, Biome.Snow]
      .map((b) => {
        const [r, g, bl] = BIOMES[b].color;
        return `<span style="--c:rgb(${r * 255},${g * 255},${bl * 255})">${BIOMES[b].name}</span>`;
      })
      .join('');
    return species + biomes;
  }
}
