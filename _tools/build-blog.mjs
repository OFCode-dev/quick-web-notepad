#!/usr/bin/env node
/* Builds the blog from _content/blog/<slug>.json: one page per post (/blog/<slug>/ in English,
   /pt/blog/<slug>/ in Portuguese) and an index per language. Called by build-locales.mjs, which also
   puts the posts in sitemap.xml; it can run on its own too:
     node _tools/build-blog.mjs          write the pages
     node _tools/build-blog.mjs --check  exit 1 if a page is out of date or a post is invalid
   Covers live in blog/img/<file> (16:9) and blog/img/og/<file> (1200×630). */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { marked, Renderer } from '../assets/vendor/marked.esm.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://quickwebnotepad.com';
const SRC = ROOT + '_content/blog/';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const L = {
  en: {
    locale: 'en-US', og: 'en_US', base: '/blog/', home: '/', md: '/markdown-viewer/', about: '/about.html',
    back: '← Blog', published: 'Published', updated: 'updated', minRead: (n) => `${n} min read`,
    faq: 'Frequently asked questions', sources: 'Sources', by: 'By the Quick Web Notepad team',
    indexTitle: 'Blog: plain text, Markdown and private notes | Quick Web Notepad',
    indexDesc: 'Guides to plain text, Markdown and private note-taking in the browser, from the makers of Quick Web Notepad.',
    indexLead: 'Guides to plain text, Markdown and private note-taking in the browser, from the makers of Quick Web Notepad.',
    empty: 'The first posts are on their way.', backHome: '← Open Quick Web Notepad',
    nav: [['/', 'Notepad'], ['/markdown-viewer/', 'Markdown viewer'], ['/blog/', 'Blog'], ['/about.html', 'About'], ['/privacy.html', 'Privacy']],
    other: ['pt', '/pt/blog/', 'Blog em português'],
  },
  pt: {
    locale: 'pt-BR', og: 'pt_BR', base: '/pt/blog/', home: '/pt/', md: '/markdown-viewer/', about: '/pt/sobre.html',
    back: '← Blog', published: 'Publicado em', updated: 'atualizado em', minRead: (n) => `${n} min de leitura`,
    faq: 'Perguntas frequentes', sources: 'Fontes', by: 'Pela equipe do Quick Web Notepad',
    indexTitle: 'Blog: texto simples, Markdown e notas privadas | Quick Web Notepad',
    indexDesc: 'Guias sobre texto simples, Markdown e notas privadas no navegador, feitos pela equipe do Quick Web Notepad.',
    indexLead: 'Guias sobre texto simples, Markdown e notas privadas no navegador, feitos pela equipe do Quick Web Notepad.',
    empty: 'Os primeiros textos estão a caminho.', backHome: '← Abrir o Quick Web Notepad',
    nav: [['/pt/', 'Bloco de notas'], ['/markdown-viewer/', 'Visualizador de Markdown'], ['/pt/blog/', 'Blog'], ['/pt/sobre.html', 'Sobre'], ['/privacy.html', 'Privacidade']],
    other: ['en', '/blog/', 'Blog in English'],
  },
};
export const BLOG_LANGS = Object.keys(L);

/* Markdown → HTML. Raw HTML in a post is shown as text, headings get ids for links. */
const slugId = (t) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
marked.use({
  gfm: true,
  renderer: {
    html({ text }) { return esc(text); },
    heading({ tokens, depth, text }) { return `<h${depth} id="${slugId(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`; },
    table(token) { return `<div class="table">${Renderer.prototype.table.call(this, token)}</div>`; },
  },
});
const render = (s) => marked.parse(s);
const words = (s) => (s.match(/\S+/g) || []).length;
const fmtDate = (d, lang) => new Intl.DateTimeFormat(L[lang].locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
export const postPath = (p) => `${L[p.lang].base}${p.slug}/`;

/* Problems that stop a post from being published. The automation calls this before it asks the owner. */
export function validatePost(p, { root = ROOT } = {}) {
  const bad = [];
  const need = ['slug', 'lang', 'title', 'description', 'date', 'updated', 'image', 'body', 'faq', 'cta'];
  for (const k of need) if (p[k] === undefined || p[k] === '') bad.push(`missing ${k}`);
  if (bad.length) return bad;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug) || p.slug.length > 70) bad.push('slug must be lowercase words joined by hyphens, at most 70 characters');
  if (!L[p.lang]) bad.push(`unknown language ${p.lang}`);
  if (p.title.length > 70) bad.push(`title is ${p.title.length} characters (at most 70)`);
  if (p.description.length < 110 || p.description.length > 165) bad.push(`description is ${p.description.length} characters (110 to 165)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !/^\d{4}-\d{2}-\d{2}$/.test(p.updated) || p.updated < p.date) bad.push('dates must be YYYY-MM-DD, and updated cannot be before date');
  const n = words(p.body);
  if (n < 600 || n > 2400) bad.push(`body has ${n} words (600 to 2400)`);
  if (/^#\s/m.test(p.body)) bad.push('body must not contain a level-1 heading; the title is the heading');
  if (/^#{2,3}\s+(faq|frequently asked|perguntas frequentes)/im.test(p.body)) bad.push('the FAQ belongs in the faq field, not in the body');
  if (!Array.isArray(p.faq) || p.faq.length < 2 || p.faq.length > 6 || p.faq.some((f) => !f.q || !f.a)) bad.push('faq needs 2 to 6 items with q and a');
  if (!p.image.file || !p.image.alt) bad.push('image needs file and alt');
  else for (const f of [`blog/img/${p.image.file}`, `blog/img/og/${p.image.file}`]) if (!existsSync(root + f)) bad.push(`missing ${f}`);
  if (!p.cta.href || !p.cta.text || !p.cta.lead) bad.push('cta needs href, text and lead');
  const links = [...p.body.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1]).concat(p.cta.href || []);
  for (const href of links) {
    if (href.startsWith('/')) {
      const file = href.split('#')[0].replace(/\/$/, '/index.html');
      if (!existsSync(root + file.slice(1))) bad.push(`internal link to a missing page: ${href}`);
    } else if (!/^https:\/\//.test(href) && !href.startsWith('#')) bad.push(`link must be https or site-relative: ${href}`);
  }
  for (const s of p.sources || []) if (!/^https:\/\//.test(s.url || '') || !s.title) bad.push('each source needs a title and an https url');
  return bad;
}

export function loadPosts({ root = ROOT } = {}) {
  const dir = root + '_content/blog/';
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const p = JSON.parse(readFileSync(dir + f, 'utf8'));
    if (`${p.slug}.json` !== f) throw new Error(`build-blog: ${f} has slug "${p.slug}"`);
    return p;
  }).sort((a, b) => (b.date + b.slug).localeCompare(a.date + a.slug));
}

const head = ({ lang, title, desc, url, image, type, extra = '', ld, robots }) => `<!doctype html>
<html lang="${L[lang].locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
${robots ? `  <meta name="robots" content="${robots}">\n` : ''}  <link rel="canonical" href="${SITE}${url}">
${extra}  <meta property="og:site_name" content="Quick Web Notepad">
  <meta property="og:type" content="${type}">
  <meta property="og:locale" content="${L[lang].og}">
  <meta property="og:url" content="${SITE}${url}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${SITE}${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="stylesheet" href="/assets/page.css">
  <link rel="alternate" type="application/rss+xml" title="Quick Web Notepad blog" href="${SITE}${L[lang].base}feed.xml">
  <meta name="google-adsense-account" content="ca-pub-6268520629380408">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6268520629380408" crossorigin="anonymous"></script>
  <script type="application/ld+json">
${JSON.stringify(ld)}
  </script>
</head>
<body>
  <!-- Generated by _tools/build-blog.mjs from _content/blog/. Do not edit by hand. -->
`;
const nav = (lang) => `    <nav>
${L[lang].nav.map(([h, t]) => `      <a href="${h}">${esc(t)}</a>`).join('\n')}
    </nav>
  </main>
</body>
</html>
`;

function renderPost(p) {
  const t = L[p.lang], url = postPath(p), img = `/blog/img/${p.image.file}`, og = `/blog/img/og/${p.image.file}`;
  const mins = Math.max(1, Math.round(words(p.body + ' ' + p.faq.map((f) => f.q + ' ' + f.a).join(' ')) / 220));
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BlogPosting', '@id': `${SITE}${url}#post`, headline: p.title, description: p.description, image: [`${SITE}${img}`, `${SITE}${og}`],
      datePublished: p.date, dateModified: p.updated, inLanguage: t.locale, url: `${SITE}${url}`, mainEntityOfPage: `${SITE}${url}`,
      keywords: (p.keywords || []).join(', ') || undefined,
      author: { '@type': 'Organization', name: 'OFCode-dev', url: 'https://github.com/OFCode-dev' },
      publisher: { '@id': `${SITE}/#publisher` }, isPartOf: { '@type': 'Blog', '@id': `${SITE}${t.base}#blog`, url: `${SITE}${t.base}` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Quick Web Notepad', item: `${SITE}${t.home}` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}${t.base}` },
      { '@type': 'ListItem', position: 3, name: p.title, item: `${SITE}${url}` }] },
    { '@type': 'FAQPage', '@id': `${SITE}${url}#faq`, mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@type': 'Organization', '@id': `${SITE}/#publisher`, name: 'OFCode-dev', url: 'https://github.com/OFCode-dev' },
  ] };
  const meta = `${t.published} <time datetime="${p.date}">${fmtDate(p.date, p.lang)}</time>${p.updated !== p.date ? ` · ${t.updated} <time datetime="${p.updated}">${fmtDate(p.updated, p.lang)}</time>` : ''} · ${t.minRead(mins)}`;
  const extra = `  <meta property="article:published_time" content="${p.date}">\n  <meta property="article:modified_time" content="${p.updated}">\n`;
  return head({ lang: p.lang, title: `${p.title} | Quick Web Notepad`, desc: p.description, url, image: og, type: 'article', extra, ld }) + `  <main>
    <a class="back" href="${t.base}">${t.back}</a>
    <article>
      <h1>${esc(p.title)}</h1>
      <p class="meta">${meta}<br>${esc(t.by)}</p>
      <img class="cover" src="${img}" width="${p.image.width || 1376}" height="${p.image.height || 768}" alt="${esc(p.image.alt)}" decoding="async" fetchpriority="high">
${render(p.body).trim()}
      <aside class="try">
        <p>${esc(p.cta.lead)}</p>
        <p><a class="cta" href="${esc(p.cta.href)}">${esc(p.cta.text)}</a></p>
      </aside>
      <h2 id="faq">${t.faq}</h2>
${p.faq.map((f) => `      <h3>${esc(f.q)}</h3>\n      <p>${esc(f.a)}</p>`).join('\n')}
${(p.sources || []).length ? `      <h2 id="sources">${t.sources}</h2>\n      <ul class="sources">\n${p.sources.map((s) => `        <li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a></li>`).join('\n')}\n      </ul>\n` : ''}    </article>
` + nav(p.lang);
}

function renderIndex(lang, posts) {
  const t = L[lang], mine = posts.filter((p) => p.lang === lang);
  const [olang, ohref, otext] = t.other, hasOther = posts.some((p) => p.lang === olang);
  const ld = { '@context': 'https://schema.org', '@type': 'Blog', '@id': `${SITE}${t.base}#blog`, url: `${SITE}${t.base}`, name: 'Quick Web Notepad blog', inLanguage: t.locale,
    blogPost: mine.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}${postPath(p)}`, datePublished: p.date })) };
  const alts = mine.length && hasOther ? BLOG_LANGS.map((l) => `  <link rel="alternate" hreflang="${l}" href="${SITE}${L[l].base}">\n`).join('') : '';
  const cards = mine.map((p) => `        <li><a href="${postPath(p)}">
          <img src="/blog/img/${p.image.file}" width="${p.image.width || 1376}" height="${p.image.height || 768}" alt="" loading="lazy" decoding="async">
          <span><span class="t">${esc(p.title)}</span><span class="d">${esc(p.description)}</span><time datetime="${p.date}">${fmtDate(p.date, lang)}</time></span>
        </a></li>`).join('\n');
  return head({ lang, title: t.indexTitle, desc: t.indexDesc, url: t.base, image: '/og-image.png', type: 'website', extra: alts, ld, robots: mine.length ? '' : 'noindex' }) + `  <main>
    <a class="back" href="${t.home}">${t.backHome}</a>
    <section>
      <h1>Blog</h1>
      <p>${esc(t.indexLead)}</p>
${mine.length ? `      <ul class="cards">\n${cards}\n      </ul>` : `      <p>${esc(t.empty)}</p>`}
${hasOther ? `      <p lang="${L[olang].locale}"><a href="${ohref}">${esc(otext)}</a></p>\n` : ''}    </section>
` + nav(lang);
}

function renderFeed(lang, posts) {
  const t = L[lang], mine = posts.filter((p) => p.lang === lang).slice(0, 20);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Quick Web Notepad blog</title>
  <link>${SITE}${t.base}</link>
  <description>${esc(t.indexDesc)}</description>
  <language>${t.locale}</language>
  <atom:link href="${SITE}${t.base}feed.xml" rel="self" type="application/rss+xml"/>
${mine.map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE}${postPath(p)}</link>
    <guid>${SITE}${postPath(p)}</guid>
    <pubDate>${new Date(p.date + 'T09:00:00Z').toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`;
}

/* Every generated file: [path relative to the site root, content]. */
export function blogFiles(posts = loadPosts()) {
  const out = [];
  for (const p of posts) out.push([postPath(p).slice(1) + 'index.html', renderPost(p)]);
  for (const lang of BLOG_LANGS) {
    out.push([L[lang].base.slice(1) + 'index.html', renderIndex(lang, posts)]);
    out.push([L[lang].base.slice(1) + 'feed.xml', renderFeed(lang, posts)]);
  }
  return out;
}

/* [path, lastmod] for the sitemap. An empty index is not listed (it is noindex). */
export function blogSitemap(posts = loadPosts()) {
  const out = [];
  for (const lang of BLOG_LANGS) {
    const mine = posts.filter((p) => p.lang === lang);
    if (mine.length) out.push([L[lang].base.slice(1), mine.map((p) => p.updated).sort().at(-1)]);
    for (const p of mine) out.push([postPath(p).slice(1), p.updated]);
  }
  return out;
}

export function buildBlog({ check = false, root = ROOT } = {}) {
  const posts = loadPosts({ root });
  let problems = 0;
  for (const p of posts) for (const b of validatePost(p, { root })) { console.error(`invalid post ${p.slug}: ${b}`); problems++; }
  for (const [path, html] of blogFiles(posts)) {
    const file = root + path;
    if (check) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== html) { console.error(`out of date: ${path}`); problems++; }
    } else {
      mkdirSync(file.replace(/[^/]+$/, ''), { recursive: true });
      writeFileSync(file, html);
    }
  }
  return { posts: posts.length, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = buildBlog({ check: process.argv.includes('--check') });
  if (r.problems) process.exit(1);
  if (!process.argv.includes('--check')) console.log(`built the blog: ${r.posts} posts`);
}
