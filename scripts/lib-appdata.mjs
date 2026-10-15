// Load the curated trial data (app/data.js is a classic script) without executing it in a page.
import { readFileSync } from "node:fs";
import vm from "node:vm";
export function loadAppData(root = new URL("..", import.meta.url).pathname) {
  const ctx = {};
  vm.runInNewContext(readFileSync(`${root}/app/data.js`, "utf8") + "\n;this.TRIALS=TRIALS;this.NEWS=NEWS;", ctx);
  return { TRIALS: ctx.TRIALS, NEWS: ctx.NEWS };
}

/** The hand-picked news and its plain-English text (app/data.js and app/plain.js are classic scripts too). */
export function loadNewsData(root = new URL("..", import.meta.url).pathname) {
  const a = {}, b = {};
  vm.runInNewContext(readFileSync(`${root}/app/data.js`, "utf8") + "\n;this.NEWS=NEWS;", a);
  vm.runInNewContext(readFileSync(`${root}/app/plain.js`, "utf8") + "\n;this.NEWS_PLAIN=NEWS_PLAIN;", b);
  return { NEWS: a.NEWS, NEWS_PLAIN: b.NEWS_PLAIN };
}
