import type { CreatureDetail } from '../sim/Ecosystem';
import { SPECIES } from '../sim/species';
import { $, show } from './dom';

/** Panel showing the live state of the selected creature. */
export class Inspector {
  private root = $('inspector');
  onClose: () => void = () => {};
  onFollow: () => void = () => {};

  constructor() {
    $('insp-close').addEventListener('click', () => this.onClose());
    $('insp-follow').addEventListener('click', (e) => {
      this.onFollow();
      (e.currentTarget as HTMLElement).blur();
    });
  }

  setVisible(v: boolean): void {
    show(this.root, v);
  }

  setFollowing(following: boolean): void {
    $('insp-follow').textContent = following ? '🎥 Stop following' : '🎥 Follow';
  }

  update(d: CreatureDetail): void {
    const def = SPECIES[d.species];
    $('insp-name').textContent = d.name;
    const sex = d.sex === 0 ? '♀' : '♂';
    $('insp-sub').textContent = `${def.name} ${sex} · ${d.mature ? 'adult' : 'juvenile'} · ${def.diet}`;
    $('insp-state').textContent = d.cause ? `Dead — ${d.cause}` : d.state;
    this.bar('bar-hunger', d.hunger, true);
    this.bar('bar-thirst', d.thirst, true);
    this.bar('bar-energy', d.energy, false);
    this.bar('bar-health', d.health, false);
    this.bar('bar-age', d.ageDays / d.lifespanDays, true, 0.85);
    const facts: Array<[string, string]> = [
      ['Age', `${d.ageDays.toFixed(1)} / ${d.lifespanDays.toFixed(1)} days`],
      ['Generation', String(d.generation)],
      ['Offspring', String(d.children)],
      ['Parent', d.motherName ?? '— (founder)'],
      ['Position', `${d.x.toFixed(0)}, ${d.z.toFixed(0)}`]
    ];
    if (def.diet === 'carnivore') facts.splice(3, 0, ['Kills', String(d.kills)]);
    if (d.pregnant) facts.push(['Status', 'Expecting young']);
    $('insp-facts').innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  private bar(id: string, v: number, highIsBad: boolean, warnAt = 0.6): void {
    const el = $(id);
    const x = Math.max(0, Math.min(1, v));
    el.style.width = `${(x * 100).toFixed(0)}%`;
    const badness = highIsBad ? x : 1 - x;
    el.className = badness > 0.85 ? 'bad' : badness > warnAt ? 'warn' : '';
  }
}
