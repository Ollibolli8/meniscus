import { createWater, type Paint, type Water, type WaterOptions } from "./water";
import { createSound, type Sound } from "./sound";

/**
 * One word floating in the water. Drag it and it pushes the water; let go and it glides on and settles; click it (or
 * tab to it) and type, and each new letter lands with a splash. The word is real, editable text in the page; the
 * water sees it through a mask painted from the same numbers that place it. With sound on (setSound, after a click),
 * a drop rings where you press, a letter lands with a splash, and a dragged word laps the water (sound.ts).
 *
 *   host    the element that holds it all (the pool); elements in it marked [data-calm] get calmer light behind them
 *   canvas  fills the host, under everything
 *   word    an element with contenteditable="plaintext-only" holding the starting word
 */
export type MeniscusOptions = {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  word: HTMLElement;
  /** CSS font family of the word (it must be loaded before the call, so the mask matches the letters). */
  font?: string;
  weight?: number;
  /** Letter spacing in em. */
  tracking?: number;
  /** The most letters the word may have. */
  max?: number;
  /** Motion off: one still frame, and the word moves only while dragged. */
  still?: boolean;
  water?: WaterOptions;
};
export type Meniscus = { water: Water | null; sound: Sound; setStill: (on: boolean) => void; setSound: (on: boolean) => void; dispose: () => void };

export function createMeniscus(o: MeniscusOptions): Meniscus {
  const { host, canvas, word: el } = o;
  const FONT = o.font ?? `"Albert Sans Variable", "Albert Sans", system-ui, sans-serif`;
  const WEIGHT = o.weight ?? 800, TRACK = o.tracking ?? -0.045, MAX = o.max ?? 12;
  let still = !!o.still;
  const start = el.textContent ?? "";
  // where the word is (centre, px in the host), how it moves, and what it says
  const s = { x: 0, y: 0, vx: 0, vy: 0, r: 0, size: 100, text: start, t: 0, bob: 0 };
  let drag: { id: number; dx: number; dy: number; tx: number; ty: number; moved: boolean; x0: number; y0: number } | null = null;
  let calm: { x: number; y: number; w: number; h: number }[] = [];
  let base = 0, sig = "", raf = 0, prev = 0, box = host.getBoundingClientRect();
  let water: Water | null = null;
  const sound = createSound();

  el.style.font = `${WEIGHT} 100px/1 ${FONT}`;
  el.style.letterSpacing = `${TRACK}em`;
  const ruler = document.createElement("canvas").getContext("2d")! as CanvasRenderingContext2D & { letterSpacing?: string };
  const metrics = () => {
    ruler.font = `${WEIGHT} ${s.size}px ${FONT}`;
    const m = ruler.measureText("Hg");
    base = (s.size - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    water?.shadow(s.size * 0.09, s.size * 0.14);       // the shadow scales with the type, not the screen
  };
  // the word as big as fits: 86% of the width, a quarter of the height, 260 px at most
  const fit = () => {
    ruler.font = `${WEIGHT} 100px ${FONT}`; ruler.letterSpacing = `${TRACK * 100}px`;
    const w = Math.max(1, ruler.measureText(s.text || "M").width) / 100;
    const size = Math.round(Math.min((box.width * 0.86) / w, box.height * 0.26, 260));
    if (size !== s.size) { s.size = size; el.style.fontSize = `${size}px`; metrics(); }
  };
  const layout = () => {
    box = host.getBoundingClientRect();
    fit();
    if (!s.x) { s.x = box.width * 0.5; s.y = box.height * (box.width < 700 ? 0.42 : 0.46); }
    s.x = Math.min(Math.max(s.x, 0), box.width); s.y = Math.min(Math.max(s.y, 0), box.height);
    calm = Array.from(host.querySelectorAll<HTMLElement>("[data-calm]")).map(c => {
      const b = c.getBoundingClientRect();
      return { x: b.left - box.left, y: b.top - box.top, w: b.width, h: b.height };
    });
    metrics();
    sig = "";
  };
  const place = () => {
    el.style.transform = `translate3d(${s.x.toFixed(2)}px, ${(s.y + s.bob).toFixed(2)}px, 0) translate(-50%, -50%) rotate(${s.r.toFixed(4)}rad)`;
  };

  const paint: Paint = (g, cw, ch, W) => {
    const now = `${cw}x${ch}|${s.text}|${s.x.toFixed(1)}|${(s.y + s.bob).toFixed(1)}|${s.r.toFixed(3)}|${s.size}|${calm.length}`;
    if (now === sig) return false;
    sig = now;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#000"; g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = "lighter";
    const k = cw / W;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = "#00ff00";
    for (const b of calm) { g.beginPath(); g.roundRect(b.x - 12, b.y - 10, b.w + 24, b.h + 20, 14); g.fill(); }
    const t = g as CanvasRenderingContext2D & { letterSpacing?: string };
    t.font = `${WEIGHT} ${s.size}px ${FONT}`;
    t.letterSpacing = `${(TRACK * s.size).toFixed(2)}px`;
    t.textAlign = "center"; t.textBaseline = "alphabetic";
    t.fillStyle = "#ff0000";
    t.translate(s.x, s.y + s.bob); t.rotate(s.r);
    t.fillText(s.text, 0, base - s.size / 2);
    t.letterSpacing = "0px";
    return true;
  };

  // The word's motion: a spring to the pointer while dragged, then a glide the water slows; a slow bob.
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 1 / 60);
    prev = now;
    if (still) { s.bob = 0; return; }
    s.t += dt;
    if (drag) {
      s.vx += ((drag.tx - s.x) * 140 - s.vx * 18) * dt;
      s.vy += ((drag.ty - s.y) * 140 - s.vy * 18) * dt;
    } else {
      const f = Math.exp(-dt * 4.5);
      s.vx *= f; s.vy *= f;
    }
    s.x += s.vx * dt; s.y += s.vy * dt;
    // the pool's sides: it bumps off them
    if (s.x < 0 || s.x > box.width) { s.x = Math.min(Math.max(s.x, 0), box.width); s.vx *= -0.4; }
    if (s.y < 0 || s.y > box.height) { s.y = Math.min(Math.max(s.y, 0), box.height); s.vy *= -0.4; }
    const lean = Math.max(-0.22, Math.min(0.22, s.vx * 0.00045));
    s.r += (lean + Math.sin(s.t * 0.9) * 0.012 - s.r) * Math.min(1, dt * 6);
    s.bob = Math.sin(s.t * 1.1) * s.size * 0.005;
    place();
    if (sound.on) sound.wake(Math.hypot(s.vx, s.vy) / Math.max(1, box.width), s.x / Math.max(1, box.width));
  };

  const local = (e: PointerEvent) => ({ x: e.clientX - box.left, y: e.clientY - box.top });
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || document.activeElement === el) return;
    const p = local(e);
    drag = { id: e.pointerId, dx: p.x - s.x, dy: p.y - s.y, tx: s.x, ty: s.y, moved: false, x0: p.x, y0: p.y };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    const p = local(e);
    if (drag && e.pointerId === drag.id) {
      drag.tx = p.x - drag.dx; drag.ty = p.y - drag.dy;
      if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 5) drag.moved = true;
      if (still) { s.x = drag.tx; s.y = drag.ty; place(); water?.pointer(p.x, p.y, "move"); }
      return;
    }
    water?.pointer(p.x, p.y, "move");
  };
  const caretToEnd = () => {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tap = !drag.moved;
    drag = null;
    if (tap) { el.focus(); caretToEnd(); }          // a click without a drag: type
  };
  const press = (e: PointerEvent) => {
    if (e.target === el || (e.target as Element | null)?.closest?.("button, a, input")) return;
    const p = local(e); water?.pointer(p.x, p.y, "down"); sound.drop(p.x / box.width, 0.6);
  };
  const input = () => {
    let t = (el.textContent ?? "").replace(/\s+/g, " ");
    if (t.length > MAX) { t = t.slice(0, MAX); el.textContent = t; caretToEnd(); }
    const grew = t.length > s.text.length;
    s.text = t;
    fit();
    // a letter lands: a splash at the word's end
    if (grew) { const b = el.getBoundingClientRect(), x = b.right - box.left - s.size * 0.25; water?.splash(x, s.y, s.size * 0.5, 0.08); sound.splash(x / box.width); }
    if (still) place();
  };
  const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); el.blur(); } };
  const blur = () => { if (!(el.textContent ?? "").trim()) { el.textContent = start; s.text = start; fit(); } };
  const onResize = () => { layout(); place(); water?.resize(); };
  const onVis = () => water?.visible(!document.hidden);

  layout(); place();
  el.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("pointerdown", press, { passive: true });
  el.addEventListener("input", input);
  el.addEventListener("keydown", key);
  el.addEventListener("blur", blur);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVis);
  raf = requestAnimationFrame(tick);

  water = createWater(canvas, paint, o.water);
  host.dataset.gl = water ? "on" : "off";
  metrics();
  water?.play(!still);

  return {
    water, sound,
    setStill(on) { still = on; water?.play(!on); if (on) { place(); sound.wake(0, 0.5); } },
    setSound(on) { sound.enable(on); },
    dispose() {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("pointerdown", press);
      el.removeEventListener("input", input);
      el.removeEventListener("keydown", key);
      el.removeEventListener("blur", blur);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      water?.dispose(); water = null; sound.dispose();
    },
  };
}
