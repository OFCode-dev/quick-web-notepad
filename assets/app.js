import { LANGS, detectLang } from './i18n.js';

const VERSION = 'v3.1';
const APP = 'Quick Web Notepad';
const DEFAULT_BASE = 'Untitled';
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const ALT = IS_MAC ? '⌥' : 'Alt';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const editor = $('editor'), highlight = $('highlight'), preview = $('preview');
const fileName = $('fileName'), fileExt = $('fileExt'), findBar = $('findBar'), findInput = $('findInput'), replaceInput = $('replaceInput');

/* ── Storage: the document is per tab (sessionStorage), preferences are shared (localStorage) ── */
function load(kind, key) {
  try { return JSON.parse(window[kind].getItem(key)) || {}; } catch { return {}; }
}
function store(kind, key, value) {
  try { window[kind].setItem(key, JSON.stringify(value)); } catch { /* storage blocked or full */ }
}
const prefs = load('localStorage', 'qwn:prefs');
const PAGE_LANG = root.dataset.pageLang || '';
const START_MD = root.dataset.start === 'markdown'; // the Markdown viewer page
const saved = load('sessionStorage', 'qwn:doc');
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
let docId = saved.id || newId(); // identifies this tab's note in the Recent list

const state = {
  view: 'edit',            // 'edit' | 'syntax' | 'markdown'
  locked: false,
  lockBeforeView: false,   // lock state to return to when a view is closed
  wrap: !!prefs.wrap,
  zoom: prefs.zoom || 100,
  theme: root.dataset.theme,
  // A /xx/ page is always shown in its own language; the root page follows the saved choice or the browser.
  lang: LANGS[PAGE_LANG] ? PAGE_LANG : LANGS[prefs.lang] ? prefs.lang : detectLang(),
  syntaxLang: '',
};
let T = { ...LANGS.en, ...LANGS[state.lang] };
let fileHandle = null;

function savePrefs() {
  store('localStorage', 'qwn:prefs', { theme: prefs.theme, lang: prefs.lang, zoom: state.zoom, wrap: state.wrap, keepNotes: prefs.keepNotes });
}
let saveTimer;
function saveDocNow() {
  clearTimeout(saveTimer);
  store('sessionStorage', 'qwn:doc', {
    id: docId, text: editor.value, name: fileName.value, ext: fileExt.value, bare: bareName, view: state.view,
    locked: state.view === 'edit' ? state.locked : state.lockBeforeView,
  });
  keepNote();
}

/* ── Recent notes ──
   Each tab's text is also kept in localStorage (one key per note plus a small index), so that it can be
   reopened after the tab is closed. New tabs still start empty. An emptied note is removed. */
const NOTES_KEY = 'qwn:notes', NOTE_KEY = (id) => `qwn:note:${id}`;
const MAX_NOTES = 30, MAX_NOTE_CHARS = 1e6;
const keeping = () => prefs.keepNotes !== false;
function noteIndex() { try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; } catch { return []; } }
function writeIndex(list) { try { localStorage.setItem(NOTES_KEY, JSON.stringify(list)); } catch { /* storage blocked */ } }
function dropNote(id) {
  try { localStorage.removeItem(NOTE_KEY(id)); } catch { /* storage blocked */ }
  writeIndex(noteIndex().filter((n) => n.id !== id));
}
function keepNote() {
  if (!keeping()) return;
  const text = editor.value;
  if (!text.trim() || text.length > MAX_NOTE_CHARS) { dropNote(docId); return; } // very large notes are not kept
  const index = noteIndex(), prev = index.find((n) => n.id === docId);
  // Unchanged (closing or hiding the tab saves too): keep its place and time in the list.
  if (prev && prev.name === fileName.value && prev.ext === fileExt.value && prev.bare === bareName && readNote(prev) === text) return;
  const firstLine = (text.trim().split('\n', 1)[0] || '').slice(0, 120);
  const entry = { id: docId, name: fileName.value, ext: fileExt.value, bare: bareName, line: firstLine, updated: Date.now() };
  const list = [entry, ...index.filter((n) => n.id !== docId)];
  while (list.length > MAX_NOTES) dropNote(list.pop().id);
  for (let tries = 0; tries < 5; tries++) {
    try { localStorage.setItem(NOTE_KEY(docId), text); writeIndex(list); return; }
    catch { if (list.length <= 1) return; const old = list.pop(); try { localStorage.removeItem(NOTE_KEY(old.id)); } catch { /* blocked */ } } // full: drop the oldest
  }
}
function deleteAllNotes() {
  for (const n of noteIndex()) { try { localStorage.removeItem(NOTE_KEY(n.id)); } catch { /* blocked */ } }
  try { localStorage.removeItem(NOTES_KEY); } catch { /* blocked */ }
}

/* Notes open in other tabs are left out of the list; tabs answer a short "who is open" question. */
const channel = window.BroadcastChannel ? new BroadcastChannel('qwn') : null;
if (channel) channel.onmessage = (e) => { if (e.data === 'who') channel.postMessage({ open: docId }); };
function openElsewhere() {
  if (!channel) return Promise.resolve(new Set());
  const ids = new Set(), listen = (e) => { if (e.data && e.data.open) ids.add(e.data.open); };
  channel.addEventListener('message', listen);
  channel.postMessage('who');
  return new Promise((done) => setTimeout(() => { channel.removeEventListener('message', listen); done(ids); }, 120));
}
/* A tab made with the browser's "Duplicate" command copies sessionStorage, id included. The copy
   becomes a note of its own, so the two tabs do not overwrite each other. */
if (saved.id) openElsewhere().then((ids) => { if (ids.has(docId)) { docId = newId(); if (editor.value.trim()) saveDocNow(); } });

const recentMenu = $('recentMenu');
const canPopover = 'popover' in HTMLElement.prototype; // Chrome 114, Firefox 125, Safari 17 and later
const recentOpen = () => canPopover && recentMenu.matches(':popover-open');
if (!canPopover) { $('bRecent').hidden = true; recentMenu.hidden = true; }
const relTime = (t) => {
  const s = (t - Date.now()) / 1000, rtf = new Intl.RelativeTimeFormat(state.lang, { numeric: 'auto' });
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  return rtf.format(0, 'minute');
};
async function renderRecent() {
  const open = await openElsewhere();
  const list = noteIndex().filter((n) => n.id !== docId && !open.has(n.id));
  const ul = $('recentList');
  ul.textContent = '';
  for (const n of list) {
    const li = document.createElement('li'), btn = document.createElement('button'), del = document.createElement('button');
    const name = n.bare && !n.ext ? n.name : `${n.name || DEFAULT_BASE}.${n.ext || 'txt'}`;
    btn.className = 'rm-open';
    btn.innerHTML = '<span class="rm-name"></span><span class="rm-line"></span>';
    btn.firstChild.textContent = name;
    btn.lastChild.textContent = `${relTime(n.updated)} · ${n.line}`;
    btn.onclick = () => openNote(n);
    del.className = 'icon-only';
    del.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
    del.title = `${T.deleteNote}: ${name}`;
    del.setAttribute('aria-label', del.title);
    del.onclick = () => { dropNote(n.id); li.remove(); showRecentState(); ul.querySelector('button')?.focus(); };
    li.append(btn, del);
    ul.append(li);
  }
  showRecentState();
}
function showRecentState() {
  const any = !!$('recentList').children.length;
  $('chkKeep').checked = keeping();
  $('recentEmpty').textContent = keeping() ? T.recentEmpty : T.recentOff;
  $('recentEmpty').hidden = any;
  $('bDeleteAll').hidden = !any;
}
function readNote(n) {
  let text = null;
  try { text = localStorage.getItem(NOTE_KEY(n.id)); } catch { /* blocked */ }
  return text;
}
function openNote(n) {
  recentMenu.hidePopover();
  if (editor.value.trim()) { // keep the current note: the other one opens in a new tab
    saveDocNow();
    window.open(`${location.pathname}#open=${encodeURIComponent(n.id)}`, '_blank', 'noopener');
    return;
  }
  adoptNote(n);
}
function adoptNote(n) {
  const text = readNote(n);
  if (text === null) { dropNote(n.id); return; }
  docId = n.id;
  fileHandle = null;
  fileName.value = n.name || DEFAULT_BASE; fileExt.value = n.ext || ''; bareName = !!n.bare;
  refreshName();
  setText(text);
  if (state.view === 'edit') editor.focus();
  toast(`${fullName()} ${T.opened}`);
}
recentMenu.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return;
  const r = $('bRecent').getBoundingClientRect(), w = Math.min(380, innerWidth - 16);
  recentMenu.style.top = `${r.bottom + 4}px`;
  recentMenu.style.left = `${Math.max(8, Math.min(T.rtl ? r.right - w : r.left, innerWidth - w - 8))}px`;
  renderRecent().then(() => (recentMenu.querySelector('#recentList button') || $('chkKeep')).focus());
});
recentMenu.addEventListener('keydown', (e) => { // up and down move between the notes
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...recentMenu.querySelectorAll('.rm-open')], i = items.indexOf(document.activeElement);
  if (i < 0 || !items.length) return;
  e.preventDefault();
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
});
function saveDoc() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDocNow, 300); }

/* ── Small helpers ── */
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function countWords(s) { s = s.trim(); return s ? s.split(/\s+/).length : 0; }

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

function deny() {
  const b = $('bLock');
  b.classList.remove('deny'); void b.offsetWidth; b.classList.add('deny');
}
function guard() { if (state.locked) { deny(); return true; } return false; }
function updateInvite() {
  $('bPaste').classList.toggle('invite', !editor.value && !state.locked);
  const intro = $('intro'); // the Markdown viewer page explains itself while the note is empty
  if (intro) intro.hidden = !!editor.value || state.view !== 'edit';
}
/* On the Markdown viewer page, text that arrives in an empty note is shown formatted. */
function showFormatted(wasEmpty) {
  if (!START_MD || !wasEmpty || !editor.value.trim() || state.view !== 'edit') return;
  setView('markdown').then(() => { if (state.view === 'markdown') preview.focus(); });
}

/* ── File name: [ name ] . [ extension ] ──
   An empty extension field means "automatic": md in the Markdown view, the detected language in the
   Syntax view, otherwise txt. A typed extension, or the one of an opened file, is kept as it is. */
const EXT_OF = { js: 'js', py: 'py', html: 'html', css: 'css', json: 'json', sql: 'sql', sh: 'sh', c: 'c', md: 'md' };
let bareName = false; // an opened file without an extension keeps none
function autoExt() {
  return state.view === 'markdown' ? 'md' : (state.view === 'syntax' && EXT_OF[state.syntaxLang]) || 'txt';
}
function baseName() { return fileName.value.trim() || DEFAULT_BASE; }
function fullName() {
  return bareName && !fileExt.value ? baseName() : `${baseName()}.${fileExt.value || autoExt()}`;
}
/* An unnamed document keeps the descriptive page title (this is what search engines index). */
function setTitle() {
  const untouched = baseName() === DEFAULT_BASE && !fileExt.value && !bareName;
  document.title = untouched ? T.pageTitle : `${fullName()} | ${APP}`;
}
function refreshName() {
  fileExt.placeholder = bareName ? '' : autoExt();
  if (!CSS.supports('field-sizing', 'content')) { // size the fields to their text where the browser cannot
    fileName.style.width = `calc(${Math.max(3, fileName.value.length)}ch + 16px)`;
    fileExt.style.width = `calc(${Math.max(3, (fileExt.value || fileExt.placeholder).length)}ch + 16px)`;
  }
  setTitle();
}
function splitName(name) {
  const m = /^(.+)\.([A-Za-z0-9_+-]{1,10})$/.exec(name);
  return m ? [m[1], m[2]] : [name, ''];
}
function setIcon(button, icon) { button.querySelector('use').setAttribute('href', '#i-' + icon); }

/* ── Status bar ── */
let hint = '', wordsTimer;
function setHint(text) { hint = text; updateMode(); }
function updateMode() {
  $('stMode').textContent = hint ||
    (state.view === 'markdown' ? 'MARKDOWN' : state.view === 'syntax' ? state.syntaxLang.toUpperCase() : '');
}
function updateStatus() {
  const txt = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
  const before = txt.slice(0, s).split('\n');
  $('stPos').textContent = `${T.ln} ${before.length}/${txt.split('\n').length} · ${T.col} ${before.pop().length + 1}`;
  if (txt.length < 50000) $('stWords').textContent = `${countWords(txt)} ${T.words}`;
  else { clearTimeout(wordsTimer); wordsTimer = setTimeout(() => { $('stWords').textContent = `${countWords(editor.value)} ${T.words}`; }, 250); } // keep typing responsive in large files
  $('stChars').textContent = `${txt.length} ${T.chars}`;
  $('stZoom').textContent = state.zoom + '%';
  const sel = txt.slice(s, e);
  $('stSel').hidden = !sel;
  if (sel) $('stSel').textContent = `${T.sel} ${sel.length} · ${countWords(sel)} ${T.words}`;
  $('stLock').hidden = !state.locked;
  updateMode();
}

/* ── Syntax highlighting ── */
/* Language of the text: a known extension decides, otherwise the content is examined.
   The checks are deliberately strict: ordinary prose ("let me know", "select one from the list")
   must stay undetected, because the result also picks the automatic file extension. */
function detectSyntax(name, text) {
  const ext = (name.split('.').pop() || '').toLowerCase(), head = text.slice(0, 3000);
  const byExt = { js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', html: 'html', htm: 'html', css: 'css', json: 'json', py: 'py', sh: 'sh', bash: 'sh', sql: 'sql', c: 'c', cpp: 'c', h: 'c', md: 'md' };
  if (byExt[ext]) return byExt[ext];
  const shebang = /^#!.*?\b(bash|zsh|sh|python\d*|node)\b/.exec(head);
  if (shebang) return shebang[1].startsWith('python') ? 'py' : shebang[1] === 'node' ? 'js' : 'sh';
  if (/^\s*<(!DOCTYPE|html|\?xml)/i.test(head) || /<\/(html|head|body|div|p|span|a|ul|ol|li|h[1-6]|table|section|script|style)>/i.test(head)) return 'html';
  if (/^\s*[{[]/.test(head)) {
    if (text.length < 2e6) try { JSON.parse(text); return 'json'; } catch { /* not complete JSON */ }
    if (/^\s*\{\s*"[^"\n]+"\s*:/.test(head)) return 'json';
  }
  if (/^[ \t]*#[ \t]*include[ \t]*[<"]/m.test(head)) return 'c';
  if (/^[ \t]*(def|class)\s+\w+[^\n]*:[ \t]*$/m.test(head) || /^from\s+[\w.]+\s+import\s/m.test(head) || /^import\s+[\w.]+(\s+as\s+\w+)?[ \t]*$/m.test(head)) return 'py';
  if (/\b(const|let|var)\s+[\w$]+\s*=/.test(head) || /\bfunction\s*[\w$]*\s*\(/.test(head) || /=>\s*[{(]/.test(head) || /^import\s[^\n]*\sfrom\s+['"]/m.test(head)) return 'js';
  if (/^\s*(SELECT\s[\s\S]{1,200}?\sFROM\s|INSERT\s+INTO\s|UPDATE\s+\w+\s+SET\s|DELETE\s+FROM\s|CREATE\s+TABLE\s|ALTER\s+TABLE\s)/m.test(head)
    || /^\s*(select\s[\s\S]{1,200}?\sfrom\s|insert\s+into\s|create\s+table\s)[\s\S]{0,400}?;[ \t]*$/im.test(head)) return 'sql';
  if (/(^|\})\s*[.#@:*]?[\w-][^{}\n;]*\{\s*[a-z-]+\s*:[^;{}\n]+;/m.test(head)) return 'css';
  const md = [/^\s*#{1,6} \S/, /^```/m, /\[[^\]\n]+\]\([^)\n]+\)/, /^\s*[-*] \[[ xX]\] /m, /\*\*[^*\n]+\*\*/, /^#{2,6} \S/m, /^\s*[-*+] \S[^\n]*\n\s*[-*+] \S/m];
  if (md.filter((re) => re.test(head)).length >= 2) return 'md'; // one sign alone (a "# comment" line) is not enough
  return '';
}
const FENCE_ALIAS = { javascript: 'js', typescript: 'js', ts: 'js', jsx: 'js', tsx: 'js', python: 'py', shell: 'sh', bash: 'sh', zsh: 'sh', 'c++': 'c', cpp: 'c', htm: 'html', xml: 'html', markdown: 'md' };

const RULES = {
  js: [['st', /(?<=(?:^|[=(,:;!&|?{}[+\-*%~^]|\breturn|\btypeof|\bcase)[ \t]*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuvy]*/],
    ['cm', /\/\/[^\n]*|\/\*[\s\S]*?\*\//], ['st', /`[\s\S]*?`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/],
    ['kw', /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|typeof|class|extends|import|export|default|async|await|try|catch|finally|throw|null|undefined|true|false)\b/],
    ['tp', /\b(Promise|Array|Object|Map|Set|Error|Date|Math|JSON|console|window|document|Number|String|Boolean)\b/],
    ['nm', /\b\d+\.?\d*\b/], ['fn', /\b[A-Za-z_$][\w$]*(?=\s*\()/]],
  py: [['cm', /#[^\n]*/], ['st', /"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/], ['at', /^[ \t]*@[\w.]+/],
    ['kw', /\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|pass|break|continue|lambda|yield|raise|True|False|None|async|await)\b/],
    ['nm', /\b\d+\.?\d*\b/], ['fn', /\b[A-Za-z_]\w*(?=\s*\()/]],
  html: [['cm', /<!--[\s\S]*?-->/], ['st', /"[^"<>]*"(?=[^<>]*>)|'[^'<>]*'(?=[^<>]*>)/], ['tp', /<\/?\w[\w-]*|<!DOCTYPE/], ['at', /\b[\w:-]+(?=\s*=[^<>]*>)/]],
  css: [['cm', /\/\*[\s\S]*?\*\//], ['st', /"[^"\n]*"|'[^'\n]*'/], ['kw', /@[\w-]+/],
    // a #hex that is followed by "{" is an id selector, not a color
    ['nm', /#[0-9a-fA-F]{3,8}\b(?![^{};]*\{)|-?\b\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?/],
    ['tp', /[.#]?[\w-]+(?=[^{};]*\{)/], ['at', /(?<=[{;]\s*)[\w-]+(?=\s*:)/]],
  json: [['at', /"(?:[^"\\]|\\.)*"(?=\s*:)/], ['st', /"(?:[^"\\]|\\.)*"/], ['nm', /-?\d+\.?\d*\b/], ['kw', /\b(true|false|null)\b/]],
  sql: [['cm', /--[^\n]*/], ['st', /'(?:[^'\\]|\\.)*'/], ['nm', /\b\d+\.?\d*\b/],
    ['kw', /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|ON|GROUP|BY|ORDER|HAVING|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|AS|AND|OR|NOT|IN|NULL|IS|LIMIT|CASE|WHEN|THEN|ELSE|END)\b/, 'i']],
  sh: [['cm', /(?<=^|\s)#[^\n]*/], ['st', /"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/],
    ['kw', /\b(if|then|else|elif|fi|for|do|done|while|function|return|exit|export|local|source|case|esac)\b/], ['at', /\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$[\d@#?*$!-]/]],
  md: [['kw', /^#{1,6} .+$/], ['st', /```[\s\S]*?```|`[^`\n]+`/], ['at', /\*\*[^*\n]+\*\*|__[^_\n]+__/], ['fn', /\[[^\]\n]*\]\([^)\n]*\)/],
    ['cm', /^[ \t]*>[^\n]*/], ['tp', /^[ \t]*(?:[-*+]|\d+\.)(?= )/]],
  c: [['cm', /\/\/[^\n]*|\/\*[\s\S]*?\*\//], ['st', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/], ['at', /^[ \t]*#[ \t]*\w+/],
    ['kw', /\b(auto|bool|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|int|long|return|short|sizeof|static|struct|switch|typedef|void|volatile|while)\b/],
    ['nm', /\b\d+\.?\d*\b/], ['fn', /\b[A-Za-z_]\w*(?=\s*\()/]],
};
const COMPILED = {};
/* Yield [class, text] pieces for one language's rules (class is null for plain text).
   Lazy, so a large file can be highlighted a block at a time. */
function* ruleSegments(text, lang) {
  const rules = RULES[lang];
  if (!text) return;
  if (!rules) { yield [null, text]; return; }
  // One alternation of named groups; a rule's own groups must be non-capturing.
  COMPILED[lang] ||= new RegExp(rules.map((r, i) => `(?<g${i}>${r[1].source})`).join('|'),
    'gm' + (rules.some((r) => r[2] === 'i') ? 'i' : ''));
  const rx = new RegExp(COMPILED[lang]); // own position: several of these can be in progress
  let pos = 0, m;
  while ((m = rx.exec(text)) !== null) {
    if (!m[0]) { rx.lastIndex++; continue; }
    if (m.index > pos) yield [null, text.slice(pos, m.index)];
    yield [rules[rules.findIndex((_, n) => m.groups['g' + n] !== undefined)][0], m[0]];
    pos = rx.lastIndex;
  }
  if (pos < text.length) yield [null, text.slice(pos)];
}
/* HTML also highlights the contents of <script> and <style> in their own language. */
function* segments(text, lang) {
  if (lang !== 'html') { yield* ruleSegments(text, lang); return; }
  let pos = 0;
  for (const m of text.matchAll(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi)) {
    yield* ruleSegments(text.slice(pos, m.index) + m[1], 'html');
    yield* ruleSegments(m[3], m[2].toLowerCase() === 'style' ? 'css' : /type\s*=\s*["']?[^"'>]*json/i.test(m[1]) ? 'json' : 'js');
    yield* ruleSegments(m[4], 'html');
    pos = m.index + m[0].length;
  }
  yield* ruleSegments(text.slice(pos), 'html');
}
const segHtml = (cls, text) => (cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text));
function tokenize(text, lang) {
  let html = '';
  for (const [cls, part] of segments(text, lang)) html += segHtml(cls, part);
  return html;
}

/* The same, as blocks of whole lines, produced one at a time. A block ends only at a line break
   in plain text, never inside a token; that line break is represented by the block boundary. */
const CHUNK = 40000;
function* highlightChunks(text, lang) {
  let html = '', size = 0;
  for (let [cls, part] of segments(text, lang)) {
    while (!cls && size + part.length > CHUNK) {
      const nl = part.indexOf('\n', Math.max(0, CHUNK - size));
      if (nl < 0) break;
      yield html + escapeHtml(part.slice(0, nl));
      html = ''; size = 0; part = part.slice(nl + 1);
    }
    html += segHtml(cls, part); size += part.length;
  }
  yield html;
}

let renderJob = 0;
function renderSyntax() {
  state.syntaxLang = detectSyntax(fileExt.value ? `x.${fileExt.value}` : '', editor.value); // a typed extension wins over guessing
  const chunks = highlightChunks(editor.value, state.syntaxLang), job = ++renderJob;
  const block = (html) => `<div>${html || '\n'}</div>`; // an empty block still needs its line
  let next = chunks.next();
  highlight.innerHTML = block(next.value);
  const more = () => { // the rest is highlighted and added in short slices so the page stays responsive
    if (job !== renderJob || state.view !== 'syntax') return;
    const until = performance.now() + 12;
    while (!(next = chunks.next()).done) {
      highlight.insertAdjacentHTML('beforeend', block(next.value));
      if (performance.now() > until) { setTimeout(more); return; }
    }
    if (!findBar.hidden) runFind();
  };
  setTimeout(more);
  refreshName();
}

/* ── Markdown view (libraries load on first use) ── */
let mdLibs;
async function renderMarkdown() {
  const source = editor.value;
  try {
    mdLibs ||= Promise.all([import('./vendor/marked.esm.js'), import('./vendor/purify.es.js')]);
    const [{ marked }, { default: DOMPurify }] = await mdLibs;
    if (state.view !== 'markdown') return;
    preview.innerHTML = DOMPurify.sanitize(marked.parse(source, { gfm: true }));
  } catch {
    mdLibs = null;
    if (state.view !== 'markdown') return;
    preview.textContent = '';
    const pre = document.createElement('pre');
    pre.textContent = source;
    preview.append(pre);
    return;
  }
  for (const a of preview.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  for (const code of preview.querySelectorAll('pre > code[class*="language-"]')) {
    const name = code.className.match(/language-([\w+-]+)/)[1].toLowerCase();
    const lang = FENCE_ALIAS[name] || name;
    if (RULES[lang]) code.innerHTML = tokenize(code.textContent, lang);
  }
}

/* ── Views and lock ── */
function setLock(on) {
  state.locked = on;
  editor.readOnly = on;
  const b = $('bLock');
  b.setAttribute('aria-pressed', on);
  setIcon(b, on ? 'lock' : 'unlock');
  $('stLock').hidden = !on;
  updateInvite();
}

async function setView(next) {
  const prev = state.view;
  if (next === prev) return;
  const current = { edit: editor, syntax: highlight, markdown: preview };
  const scrollTop = current[prev].scrollTop;
  if (prev === 'edit') state.lockBeforeView = state.locked;
  state.view = next;
  if (next === 'syntax') renderSyntax();
  if (next === 'markdown') await renderMarkdown();
  if (state.view !== next) return; // changed again while the Markdown libraries were loading
  for (const [name, el] of Object.entries(current)) el.hidden = name !== next;
  if (next !== 'syntax') highlight.textContent = '';
  if (next !== 'markdown') preview.textContent = '';
  if (next !== 'markdown' && prev !== 'markdown') current[next].scrollTop = scrollTop;
  $('bSyntax').setAttribute('aria-pressed', next === 'syntax');
  $('bMarkdown').setAttribute('aria-pressed', next === 'markdown');
  setLock(next === 'edit' ? state.lockBeforeView : true);
  if (next === 'edit' && !state.locked) editor.focus();
  hint = '';
  refreshName();
  updateStatus();
  saveDoc();
  if (!findBar.hidden) runFind();
}
function toggleView(view) { return setView(state.view === view ? 'edit' : view); }

/* Unlocking always returns to plain editing. */
async function unlock() {
  state.lockBeforeView = false;
  if (state.view === 'edit') setLock(false); else await setView('edit');
  saveDoc();
}

/* Text direction follows the first letter of the text (the UI direction when empty).
   Done here because dir="auto" on a textarea is quadratic in Chromium for large documents. */
const RTL_FIRST = /^[^A-Za-z\u00C0-\u024F\u0370-\u058F\u0900-\uD7FF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
function updateDirection() {
  const head = editor.value.slice(0, 300);
  const dir = (head.trim() ? RTL_FIRST.test(head) : T.rtl) ? 'rtl' : 'ltr';
  const ws = $('workspace');
  if (ws.dir !== dir) ws.dir = dir;
}

/* Call after any change to the text. */
function afterChange() {
  updateDirection();
  if (state.view === 'syntax') renderSyntax();
  else if (state.view === 'markdown') renderMarkdown();
  updateStatus();
  updateInvite();
  saveDoc();
  if (!findBar.hidden) scheduleFind(380);
}

function setText(text) {
  editor.value = text;
  afterChange();
}

function insertText(text) {
  if (!text) return;
  editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
  afterChange();
}

/* ── Clipboard ── */
async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    const x = document.createElement('textarea');
    x.value = text; x.style.cssText = 'position:fixed;opacity:0';
    document.body.append(x); x.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* not allowed */ }
    x.remove();
    toast(ok ? msg : T.copyFailed);
  }
}
function copy() {
  const s = editor.selectionStart, e = editor.selectionEnd;
  if (s !== e) copyText(editor.value.slice(s, e), T.selCopied); else copyText(editor.value, T.copied);
}
async function paste() {
  if (state.locked && editor.value) { deny(); return; }
  if (state.view === 'edit') editor.focus();
  const wasEmpty = !editor.value.trim();
  try {
    insertText(await navigator.clipboard.readText());
    toast(T.pasted);
    showFormatted(wasEmpty);
  } catch { toast(T.ctrlV); }
}
function clearAll() {
  if (guard() || !editor.value) return;
  setText('');
  toast(T.cleared);
  editor.focus();
}

/* ── Files ── */
/* Take over a real file name: its extension becomes fixed. */
function setName(name) {
  [fileName.value, fileExt.value] = splitName(name);
  bareName = !fileExt.value;
  refreshName();
}
function dropHandleIfRenamed() { if (fileHandle && fileHandle.name !== fullName()) fileHandle = null; } // the next save asks where to write
async function loadFile(file, handle = null) {
  const text = await file.text();
  if (editor.value.trim()) { saveDocNow(); docId = newId(); } // the replaced note stays under Recent
  fileHandle = handle;
  setName(file.name);
  setText(text);
  if (state.view === 'edit') editor.focus();
  toast(`${file.name} ${T.opened}`);
  showFormatted(true);
}
function openDropped(file) { loadFile(file).catch(() => toast(T.openFailed)); } // a folder or an unreadable file
async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker();
      await loadFile(await handle.getFile(), handle);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  $('fileInput').value = '';
  $('fileInput').click();
}
async function saveFile() {
  const name = fullName();
  try {
    if (!fileHandle && window.showSaveFilePicker) fileHandle = await window.showSaveFilePicker({ suggestedName: name });
    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(editor.value);
      await writable.close();
      setName(fileHandle.name);
      saveDoc();
      toast(`${T.saved}: ${fileHandle.name}`);
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    fileHandle = null; // picker unavailable here (e.g. permission denied): fall back to a download
  }
  const a = document.createElement('a');
  // Without an extension, text/plain would make the browser append .txt to the download.
  a.href = URL.createObjectURL(new Blob([editor.value], { type: name.includes('.') ? 'text/plain' : 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${T.saved}: ${name}`);
}
function newTab() { window.open(location.href, '_blank', 'noopener'); } // noopener: the new tab must not inherit this tab's text

/* ── Find & replace ── */
let matches = [], current = -1, landed = false, findTimer;
const canMark = !!(window.CSS && CSS.highlights);

function findRegex() {
  const q = findInput.value;
  if (!q) return null;
  const flags = 'g' + ($('chkCase').checked ? '' : 'i');
  try { return new RegExp($('chkRegex').checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags); } catch { return null; }
}
function offsetsIn(text, re) {
  const out = [];
  for (let m; (m = re.exec(text)) !== null && out.length < 5000;) {
    if (m[0]) out.push([m.index, m.index + m[0].length]); else re.lastIndex++;
  }
  return out;
}
/* In a read-only view the search runs over the rendered text and yields DOM ranges. */
function rangesIn(el, re) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
  let text = '';
  for (let n; (n = walker.nextNode());) { nodes.push([n, text.length]); text += n.data; }
  let i = 0;
  const locate = (pos) => {
    while (i + 1 < nodes.length && nodes[i + 1][1] <= pos) i++;
    return [nodes[i][0], pos - nodes[i][1]];
  };
  return offsetsIn(text, re).map(([s, e]) => {
    const range = document.createRange();
    range.setStart(...locate(s));
    range.setEnd(...locate(e));
    return range;
  });
}
function viewEl() { return state.view === 'syntax' ? highlight : state.view === 'markdown' ? preview : null; }
function clearMarks() { if (canMark) { CSS.highlights.delete('qwn-find'); CSS.highlights.delete('qwn-find-current'); } }
function showCount() {
  const n = matches.length;
  $('findCount').textContent = !findInput.value ? '' : !n ? T.noMatch :
    `${current + 1}/${n} ${n === 1 ? T.match : T.matches}`;
}
function runFind() {
  clearTimeout(findTimer);
  clearMarks();
  matches = []; current = -1; landed = false;
  const re = findRegex(), el = viewEl();
  if (re) matches = el ? rangesIn(el, re) : offsetsIn(editor.value, re);
  if (matches.length) {
    current = 0;
    if (el && canMark) CSS.highlights.set('qwn-find', new Highlight(...matches));
  }
  showCount();
}
function scheduleFind(ms) { clearTimeout(findTimer); findTimer = setTimeout(runFind, ms); }
function goMatch(step) {
  if (!matches.length) { runFind(); if (!matches.length) return; }
  if (!landed && step > 0) step = 0; // the first "next" lands on the first match
  landed = true;
  current = (current + step + matches.length) % matches.length;
  const m = matches[current], el = viewEl();
  if (el) {
    if (canMark) CSS.highlights.set('qwn-find-current', new Highlight(m));
    else { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(m); }
    const r = m.getBoundingClientRect(), box = el.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) el.scrollTop += r.top - box.top - el.clientHeight / 3;
  } else {
    editor.focus();
    editor.setSelectionRange(m[0], m[1]);
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, (editor.value.slice(0, m[0]).split('\n').length - 3) * lineHeight);
    updateStatus();
  }
  showCount();
}
function openFind() {
  findBar.hidden = false;
  $('bFind').setAttribute('aria-pressed', 'true');
  const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
  if (sel && !sel.includes('\n')) findInput.value = sel;
  findInput.focus();
  findInput.select();
  runFind();
}
function closeFind() {
  findBar.hidden = true;
  $('bFind').setAttribute('aria-pressed', 'false');
  clearMarks();
  matches = []; current = -1;
  (viewEl() || editor).focus();
}
function replaceOne() {
  if (guard()) return;
  if (!matches.length) { runFind(); if (!matches.length) return; }
  const [s, e] = matches[current], at = current;
  editor.setRangeText(replaceInput.value, s, e, 'end');
  afterChange();
  runFind();
  if (matches.length) { current = Math.min(at, matches.length - 1); goMatch(0); }
  toast(T.replaced);
}
function replaceAll() {
  if (guard()) return;
  const re = findRegex();
  if (!re) return;
  let count = 0;
  const text = editor.value.replace(re, () => { count++; return replaceInput.value; });
  if (!count) return;
  setText(text);
  runFind();
  toast(`${T.replaced}: ${count}`);
}

/* ── Escape: twice clears; when locked, three times unlocks and clears ── */
let escCount = 0, escTimer;
async function onEscape() {
  if (!findBar.hidden) { closeFind(); escCount = 0; return; }
  if (!editor.value && !state.locked) return;
  escCount++;
  clearTimeout(escTimer);
  escTimer = setTimeout(() => { escCount = 0; setHint(''); }, state.locked ? 4000 : 500);
  if (state.locked) {
    if (escCount === 1) setHint(T.esc2);
    else if (escCount === 2) setHint(T.esc1);
    else {
      clearTimeout(escTimer); escCount = 0;
      await unlock();
      setText('');
      toast(T.unlockCleared);
      editor.focus();
    }
  } else if (escCount === 1) setHint(T.escAgain);
  else {
    clearTimeout(escTimer); escCount = 0;
    setHint('');
    setText('');
    toast(T.cleared);
    editor.focus();
  }
}

/* ── Appearance ── */
function setZoom(z) {
  state.zoom = Math.max(50, Math.min(300, z));
  root.style.setProperty('--zoom', state.zoom / 100);
  $('bZoomReset').textContent = state.zoom + '%';
  $('stZoom').textContent = state.zoom + '%';
  savePrefs();
}
function setWrap(on) {
  state.wrap = on;
  $('workspace').classList.toggle('wrap', on);
  $('bWrap').setAttribute('aria-pressed', on);
  savePrefs();
}
function setTheme(theme) {
  state.theme = root.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#14151b' : '#fbf9f4';
  const b = $('bTheme'), key = theme === 'dark' ? 'light' : 'dark'; // the button offers the other theme
  setIcon(b, theme === 'dark' ? 'sun' : 'moon');
  label('bTheme', key);
}

/* ── Language ── */
const SHORTCUTS = {
  bOpen: `${MOD}+O`, bSave: `${MOD}+S`, bPaste: `${MOD}+V`, bCopy: `${MOD}+Shift+C`, bClear: 'Esc Esc',
  bWrap: `${ALT}+Z`, bFind: `${MOD}+F`, bSyntax: `${MOD}+Shift+H`, bMarkdown: `${ALT}+M`, bLock: `${MOD}+Shift+L`,
  bZoomOut: `${MOD}+−`, bZoomReset: `${MOD}+0`, bZoomIn: `${MOD}+=`, bFindPrev: 'Shift+Enter', bFindNext: 'Enter',
};
const LABELS = {
  bOpen: 'file', bNewTab: 'newTab', bSave: 'save', bPaste: 'paste', bCopy: 'copy', bClear: 'clear', bWrap: 'wrap',
  bFind: 'find', bSyntax: 'syntax', bMarkdown: 'markdown', bLock: 'lock', bZoomOut: 'zoomOut', bZoomReset: 'zoomReset',
  bZoomIn: 'zoomIn', bFindPrev: 'prev', bFindNext: 'next', bFindClose: 'close', bRecent: 'recent',
};
function label(id, key) {
  const b = $(id), text = T[key], lbl = b.querySelector('.lbl');
  if (lbl) lbl.textContent = text;
  b.setAttribute('aria-label', text);
  b.title = SHORTCUTS[id] ? `${text} (${SHORTCUTS[id]})` : text;
}
function applyLang(code) {
  state.lang = LANGS[code] ? code : 'en';
  T = { ...LANGS.en, ...LANGS[state.lang] };
  setTitle();
  root.lang = state.lang;
  root.dir = T.rtl ? 'rtl' : 'ltr';
  $('langSelect').value = state.lang;
  for (const [id, key] of Object.entries(LABELS)) label(id, key);
  setTheme(state.theme);
  $('recentTitle').textContent = T.recent;
  $('bDeleteAll').textContent = T.deleteAll;
  document.querySelector('[data-k="keepNotes"]').textContent = T.keepNotes;
  if (recentOpen()) renderRecent();
  $('bReplace').textContent = T.replace;
  $('bReplaceAll').textContent = T.all;
  $('lblCase').textContent = T.caseS;
  $('lblRegex').textContent = T.regex;
  findInput.placeholder = T.find + '…';
  findInput.setAttribute('aria-label', T.find);
  replaceInput.placeholder = T.replace + '…';
  replaceInput.setAttribute('aria-label', T.replace);
  $('langSelect').setAttribute('aria-label', T.language);
  fileName.setAttribute('aria-label', T.fileName);
  fileExt.setAttribute('aria-label', T.fileExt);
  editor.setAttribute('aria-label', T.editor);
  $('toolbar').setAttribute('aria-label', T.toolbar);
  $('adStrip').setAttribute('aria-label', T.ad);
  $('stLock').textContent = T.locked;
  $('aboutLink').textContent = T.about;
  $('aboutLink').href = T.aboutUrl; // Portuguese and Spanish have their own About page
  for (const el of document.querySelectorAll('#intro [data-k]')) el.textContent = T[el.dataset.k];
  hint = '';
  updateDirection();
  updateStatus();
  showCount();
  fitToolbar();
}

/* Labels take more room in some languages. When the toolbar does not fit, the buttons first move
   closer together, then drop the labels of the clearest icons, and then show icons only (their names stay in the tooltip and for screen readers). */
function fitToolbar() {
  const bar = $('toolbar');
  bar.classList.remove('tight', 'lean', 'compact');
  for (const step of ['tight', 'lean', 'compact']) {
    if (bar.scrollWidth <= bar.clientWidth) return;
    bar.classList.add(step);
  }
}
addEventListener('resize', fitToolbar);
document.fonts?.ready.then(fitToolbar);

/* ── Wiring ── */
$('bOpen').onclick = openFile;
$('fileInput').onchange = () => { const f = $('fileInput').files[0]; if (f) openDropped(f); };
$('bIntroOpen')?.addEventListener('click', openFile);
$('bNewTab').onclick = newTab;
$('bSave').onclick = saveFile;
$('bPaste').onclick = paste;
$('bCopy').onclick = copy;
$('bClear').onclick = clearAll;
$('bWrap').onclick = () => setWrap(!state.wrap);
$('bFind').onclick = () => (findBar.hidden ? openFind() : closeFind());
$('bSyntax').onclick = () => toggleView('syntax');
$('bMarkdown').onclick = () => toggleView('markdown');
$('bLock').onclick = async () => {
  escCount = 0;
  if (state.locked) { await unlock(); toast(T.unlocked); editor.focus(); }
  else { setLock(true); saveDoc(); toast(T.locked); }
};
$('bZoomOut').onclick = () => setZoom(state.zoom - 10);
$('bZoomReset').onclick = () => setZoom(100);
$('bZoomIn').onclick = () => setZoom(state.zoom + 10);
$('bTheme').onclick = () => { prefs.theme = state.theme === 'dark' ? 'light' : 'dark'; setTheme(prefs.theme); savePrefs(); };
$('langSelect').onchange = (e) => {
  prefs.lang = e.target.value;
  applyLang(prefs.lang);
  savePrefs();
  // Keep the address on the matching localized page without reloading, so the text and open file survive.
  if (/^\/(?:[a-z]{2}\/)?$/.test(location.pathname)) history.replaceState(null, '', prefs.lang === 'en' ? '/' : `/${prefs.lang}/`);
};

$('bFindClose').onclick = closeFind;
$('bFindPrev').onclick = () => goMatch(-1);
$('bFindNext').onclick = () => goMatch(1);
$('bReplace').onclick = replaceOne;
$('bReplaceAll').onclick = replaceAll;
findInput.oninput = () => scheduleFind(250);
$('chkCase').onchange = $('chkRegex').onchange = runFind;
findBar.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  else if (e.key === 'Enter' && e.target === findInput) {
    e.preventDefault();
    goMatch(e.shiftKey ? -1 : 1);
    if (viewEl()) findInput.focus();
  }
});

const afterRename = () => {
  dropHandleIfRenamed();
  refreshName();
  if (state.view === 'syntax') { renderSyntax(); updateMode(); }
  saveDoc();
};
fileName.onfocus = () => setTimeout(() => fileName.select());
fileName.oninput = refreshName;
fileName.onchange = () => {
  const [base, ext] = splitName(fileName.value.trim()); // "notes.md" typed or pasted into the name field
  fileName.value = base || DEFAULT_BASE;
  if (ext) { fileExt.value = ext; bareName = false; }
  afterRename();
};
fileName.onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); (viewEl() || editor).focus(); }
  else if (e.key === '.' && fileName.selectionStart === fileName.value.length) { e.preventDefault(); fileExt.focus(); fileExt.select(); } // a dot at the end moves on to the extension
};
fileExt.oninput = () => {
  fileExt.value = fileExt.value.replace(/[^A-Za-z0-9_+-]/g, '').slice(0, 10);
  bareName = false;
  refreshName();
};
fileExt.onchange = afterRename;
fileExt.onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); (viewEl() || editor).focus(); }
  else if (e.key === 'Backspace' && !fileExt.value) { e.preventDefault(); fileName.focus(); }
};

editor.addEventListener('input', afterChange);
for (const type of ['keyup', 'click', 'select']) editor.addEventListener(type, updateStatus);
editor.addEventListener('paste', (e) => {
  const wasEmpty = !editor.value;
  if (!state.locked) { // the browser pastes; undo keeps working
    if (wasEmpty) { toast(T.pasted); setTimeout(() => showFormatted(true)); }
    return;
  }
  e.preventDefault();
  if (!wasEmpty) { deny(); return; }
  insertText(e.clipboardData.getData('text')); // a locked, empty note still accepts one paste
  toast(T.pasted);
  showFormatted(true);
});

/* A file dropped anywhere on the page is opened. Text dragged within the editor is left to the browser. */
const draggingFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (draggingFiles(e)) { dragDepth++; root.classList.add('dropping'); } });
addEventListener('dragleave', (e) => { if (draggingFiles(e) && --dragDepth <= 0) { dragDepth = 0; root.classList.remove('dropping'); } });
addEventListener('dragover', (e) => { if (draggingFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('drop', (e) => {
  dragDepth = 0; root.classList.remove('dropping');
  if (!draggingFiles(e)) return;
  e.preventDefault(); // otherwise the browser leaves the page to show the file
  const file = e.dataTransfer.files[0];
  if (file) openDropped(file);
});
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { // Shift+Tab still leaves the editor
    e.preventDefault();
    if (!guard()) insertText('  ');
  } else if (state.locked && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) deny();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && recentOpen()) return; // Esc closes the menu, it does not clear
  if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); setWrap(!state.wrap); }
    else if (e.code === 'KeyM') { e.preventDefault(); toggleView('markdown'); }
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  const run = (fn) => { e.preventDefault(); fn(); };
  if (k === '0') run(() => setZoom(100));
  else if (k === '-' || k === '_') run(() => setZoom(state.zoom - 10));
  else if (k === '=' || k === '+') run(() => setZoom(state.zoom + 10));
  else if (e.shiftKey) {
    if (k === 'h') run(() => toggleView('syntax'));
    else if (k === 'l') run(() => $('bLock').click());
    else if (k === 'c') run(copy);
  } else if (k === 's') run(saveFile);
  else if (k === 'o') run(openFile);
  else if (k === 'f') run(openFind);
});

addEventListener('pagehide', saveDocNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveDocNow(); });

$('chkKeep').onchange = () => {
  if (!$('chkKeep').checked) {
    if ((noteIndex().length || editor.value.trim()) && !confirm(T.confirmDeleteAll)) { $('chkKeep').checked = true; return; }
    deleteAllNotes();
  }
  prefs.keepNotes = $('chkKeep').checked;
  savePrefs();
  if (keeping()) keepNote();
  renderRecent();
};
$('bDeleteAll').onclick = () => {
  if (!confirm(T.confirmDeleteAll)) return;
  const mine = docId;
  for (const n of noteIndex()) if (n.id !== mine) dropNote(n.id); // the open note stays until it is closed or emptied
  renderRecent();
  $('chkKeep').focus();
};

/* ── Start ── */
$('stVersion').textContent = VERSION;
if (typeof saved.text === 'string') editor.value = saved.text;
if ('ext' in saved) { fileName.value = saved.name || DEFAULT_BASE; fileExt.value = saved.ext || ''; bareName = !!saved.bare; }
refreshName();
applyLang(state.lang);
setZoom(state.zoom);
setWrap(state.wrap);
setLock(!!saved.locked);
if (saved.view === 'syntax' || saved.view === 'markdown') await setView(saved.view);
{ // a note reopened from the Recent list of another tab (…#open=<id>)
  const id = decodeURIComponent((/^#open=(.+)$/.exec(location.hash) || [])[1] || '');
  if (id) {
    history.replaceState(null, '', location.pathname + location.search);
    const n = noteIndex().find((x) => x.id === id);
    if (n && !editor.value.trim()) adoptNote(n);
  }
}
updateStatus();
updateInvite();
if (state.view === 'edit') editor.focus();

/* A file opened with the installed app ("Open with" in the system) arrives here; saving writes back to it. */
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async ({ files }) => {
    if (!files || !files.length) return;
    try { await loadFile(await files[0].getFile(), files[0]); } catch { toast(T.openFailed); }
  });
}

/* The ad code is about eight times the size of the app, so it is fetched only after the page has
   loaded and the browser is idle. Offline or blocked, the strip simply stays collapsed. */
function loadAd() {
  if (!navigator.onLine) return;
  const ins = document.querySelector('#adStrip ins'), script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ins.dataset.adClient}`;
  script.onload = () => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ad code unavailable */ } };
  document.head.append(script);
}
const whenIdle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 4000 }) : (fn) => setTimeout(fn, 1500);
if (document.readyState === 'complete') whenIdle(loadAd); else addEventListener('load', () => whenIdle(loadAd), { once: true });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
