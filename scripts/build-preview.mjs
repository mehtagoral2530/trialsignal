// Builds dist/preview: a copy of the site for sandboxed hosts (such as a claude.ai
// artifact) that can't reach ClinicalTrials.gov. The page body is kept as-is, the
// stylesheet is inlined, and the site runs on its saved snapshot. Run: npm run preview

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("../site/", import.meta.url));
const out = fileURLToPath(new URL("../dist/preview/", import.meta.url));

const html = await readFile(`${site}index.html`, "utf8");
const css = await readFile(`${site}assets/styles.css`, "utf8");
const between = (a, b) => {
  const i = html.indexOf(a);
  const j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`Markers ${a} / ${b} not found in index.html`);
  return html.slice(i + a.length, j).trim();
};

const head = between("<!-- ts:head-start -->", "<!-- ts:head-end -->")
  .replace(/<link rel="icon"[^>]*>\n?/, "")
  .replace('<link rel="stylesheet" href="assets/styles.css">', `<style>\n${css}</style>`);
const body = between("<!-- ts:body-start -->", "<!-- ts:body-end -->");

const page = `${head}\n${body}\n<script>window.TS_PREVIEW = true;</script>\n<script type="module" src="js/app.js"></script>\n`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(`${out}index.html`, page);
await cp(`${site}js`, `${out}js`, { recursive: true });
await cp(`${site}data`, `${out}data`, { recursive: true });
console.log(`Preview written to dist/preview (${(page.length / 1024).toFixed(0)} KB page)`);
