/**
 * The water's sound, synthesized: no samples to load. A drop is a bubble ringing as it is trapped under the surface:
 * a sine at the bubble's resonance (Minnaert: about 3.26 Hz·m over its radius, so a 2 mm bubble rings near 1.6 kHz),
 * rising in pitch as it nears the surface and dying in a few hundredths of a second, with a short tick where the drop
 * hits. A letter landing is a few bubbles and a splash of filtered noise. A word dragged through the water is a soft
 * low lap that follows its speed. Everything is panned to where it happens. Off until the visitor turns it on (a
 * browser only starts audio after a gesture, and a page shouldn't make sound unasked).
 */
export type Sound = {
  /** Turn sound on or off; the first `true` must come from a click or key press. */
  enable: (on: boolean) => void;
  readonly on: boolean;
  /** A drop at x (0..1 across the screen); size 0..1. */
  drop: (x: number, size?: number) => void;
  /** A letter landing at x. */
  splash: (x: number) => void;
  /** The wake while something moves: speed in screen widths per second (0 = still), at x. */
  wake: (speed: number, x: number) => void;
  dispose: () => void;
};

export function createSound(): Sound {
  let ctx: AudioContext | null = null, out: GainNode | null = null, noise: AudioBuffer | null = null;
  let lap: { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; filter: BiquadFilterNode } | null = null;
  let on = false;

  const setup = () => {
    if (ctx) return;
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    out = ctx.createGain(); out.gain.value = 0.6;
    out.connect(comp); comp.connect(ctx.destination);
    // two seconds of white noise, looped and filtered for splashes and the lap
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 500; filter.Q.value = 0.7;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(out); src.start();
    lap = { src, gain, pan, filter };
  };

  // One bubble: radius in mm sets the pitch; it rises about 40 % as it surfaces.
  const bubble = (at: number, x: number, radius: number, level: number) => {
    if (!ctx || !out) return;
    const f = Math.min(4000, 3260 / radius);
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    o.type = "sine";
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 1.4, at + 0.05);
    const decay = 0.02 + radius * 0.012;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay * 4);
    p.pan.value = Math.max(-1, Math.min(1, x * 2 - 1)) * 0.7;
    o.connect(g); g.connect(p); p.connect(out);
    o.start(at); o.stop(at + decay * 4 + 0.02);
  };
  // A burst of filtered noise: the tick of an impact, or a splash.
  const burst = (at: number, x: number, hz: number, q: number, level: number, len: number) => {
    if (!ctx || !out || !noise) return;
    const s = ctx.createBufferSource(); s.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = hz; bp.Q.value = q;
    const g = ctx.createGain(), p = ctx.createStereoPanner();
    g.gain.setValueAtTime(level, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    p.pan.value = Math.max(-1, Math.min(1, x * 2 - 1)) * 0.7;
    s.connect(bp); bp.connect(g); g.connect(p); p.connect(out);
    s.start(at, Math.random() * 1.5, len + 0.02);
  };

  return {
    get on() { return on; },
    enable(v) {
      on = v;
      if (v) { setup(); void ctx?.resume(); }
      else if (lap && ctx) lap.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
    drop(x, size = 0.5) {
      if (!on || !ctx) return;
      const at = ctx.currentTime + 0.005;
      burst(at, x, 3500, 1.2, 0.05 + size * 0.05, 0.02);
      bubble(at + 0.008, x, 1.4 + size * 2.6 + Math.random() * 0.6, 0.18 + size * 0.12);
    },
    splash(x) {
      if (!on || !ctx) return;
      const at = ctx.currentTime + 0.005;
      burst(at, x, 1800, 0.8, 0.16, 0.12);
      for (let i = 0; i < 3; i++) bubble(at + 0.012 + Math.random() * 0.06, x + (Math.random() - 0.5) * 0.08, 1.2 + Math.random() * 3.5, 0.08 + Math.random() * 0.08);
    },
    wake(speed, x) {
      if (!on || !ctx || !lap) return;
      const t = ctx.currentTime, k = Math.min(1, speed / 1.5);
      lap.gain.gain.setTargetAtTime(k * 0.22, t, 0.08);
      lap.filter.frequency.setTargetAtTime(350 + k * 700, t, 0.1);
      lap.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x * 2 - 1)) * 0.6, t, 0.1);
    },
    dispose() { lap?.src.stop(); void ctx?.close(); ctx = null; },
  };
}
