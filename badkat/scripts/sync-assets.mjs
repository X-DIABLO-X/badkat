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

/* Two destinations, not one: the landing page runs the same live rig as
 * the app, so it needs the same files. Copying both from here means the
 * cat on the website cannot quietly fall a version behind the cat in
 * the product. */
const targets = [
  { dir: join(here, "..", "src", "lib"), label: "badkat/src/lib" },
  { dir: join(repo, "site", "lib"), label: "site/lib" }
];

const files = [
  ["js/cat-rig.js", "cat-rig.js"],
  ["js/cat-shapes.js", "cat-shapes.js"],
  ["js/cat.js", "cat.js"],
  ["css/cat.css", "cat.css"],
  ["desktop/vendor/gsap.min.js", "gsap.min.js"],
  ["desktop/vendor/MorphSVGPlugin.min.js", "MorphSVGPlugin.min.js"]
];

for (const { dir, label } of targets) {
  mkdirSync(dir, { recursive: true });
  for (const [from, to] of files) {
    copyFileSync(join(repo, from), join(dir, to));
    console.log("  " + from + " -> " + label + "/" + to);
  }
}
console.log("rig synced");
