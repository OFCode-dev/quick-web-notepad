#!/usr/bin/env node
/* Builds the per-language app pages (/es/, /tr/, ...) and sitemap.xml from index.html.
   Run after editing index.html, assets/i18n.js or _tools/locales.mjs:
     node _tools/build-locales.mjs          write the files
     node _tools/build-locales.mjs --check  exit 1 if a language page is out of date */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LANGS } from '../assets/i18n.js';
import { LOCALES } from './locales.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://quickwebnotepad.com/';
const check = process.argv.includes('--check');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const source = readFileSync(ROOT + 'index.html', 'utf8');

/* Replace exactly one match, or stop: a silent miss would publish a half-translated page. */
function swap(html, pattern, replacement, what) {
  if (!pattern.test(html)) throw new Error(`build-locales: could not find ${what} in index.html`);
  return html.replace(pattern, replacement);
}

function build(code) {
  const T = { ...LANGS.en, ...LANGS[code] }, L = LOCALES[code], url = `${SITE}${code}/`;
  let html = source;
  html = swap(html, /<html lang="en" dir="ltr">/, `<html lang="${code}" dir="${T.rtl ? 'rtl' : 'ltr'}" data-page-lang="${code}">`, '<html>');
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${esc(T.pageTitle)}</title>`, '<title>');
  html = swap(html, /(<meta name="description" content=")[^"]*/, `$1${esc(L.description)}`, 'meta description');
  html = swap(html, /(<link rel="canonical" href=")[^"]*/, `$1${url}`, 'canonical');
  html = swap(html, /(<meta property="og:locale" content=")[^"]*/, `$1${L.ogLocale}`, 'og:locale');
  html = swap(html, /(<meta property="og:url" content=")[^"]*/, `$1${url}`, 'og:url');
  html = swap(html, /(<meta property="og:title" content=")[^"]*/, `$1${esc(T.pageTitle)}`, 'og:title');
  html = swap(html, /(<meta property="og:description" content=")[^"]*/, `$1${esc(L.description)}`, 'og:description');
  html = swap(html, /<!-- jsonld:start -->[\s\S]*?<!-- jsonld:end -->\n/, '', 'JSON-LD block'); // the entity is described once, on the root page
  html = swap(html, /(<span data-ns>)[^<]*/, `$1${esc(L.noscript)}`, 'noscript text');
  html = swap(html, new RegExp(`<option value="${code}"`), `<option value="${code}" selected`, 'language option');
  html = swap(html, /(<span id="stPos">)[^<]*/, `$1${esc(T.ln)} 1/1 · ${esc(T.col)} 1`, 'status position');
  html = swap(html, /(<span id="stWords">)[^<]*/, `$10 ${esc(T.words)}`, 'status words');
  html = swap(html, /(<span id="stChars">)[^<]*/, `$10 ${esc(T.chars)}`, 'status chars');
  const key = (k) => { if (!(k in T)) throw new Error(`build-locales: unknown i18n key "${k}"`); return esc(T[k]); };
  html = html.replace(/(data-k="(\w+)"[^>]*>)[^<]*/g, (_, open, k) => open + key(k));
  html = html.replace(/aria-label="[^"]*" data-ka="(\w+)"/g, (_, k) => `aria-label="${key(k)}" data-ka="${k}"`);
  return html;
}

const codes = Object.keys(LANGS).filter((c) => c !== 'en');
let stale = 0;
for (const code of codes) {
  const file = `${ROOT}${code}/index.html`, html = build(code);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== html) { console.error(`out of date: ${code}/index.html`); stale++; }
  } else {
    mkdirSync(ROOT + code, { recursive: true });
    writeFileSync(file, html);
  }
}
if (check) process.exit(stale ? 1 : 0);

const today = new Date().toISOString().slice(0, 10);
const paths = ['', ...codes.map((c) => `${c}/`), 'about.html', 'privacy.html', 'contact.html'];
writeFileSync(ROOT + 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
console.log(`built ${codes.length} language pages and sitemap.xml`);
