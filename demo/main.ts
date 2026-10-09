import "@fontsource-variable/albert-sans";
import "./style.css";
import { createMeniscus } from "../src/meniscus";

const host = document.getElementById("pool")!;
const still = matchMedia("(prefers-reduced-motion: reduce)");
// the mask is painted with the same font as the word, so wait for it
document.fonts.load('800 100px "Albert Sans Variable"').then(() => {
  const m = createMeniscus({
    host,
    canvas: host.querySelector("canvas")!,
    word: host.querySelector(".mn-word")!,
    still: still.matches,
  });
  still.addEventListener("change", e => m.setStill(e.matches));
});
