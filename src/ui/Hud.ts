import type { SimEvent } from '../sim/Ecosystem';
import { SPECIES, SPECIES_COUNT, Species } from '../sim/species';
import { dayNumber, formatClock } from '../sim/time';
import { WEATHER_NAMES, type WeatherState } from '../sim/Weather';
import { $, escapeHtml } from './dom';

const WEATHER_ICONS = ['☀️', '☁️', '🌧️', '⛈️', '🌫️'];

/** Clock, weather, time controls, event feed, journal, hints and toasts. */
export class Hud {
  readonly root = $('hud');
  private feed = $('event-feed');
  private toastEl = $('toast');
  private hintEl = $('hint');
  private crosshair = $('crosshair');
  private toastTimer = 0;
  private scaleButtons: HTMLButtonElement[];
  onTimeScale: (scale: number) => void = () => {};

  constructor() {
    this.scaleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#time-controls button'));
    for (const b of this.scaleButtons) {
      b.addEventListener('click', (e) => {
        this.onTimeScale(Number(b.dataset.scale));
        (e.currentTarget as HTMLElement).blur();
      });
    }
  }

  setClock(time: number, weather: WeatherState): void {
    $('clock-day').textContent = `Day ${dayNumber(time)}`;
    $('clock-hm').textContent = formatClock(time);
    const wind = weather.wind > 0.7 ? ' · gale' : weather.wind > 0.4 ? ' · windy' : '';
    $('clock-weather').textContent = `${WEATHER_ICONS[weather.kind]} ${WEATHER_NAMES[weather.kind]}${wind}`;
  }

  setTimeScale(scale: number): void {
    for (const b of this.scaleButtons) b.classList.toggle('active', Number(b.dataset.scale) === scale);
  }

  pushEvents(events: SimEvent[], formatTime: (t: number) => string): void {
    for (const e of events) {
      const div = document.createElement('div');
      div.className = `ev ${e.kind}`;
      div.innerHTML = `<span class="t">${formatTime(e.time)}</span>${escapeHtml(e.text)}`;
      this.feed.appendChild(div);
      setTimeout(() => (div.style.opacity = '0'), 11000);
      setTimeout(() => div.remove(), 12000);
    }
    while (this.feed.children.length > 6) this.feed.firstElementChild!.remove();
  }

  info(text: string): void {
    this.pushEvents([{ seq: 0, time: -1, kind: 'info', text }], () => '');
  }

  toast(text: string, seconds = 2.2): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  hint(text: string, targeted: boolean): void {
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
    this.crosshair.classList.toggle('target', targeted);
  }

  setCrosshairVisible(v: boolean): void {
    this.crosshair.style.display = v ? '' : 'none';
  }

  setMode(text: string): void {
    $('mode-indicator').textContent = text;
  }

  setJournal(discovered: Set<number>): void {
    $('journal-count').textContent = `${discovered.size}/${SPECIES_COUNT}`;
    let html = '';
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const def = SPECIES[s as Species];
      const found = discovered.has(s);
      html += `<div class="${found ? 'found' : ''}"><span><i class="dot" style="background:${def.color}"></i>${found ? def.name : '???'}</span><span>${found ? '✓' : ''}</span></div>`;
    }
    $('journal-list').innerHTML = html;
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
