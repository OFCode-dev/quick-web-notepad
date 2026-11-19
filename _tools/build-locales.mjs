#!/usr/bin/env node
/* Builds the per-language app pages (/es/, /tr/, ...), the Markdown viewer page and sitemap.xml from index.html,
   and the blog through build-blog.mjs.
   Run after editing index.html, assets/i18n.js or _tools/locales.mjs:
     node _tools/build-locales.mjs          write the files
     node _tools/build-locales.mjs --check  exit 1 if a language page is out of date */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LANGS } from '../assets/i18n.js';
import { LOCALES } from './locales.mjs';
import { buildBlog, blogSitemap } from './build-blog.mjs';

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
  html = html.replace(/href="\/about\.html"(?= data-k="about")/g, `href="${T.aboutUrl}"`); // status bar and noscript links
  html = swap(html, /(<span id="stPos">)[^<]*/, `$1${esc(T.ln)} 1/1 · ${esc(T.col)} 1`, 'status position');
  html = swap(html, /(<span id="stWords">)[^<]*/, `$10 ${esc(T.words)}`, 'status words');
  html = swap(html, /(<span id="stChars">)[^<]*/, `$10 ${esc(T.chars)}`, 'status chars');
  const key = (k) => { if (!(k in T)) throw new Error(`build-locales: unknown i18n key "${k}"`); return esc(T[k]); };
  html = html.replace(/(data-k="(\w+)"[^>]*>)[^<]*/g, (_, open, k) => open + key(k));
  html = html.replace(/aria-label="[^"]*" data-ka="(\w+)"/g, (_, k) => `aria-label="${key(k)}" data-ka="${k}"`);
  return html;
}

/* The same app at /markdown-viewer/: it explains itself while empty and shows text that is opened,
   dropped or pasted in the Markdown view. English only; the interface still follows the visitor's language. */
function buildMarkdownViewer() {
  const T = LANGS.en, url = `${SITE}markdown-viewer/`;
  const title = 'Markdown Viewer Online, Free & Private | Quick Web Notepad';
  const description = 'Open a .md file or paste Markdown and read it formatted, with tables, task lists and highlighted code. Free, no sign-up, nothing is uploaded, and it works offline.';
  const noscript = 'The Markdown viewer needs JavaScript. It opens .md files and pasted Markdown in your browser and shows them formatted, with nothing uploaded.';
  const jsonld = `<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${url}#page`, url, name: T.mvTitle, description, inLanguage: 'en', isPartOf: { '@id': `${SITE}#website` }, about: { '@id': `${SITE}#app` } })}
</script>
`;
  const intro = `<section id="intro" aria-labelledby="introTitle">
    <h1 id="introTitle" data-k="mvTitle">${esc(T.mvTitle)}</h1>
    <p data-k="mvLead">${esc(T.mvLead)}</p>
    <button id="bIntroOpen" data-k="mvOpen">${esc(T.mvOpen)}</button>
    <p class="note" data-k="mvNote">${esc(T.mvNote)}</p>
  </section>`;
  let html = source;
  html = swap(html, /<html lang="en" dir="ltr">/, '<html lang="en" dir="ltr" data-start="markdown">', '<html>');
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`, '<title>');
  html = swap(html, /(<meta name="description" content=")[^"]*/, `$1${esc(description)}`, 'meta description');
  html = swap(html, /(<link rel="canonical" href=")[^"]*/, `$1${url}`, 'canonical');
  html = swap(html, /(?:<link rel="alternate" hreflang="[^"]+" href="[^"]+">\n)+/, '', 'hreflang links'); // a single language
  html = swap(html, /(<meta property="og:url" content=")[^"]*/, `$1${url}`, 'og:url');
  html = swap(html, /(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`, 'og:title');
  html = swap(html, /(<meta property="og:description" content=")[^"]*/, `$1${esc(description)}`, 'og:description');
  html = swap(html, /<!-- jsonld:start -->[\s\S]*?<!-- jsonld:end -->\n/, jsonld, 'JSON-LD block');
  html = swap(html, /<h1 class="brand">([\s\S]*?)<\/h1>/, '<a class="brand" href="/">$1</a>', 'brand'); // the page heading is the viewer's
  html = swap(html, /(<span data-ns>)[^<]*/, `$1${esc(noscript)}`, 'noscript text');
  html = swap(html, /\n  <textarea id="editor"/, `\n  ${intro}\n  <textarea id="editor"`, 'editor');
  return html;
}

const codes = Object.keys(LANGS).filter((c) => c !== 'en');
const pages = [...codes.map((code) => [`${code}/index.html`, () => build(code)]), ['markdown-viewer/index.html', buildMarkdownViewer]];
let stale = 0;
for (const [path, make] of pages) {
  const file = ROOT + path, html = make();
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== html) { console.error(`out of date: ${path}`); stale++; }
  } else {
    mkdirSync(ROOT + path.replace(/[^/]+$/, ''), { recursive: true });
    writeFileSync(file, html);
  }
}
const blog = buildBlog({ check });
if (check) process.exit(stale || blog.problems ? 1 : 0);
if (blog.problems) process.exit(1);

const today = new Date().toISOString().slice(0, 10);
const paths = ['', ...codes.map((c) => `${c}/`), 'markdown-viewer/', 'about.html', 'pt/sobre.html', 'es/acerca.html', 'privacy.html', 'contact.html']
  .map((p) => [p, today]).concat(blogSitemap());
writeFileSync(ROOT + 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map(([p, mod]) => `  <url><loc>${SITE}${p}</loc><lastmod>${mod}</lastmod></url>`).join('\n')}
</urlset>
`);
console.log(`built ${codes.length} language pages, the Markdown viewer, ${blog.posts} blog posts and sitemap.xml`);
