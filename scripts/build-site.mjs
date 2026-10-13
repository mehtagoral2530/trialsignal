// Builds the static site into site/ (GitHub Pages artifact). Zero dependencies.
// TS_API_BASE (optional): URL of the deployed Worker, e.g. https://trialsignal-api.<you>.workers.dev
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const shell = read("app/shell.html");
const style = shell.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
const body = shell.slice(shell.indexOf("</style>") + 8).trim();
mkdirSync(root + "site/assets", { recursive: true });
mkdirSync(root + "site/data", { recursive: true });
writeFileSync(root + "site/assets/styles.css", style + "\n");
writeFileSync(root + "site/assets/fonts.css", ["Regular:400", "Medium:500", "SemiBold:600", "Bold:700"].map((x) => { const [n, w] = x.split(":"); return `@font-face{font-family:"Figtree";font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/Figtree-${n}.woff2) format("woff2")}`; }).join("\n") + "\n");
writeFileSync(root + "site/assets/data.js", read("app/data.js"));
writeFileSync(root + "site/assets/app.js", ["core.js", "ask.js", "plain.js", "live.js", "views.js"].map((f) => `/* ---- ${f} ---- */\n` + read("app/" + f)).join("\n"));
const api = (process.env.TS_API_BASE || "").replace(/\/$/, "");
if (api && !/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?(\/[\w.\/-]*)?$/i.test(api)) throw new Error("TS_API_BASE must be an https URL (or http://localhost for development)");
writeFileSync(root + "site/assets/config.js", `window.TS_CONFIG = ${JSON.stringify({ API_BASE: api, BUILT_AT: new Date().toISOString().slice(0, 10) })};\n`);
const favicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='9' fill='%232F5BD3'/%3E%3Cpath d='M5 15.5h4.5l2.5-7 5 12 2.5-5H23' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const desc = "Understand a medical study in plain English: what was tested, what they found, and how sure we can be.";
const csp = ["default-src 'self'", `connect-src 'self' https://clinicaltrials.gov${api ? " " + new URL(api).origin : ""}`, "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "font-src 'self'", "script-src 'self'", "base-uri 'none'", "form-action 'none'"].join("; ");
writeFileSync(root + "site/index.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>TrialSignal · Medical studies in plain English</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="TrialSignal">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#F5F8FC">
<link rel="icon" href="${favicon}">
<link rel="preload" href="assets/fonts/Figtree-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/fonts.css">
<link rel="stylesheet" href="assets/styles.css">
</head>
<body>
${body.replace(/<link[^>]+fonts\.googleapis[^>]*>\s*/g, "")}
<script src="assets/config.js"></script>
<script src="assets/data.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
`);
writeFileSync(root + "site/.nojekyll", "");
console.log(`built site (API_BASE=${api || "none"})`);
