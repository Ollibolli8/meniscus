# Meniscus

Type that floats. A word sits in a live pool of water: the water climbs each letter's edge, the floor takes its
shadow, and when the word moves it pushes the water ahead of it and leaves a wake. Drag it, or click it and type your
own.

**[Live demo](https://ollibolli8.github.io/meniscus/)** · Maquette 01 on [work.draindk.tech](https://work.draindk.tech/lab/meniscus/)

WebGL2 and GLSL in two TypeScript files, no dependencies, about 18 KB minified. The same technique runs under a
client's website, where the page's headings float on the sea.

## How it works

The water is the one from the Tide case: the wave equation on a grid for ripples, twelve wind-wave trains on top,
and sunlight bent by the surface onto a tiled floor, where it focuses into caustics (1 / det of the refraction map's
Jacobian). Sky shows on steep slopes; glints where a slope catches the sun.

The type enters the water as a mask. A small 2D canvas, at twice the simulation grid, is painted from the same numbers
that place the real text in the page (position, rotation, size, font), and only when one of them changes. It is
uploaded with mipmaps and kept as two textures, so the simulation can compare this frame with the last.

- **Pressed flat:** the water under a letter is damped towards rest.
- **Wake:** where the mask changed, the water is pushed up (the letter arrived) or pulled down (it left), read
  through a wide blur of the mask (mip 3.4), so a moving word makes long smooth swell. Reflecting ripples off the
  letters' edges was tried and dropped: a moving edge feeds the grid's finest waves, which the caustics show as grain.
- **Shadow:** the floor samples the mask, offset by the type's size and blurred (mip 2.2), with a halo of focused light
  around it (mip 3.4).
- **Meniscus:** a thin line of sky where the water climbs a letter (mip 1.1 minus mip 0).
- **Calm:** a second channel of the mask quiets the caustics behind running text, so it stays readable.

**Sound** (`src/sound.ts`, off until turned on): synthesized, no samples. A drop is a bubble ringing at its Minnaert
resonance (about 3.26 Hz·m over its radius), rising in pitch as it surfaces; a letter lands as a few bubbles and a
splash of filtered noise; a dragged word laps the water with low noise that follows its speed; all panned to where it
happens.

Capped at 60 fps; a device that can't keep up gets fewer pixels; one still frame when motion is reduced. Without
WebGL2 the host gets `data-gl="off"` for a CSS fallback.

## Use it

```ts
import { createMeniscus } from "./src/meniscus";

await document.fonts.load('800 100px "Albert Sans Variable"');   // the mask needs the word's font
const meniscus = createMeniscus({
  host: document.querySelector("#pool"),          // the pool; [data-calm] children get calmer light
  canvas: document.querySelector("#pool canvas"), // fills the host
  word: document.querySelector("#pool .word"),    // contenteditable="plaintext-only"
  still: matchMedia("(prefers-reduced-motion: reduce)").matches,
});
```

For other type, call `createWater(canvas, paint)` from `src/water.ts` directly and paint your own mask: red for what
floats, green for calm.

## Build the demo

```sh
npm install
npm run build   # docs/ (GitHub Pages)
npm run dev     # build and serve
```

## Licence

MIT, Oliver Kure Olsen, 2026.
