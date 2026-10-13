// Load the curated trial data (app/data.js is a classic script) without executing it in a page.
import { readFileSync } from "node:fs";
import vm from "node:vm";
export function loadAppData(root = new URL("..", import.meta.url).pathname) {
  const ctx = {};
  vm.runInNewContext(readFileSync(`${root}/app/data.js`, "utf8") + "\n;this.TRIALS=TRIALS;this.NEWS=NEWS;", ctx);
  return { TRIALS: ctx.TRIALS, NEWS: ctx.NEWS };
}
