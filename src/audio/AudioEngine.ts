import { clamp } from '../core/math';

export interface AudioParams {
  daylight: number;
  rain: number;
  wind: number;
  /** Metres from listener to the ocean shoreline. */
  oceanDist: number;
  /** Metres from listener to fresh water. */
  freshDist: number;
  /** 0..1 how forested the surroundings are. */
  forest: number;
  /** Listener altitude in metres. */
  altitude: number;
  underwater: boolean;
  paused: boolean;
}

/**
 * Fully procedural environmental audio with the Web Audio API: wind, rain,
 * surf, streams, birdsong, crickets, thunder, footsteps and animal calls.
 * No audio assets are required.
 */
export class AudioEngine {
  private ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;
  private wind: { gain: GainNode; filter: BiquadFilterNode };
  private rain: GainNode;
  private surf: { gain: GainNode; filter: BiquadFilterNode };
  private stream: GainNode;
  private crickets: GainNode;
  private birdTimer = 1;
  private t = 0;
  private volume = 0.7;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.noise = this.makeNoise(3);

    // wind: low-passed noise with slowly wandering cutoff
    const windSrc = this.loop();
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.8;
    const windGain = this.ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(this.master);
    this.wind = { gain: windGain, filter: windFilter };

    // rain: band of high-frequency hiss
    const rainSrc = this.loop();
    const rainHp = this.ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 900;
    const rainLp = this.ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 7000;
    this.rain = this.ctx.createGain();
    this.rain.gain.value = 0;
    rainSrc.connect(rainHp).connect(rainLp).connect(this.rain).connect(this.master);

    // surf: low rumbling noise swelling like waves
    const surfSrc = this.loop();
    const surfFilter = this.ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 500;
    const surfGain = this.ctx.createGain();
    surfGain.gain.value = 0;
    surfSrc.connect(surfFilter).connect(surfGain).connect(this.master);
    this.surf = { gain: surfGain, filter: surfFilter };

    // stream: bubbly band-passed noise
    const streamSrc = this.loop();
    const streamBp = this.ctx.createBiquadFilter();
    streamBp.type = 'bandpass';
    streamBp.frequency.value = 1800;
    streamBp.Q.value = 0.6;
    this.stream = this.ctx.createGain();
    this.stream.gain.value = 0;
    streamSrc.connect(streamBp).connect(this.stream).connect(this.master);

    // crickets: high sine chopped by a square LFO
    const cricketOsc = this.ctx.createOscillator();
    cricketOsc.frequency.value = 4400;
    const chop = this.ctx.createGain();
    chop.gain.value = 0;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 28;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(chop.gain);
    const slow = this.ctx.createOscillator();
    slow.frequency.value = 0.7;
    const slowGain = this.ctx.createGain();
    slowGain.gain.value = 0.5;
    slow.connect(slowGain).connect(chop.gain);
    this.crickets = this.ctx.createGain();
    this.crickets.gain.value = 0;
    cricketOsc.connect(chop).connect(this.crickets).connect(this.master);
    cricketOsc.start();
    lfo.start();
    slow.start();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // slightly pinkish noise
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w;
      d[i] = w * 0.6 + b * 3;
    }
    return buf;
  }

  private loop(): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 2);
    return s;
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  getVolume(): number {
    return this.volume;
  }

  update(dt: number, p: AudioParams): void {
    this.t += dt;
    const now = this.ctx.currentTime;
    const set = (g: AudioParam, v: number) => g.setTargetAtTime(p.paused ? 0 : v, now, 0.25);
    const muffle = p.underwater ? 0.25 : 1;
    const gust = 0.6 + 0.4 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11);
    set(this.wind.gain.gain, (0.04 + p.wind * 0.22 + clamp(p.altitude / 80, 0, 1) * 0.1) * gust * muffle);
    this.wind.filter.frequency.setTargetAtTime(250 + p.wind * 700 * gust, now, 0.3);
    set(this.rain.gain, p.rain * 0.32 * muffle);
    const surfNear = clamp(1 - p.oceanDist / 70, 0, 1);
    const swell = 0.55 + 0.45 * Math.sin(this.t * 0.55);
    set(this.surf.gain.gain, surfNear * (0.15 + p.wind * 0.12) * swell);
    this.surf.filter.frequency.setTargetAtTime(300 + swell * 500, now, 0.2);
    set(this.stream.gain, clamp(1 - p.freshDist / 25, 0, 1) * 0.12);
    const night = 1 - p.daylight;
    set(this.crickets.gain, night > 0.6 && p.rain < 0.1 ? 0.012 * (1 - p.forest * 0.4) * muffle : 0);

    // birdsong in daylight, more in forests, none in rain
    if (!p.paused && p.daylight > 0.5 && p.rain < 0.15) {
      this.birdTimer -= dt * (0.5 + p.forest * 1.5);
      if (this.birdTimer <= 0) {
        this.birdTimer = 0.6 + Math.random() * 3;
        this.chirp(Math.random() * 2 - 1, 0.03 + Math.random() * 0.04);
      }
    }
  }

  private chirp(pan: number, vol: number): void {
    const now = this.ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 2400;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);
    for (let i = 0; i < notes; i++) {
      const t0 = now + i * (0.09 + Math.random() * 0.05);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.frequency.setValueAtTime(base * (1 + Math.random() * 0.3), t0);
      osc.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.8), t0 + 0.07);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      osc.connect(g).connect(panner);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    }
  }

  /** Thunder rumble, delayed by distance (speed of sound). */
  thunder(distance: number): void {
    const delay = clamp(distance / 343, 0.1, 4);
    const now = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(90, now + 2.5);
    const g = this.ctx.createGain();
    const vol = clamp(1.2 - distance / 900, 0.25, 1);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + 3.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(now, Math.random());
    src.stop(now + 3.6);
  }

  footstep(surface: 'grass' | 'sand' | 'rock' | 'water', speed: number): void {
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = surface === 'water' ? 'lowpass' : 'bandpass';
    f.frequency.value = { grass: 1500, sand: 900, rock: 2500, water: 700 }[surface];
    f.Q.value = surface === 'rock' ? 2 : 0.7;
    const g = this.ctx.createGain();
    const v = (surface === 'water' ? 0.18 : 0.08) * clamp(speed / 5, 0.5, 1.5);
    g.gain.setValueAtTime(v, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (surface === 'water' ? 0.25 : 0.09));
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 2);
    src.stop(now + 0.3);
  }

  splash(): void {
    this.footstep('water', 9);
  }

  /** Short UI / interaction blip. */
  blip(freq = 880): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.08);
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  /** Animal call positioned by stereo pan and distance attenuation. */
  call(kind: 'howl' | 'bark' | 'squeak' | 'bellow', pan: number, distance: number): void {
    const vol = clamp(1 - distance / 140, 0, 1) * 0.12;
    if (vol <= 0.002) return;
    const now = this.ctx.currentTime;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000 - clamp(distance / 140, 0, 1) * 3000;
    panner.connect(lp).connect(this.master);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.connect(g).connect(panner);
    const vib = this.ctx.createOscillator();
    const vibGain = this.ctx.createGain();
    vib.connect(vibGain).connect(osc.frequency);
    let dur = 0.3;
    switch (kind) {
      case 'howl':
        dur = 2.6;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(380, now);
        osc.frequency.linearRampToValueAtTime(620, now + 0.6);
        osc.frequency.linearRampToValueAtTime(560, now + 1.8);
        osc.frequency.linearRampToValueAtTime(420, now + dur);
        vib.frequency.value = 5;
        vibGain.gain.value = 9;
        lp.frequency.value = Math.min(lp.frequency.value, 1400);
        break;
      case 'bark':
        dur = 0.18;
        osc.type = 'square';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(380, now + dur);
        lp.frequency.value = Math.min(lp.frequency.value, 1800);
        break;
      case 'squeak':
        dur = 0.12;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2400, now);
        osc.frequency.exponentialRampToValueAtTime(3200, now + dur);
        break;
      case 'bellow':
        dur = 0.9;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(330, now + 0.3);
        osc.frequency.linearRampToValueAtTime(180, now + dur);
        lp.frequency.value = Math.min(lp.frequency.value, 900);
        break;
    }
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + Math.min(0.2, dur * 0.3));
    g.gain.setValueAtTime(vol, now + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.start(now);
    vib.start(now);
    osc.stop(now + dur + 0.05);
    vib.stop(now + dur + 0.05);
  }

  dispose(): void {
    void this.ctx.close();
  }
}
