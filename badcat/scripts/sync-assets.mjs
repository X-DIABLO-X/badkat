/* Copies the canonical cat rig into the Tauri frontend.
 *
 * The rig lives at the repo root because the demo page uses it too.
 * Tauri needs a self-contained dist folder, so it is copied rather than
 * referenced -- and copied by a build step rather than by hand, so the
 * two surfaces cannot drift. */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const lib = join(here, "..", "src", "lib");

mkdirSync(lib, { recursive: true });

const files = [
  ["js/cat-rig.js", "cat-rig.js"],
  ["js/cat-shapes.js", "cat-shapes.js"],
  ["js/cat.js", "cat.js"],
  ["css/cat.css", "cat.css"],
  ["desktop/vendor/gsap.min.js", "gsap.min.js"],
  ["desktop/vendor/MorphSVGPlugin.min.js", "MorphSVGPlugin.min.js"]
];

for (const [from, to] of files) {
  copyFileSync(join(repo, from), join(lib, to));
  console.log("  " + from + " -> src/lib/" + to);
}
console.log("rig synced");
