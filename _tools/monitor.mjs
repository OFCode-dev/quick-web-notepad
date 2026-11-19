#!/usr/bin/env node
/* SEO / GEO / performance report for the live site. No dependencies.

   node _tools/monitor.mjs            print the report and save it under ~/.local/share/qwnotepad-monitor/
   node _tools/monitor.mjs --no-psi   skip the (slow) PageSpeed runs

   Secrets are read from ~/.config/qwnotepad-monitor/ and are never printed:
     gsc-key.json   Google service-account key (Search Console API, read-only user of the property)
     bing.key       Bing Webmaster Tools API key
     psi.key        optional Google API key for PageSpeed Insights (the keyless quota is often exhausted)
   Sections whose key is missing are skipped. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { homedir } from 'node:os';

const SITE = 'https://quickwebnotepad.com/';
const GSC_PROPERTY = 'sc-domain:quickwebnotepad.com';
const HOST_FILTER = 'quickwebnotepad.com';
const CONF = `${homedir()}/.config/qwnotepad-monitor/`;
const OUT = `${homedir()}/.local/share/qwnotepad-monitor/`;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const table = (head, rows) => { say(`| ${head.join(' | ')} |`); say(`|${head.map(() => ' --- ').join('|')}|`); for (const r of rows) say(`| ${r.join(' | ')} |`); };

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 30000) });
  return res;
}

/* ── 1. Availability and crawler access ── */
async function availability() {
  say('## Availability and crawler access');
  const paths = ['', 'tr/', 'ja/', 'about.html', 'robots.txt', 'sitemap.xml', 'llms.txt', 'ads.txt', 'index_v2.html'];
  const rows = [];
  for (const p of paths) {
    try { const r = await get(SITE + p); rows.push([`/${p}`, r.status, (r.headers.get('content-type') || '').split(';')[0]]); }
    catch (e) { rows.push([`/${p}`, 'ERROR', e.name]); }
  }
  table(['Path', 'Status', 'Type'], rows);
  const bots = ['Googlebot', 'bingbot', 'YandexBot', 'GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];
  const blocked = [];
  for (const ua of bots) {
    try { const r = await get(SITE, { headers: { 'User-Agent': `Mozilla/5.0 (compatible; ${ua}/1.0)` } }); if (r.status !== 200) blocked.push(`${ua}: ${r.status}`); }
    catch (e) { blocked.push(`${ua}: ${e.name}`); }
  }
  say();
  say(blocked.length ? `Crawlers NOT served 200: ${blocked.join(', ')}` : `All ${bots.length} search and AI crawler user agents get 200.`);
  try {
    const html = await (await get(SITE)).text();
    const sm = await (await get(SITE + 'sitemap.xml')).text();
    const checks = [
      ['title', /<title>Free Online Notepad/.test(html)], ['meta description', /<meta name="description"/.test(html)],
      ['canonical', /<link rel="canonical" href="https:\/\/quickwebnotepad\.com\/">/.test(html)],
      ['hreflang ×16', (html.match(/hreflang=/g) || []).length === 16], ['JSON-LD', /application\/ld\+json/.test(html)],
      ['og:image', /og:image/.test(html)], ['h1', /<h1/.test(html)], [`sitemap URLs: ${(sm.match(/<loc>/g) || []).length}`, /<loc>/.test(sm)],
    ];
    say(`On-page signals: ${checks.map(([n, ok]) => `${ok ? 'ok' : 'MISSING'} ${n}`).join(' · ')}`);
  } catch (e) { say(`On-page check failed: ${e.message}`); }
  say();
}

/* ── 2. PageSpeed Insights (lab scores and field data when it exists) ── */
async function pagespeed() {
  say('## PageSpeed (mobile)');
  const rows = [];
  const psiKey = existsSync(CONF + 'psi.key') ? `&key=${readFileSync(CONF + 'psi.key', 'utf8').trim()}` : '';
  for (const p of ['', 'about.html']) {
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(SITE + p)}&strategy=mobile&category=performance&category=seo&category=accessibility&category=best-practices${psiKey}`;
    try {
      const res = await get(api, { timeout: 120000 });
      const j = await res.json();
      if (!res.ok) { rows.push([`/${p}`, `API ${res.status}: ${(j.error?.message || '').slice(0, 60)}`, '', '', '', '', '', '']); continue; }
      const c = j.lighthouseResult.categories, a = j.lighthouseResult.audits;
      const pct = (x) => (x?.score == null ? '-' : Math.round(x.score * 100));
      const field = j.loadingExperience?.metrics ? j.loadingExperience.overall_category : 'no field data yet';
      rows.push([`/${p}`, pct(c.performance), pct(c.seo), pct(c.accessibility), pct(c['best-practices']), a['largest-contentful-paint']?.displayValue || '-', a['cumulative-layout-shift']?.displayValue || '-', field]);
    } catch (e) { rows.push([`/${p}`, `failed: ${e.name}`, '', '', '', '', '', '']); }
  }
  table(['Page', 'Perf', 'SEO', 'A11y', 'Best pr.', 'LCP', 'CLS', 'Field (CrUX)'], rows);
  say();
}

/* ── 3. Google Search Console ── */
async function googleToken(key) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: key.token_uri, iat: now, exp: now + 600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await get(key.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}` });
  const j = await res.json();
  if (!j.access_token) throw new Error(`token request failed (${res.status}: ${j.error || 'no token'})`);
  return j.access_token;
}
async function searchConsole() {
  say('## Google Search Console (last 28 days)');
  const file = CONF + 'gsc-key.json';
  if (!existsSync(file)) { say(`Skipped: ${file} is missing.`); say(); return; }
  try {
    const token = await googleToken(JSON.parse(readFileSync(file, 'utf8')));
    const api = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_PROPERTY)}`;
    const query = async (dimensions, rowLimit = 15) => {
      const res = await get(`${api}/searchAnalytics/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: daysAgo(30), endDate: daysAgo(2), dimensions, rowLimit, dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: HOST_FILTER }] }] }) });
      const j = await res.json();
      if (!res.ok) throw new Error(`searchAnalytics ${res.status}: ${j.error?.message}`);
      return j.rows || [];
    };
    const fmt = (r) => [r.clicks, r.impressions, `${(r.ctr * 100).toFixed(1)}%`, r.position.toFixed(1)];
    const total = await query([]);
    if (!total.length) say('No search data yet (a new property usually needs a few days).');
    else {
      table(['Clicks', 'Impressions', 'CTR', 'Avg position'], [fmt(total[0])]); say();
      for (const [dim, title] of [['query', 'Top queries'], ['page', 'Top pages'], ['country', 'Top countries']]) {
        const rows = await query([dim]);
        if (rows.length) { say(`**${title}**`); say(); table([dim, 'Clicks', 'Impr.', 'CTR', 'Pos.'], rows.map((r) => [r.keys[0].replace(SITE, '/'), ...fmt(r)])); say(); }
      }
    }
    const sm = await (await get(`${api}/sitemaps`, { headers: { Authorization: `Bearer ${token}` } })).json();
    for (const s of sm.sitemap || []) say(`Sitemap ${s.path}: last read ${s.lastDownloaded || 'never'}, errors ${s.errors || 0}, warnings ${s.warnings || 0}, submitted URLs ${(s.contents || []).map((c) => c.submitted).join('+') || '-'}`);
    const rows = [];
    for (const p of ['', 'about.html', 'tr/', 'es/', 'ja/']) {
      const res = await get('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: SITE + p, siteUrl: GSC_PROPERTY }) });
      const j = await res.json();
      const r = j.inspectionResult?.indexStatusResult;
      rows.push([`/${p}`, r ? r.coverageState : `API ${res.status}`, r?.lastCrawlTime?.slice(0, 10) || '-', r?.googleCanonical ? r.googleCanonical.replace(SITE, '/') : '-']);
    }
    say(); say('**Index status**'); say(); table(['Page', 'Coverage', 'Last crawl', 'Google canonical'], rows);
  } catch (e) { say(`Search Console failed: ${e.message}`); }
  say();
}

/* ── 4. Bing Webmaster Tools ── */
async function bing() {
  say('## Bing Webmaster Tools');
  const file = CONF + 'bing.key';
  if (!existsSync(file)) { say(`Skipped: ${file} is missing.`); say(); return; }
  const key = readFileSync(file, 'utf8').trim();
  const call = async (method) => {
    const res = await get(`https://ssl.bing.com/webmaster/api.svc/json/${method}?siteUrl=${encodeURIComponent(SITE)}&apikey=${key}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${res.status}: ${(j.Message || '').slice(0, 80)}`);
    return j.d || [];
  };
  const day = (d) => new Date(Number(/\d+/.exec(d)[0])).toISOString().slice(0, 10);
  try {
    const traffic = await call('GetRankAndTrafficStats');
    const recent = traffic.slice(-28);
    say(recent.length ? `Last ${recent.length} days: ${recent.reduce((a, r) => a + r.Clicks, 0)} clicks, ${recent.reduce((a, r) => a + r.Impressions, 0)} impressions.` : 'No traffic data yet.');
    const queries = (await call('GetQueryStats')).sort((a, b) => b.Impressions - a.Impressions).slice(0, 15);
    if (queries.length) { say(); table(['Query', 'Clicks', 'Impr.', 'Avg pos.'], queries.map((q) => [q.Query, q.Clicks, q.Impressions, q.AvgImpressionPosition])); }
    const crawl = (await call('GetCrawlStats')).slice(-7);
    if (crawl.length) { say(); table(['Day', 'Crawled', 'In index', 'Errors'], crawl.map((c) => [day(c.Date), c.CrawledPages, c.InIndex, c.CrawlErrors])); }
  } catch (e) { say(`Bing failed: ${e.message}`); }
  say();
}

say(`# Quick Web Notepad: search and performance report, ${today}`);
say();
await availability();
if (!process.argv.includes('--no-psi')) await pagespeed();
await searchConsole();
await bing();
say('GEO note: citations in ChatGPT, Gemini, Perplexity and Copilot have no API. Check Bing Webmaster Tools → AI Performance by hand, and ask the assistants directly once a month.');

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}report-${today}.md`, lines.join('\n') + '\n');
console.log(`\nSaved: ${OUT}report-${today}.md`);
