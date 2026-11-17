import { LANGS, detectLang } from './i18n.js';

const VERSION = 'v3.0';
const APP = 'Quick Web Notepad';
const DEFAULT_NAME = 'Untitled.txt';
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const ALT = IS_MAC ? '⌥' : 'Alt';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const editor = $('editor'), highlight = $('highlight'), preview = $('preview');
const fileName = $('fileName'), findBar = $('findBar'), findInput = $('findInput'), replaceInput = $('replaceInput');

/* ── Storage: the document is per tab (sessionStorage), preferences are shared (localStorage) ── */
function load(kind, key) {
  try { return JSON.parse(window[kind].getItem(key)) || {}; } catch { return {}; }
}
function store(kind, key, value) {
  try { window[kind].setItem(key, JSON.stringify(value)); } catch { /* storage blocked or full */ }
}
const prefs = load('localStorage', 'qwn:prefs');
const saved = load('sessionStorage', 'qwn:doc');

const state = {
  view: 'edit',            // 'edit' | 'syntax' | 'markdown'
  locked: false,
  lockBeforeView: false,   // lock state to return to when a view is closed
  wrap: !!prefs.wrap,
  zoom: prefs.zoom || 100,
  theme: root.dataset.theme,
  lang: LANGS[prefs.lang] ? prefs.lang : detectLang(),
  syntaxLang: '',
};
let T = LANGS.en;
let fileHandle = null;

function savePrefs() {
  store('localStorage', 'qwn:prefs', { theme: prefs.theme, lang: prefs.lang, zoom: state.zoom, wrap: state.wrap });
}
let saveTimer;
function saveDocNow() {
  clearTimeout(saveTimer);
  store('sessionStorage', 'qwn:doc', {
    text: editor.value, name: fileName.value, view: state.view,
    locked: state.view === 'edit' ? state.locked : state.lockBeforeView,
  });
}
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
function updateInvite() { $('bPaste').classList.toggle('invite', !editor.value && !state.locked); }

function setTitle(name) { document.title = `${name} | ${APP}`; }
function setIcon(button, icon) { button.querySelector('use').setAttribute('href', '#i-' + icon); }

/* ── Status bar ── */
let hint = '';
function setHint(text) { hint = text; updateMode(); }
function updateMode() {
  $('stMode').textContent = hint ||
    (state.view === 'markdown' ? 'MARKDOWN' : state.view === 'syntax' ? state.syntaxLang.toUpperCase() : '');
}
function updateStatus() {
  const txt = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
  const before = txt.slice(0, s).split('\n');
  $('stPos').textContent = `${T.ln} ${before.length}/${txt.split('\n').length} · ${T.col} ${before.pop().length + 1}`;
  $('stWords').textContent = `${countWords(txt)} ${T.words}`;
  $('stChars').textContent = `${txt.length} ${T.chars}`;
  $('stZoom').textContent = state.zoom + '%';
  const sel = txt.slice(s, e);
  $('stSel').hidden = !sel;
  if (sel) $('stSel').textContent = `${T.sel} ${sel.length} · ${countWords(sel)} ${T.words}`;
  $('stLock').hidden = !state.locked;
  updateMode();
}

/* ── Syntax highlighting ── */
function detectSyntax(name, text) {
  const ext = (name.split('.').pop() || '').toLowerCase(), head = text.slice(0, 400);
  const byExt = { js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', html: 'html', htm: 'html', css: 'css', json: 'json', py: 'py', sh: 'sh', bash: 'sh', sql: 'sql', c: 'c', cpp: 'c', h: 'c', md: 'md' };
  if (byExt[ext]) return byExt[ext];
  if (/^\s*<(!DOCTYPE|html)/i.test(head)) return 'html';
  if (/^\s*\{[\s\S]{0,40}"\w+":/m.test(head)) return 'json';
  if (/\bdef\s+\w+\s*\(/.test(head)) return 'py';
  if (/\b(const|let|var)\s+\w+/.test(head)) return 'js';
  if (/\bSELECT\b.{1,40}\bFROM\b/i.test(head)) return 'sql';
  return '';
}
const FENCE_ALIAS = { javascript: 'js', typescript: 'js', ts: 'js', jsx: 'js', tsx: 'js', python: 'py', shell: 'sh', bash: 'sh', zsh: 'sh', 'c++': 'c', cpp: 'c', htm: 'html', xml: 'html', markdown: 'md' };

const RULES = {
  js: [['cm', /\/\/[^\n]*|\/\*[\s\S]*?\*\//], ['st', /`[\s\S]*?`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/],
    ['kw', /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|typeof|class|extends|import|export|default|async|await|try|catch|finally|throw|null|undefined|true|false)\b/],
    ['tp', /\b(Promise|Array|Object|Map|Set|Error|Date|Math|JSON|console|window|document|Number|String|Boolean)\b/],
    ['nm', /\b\d+\.?\d*\b/], ['fn', /\b[A-Za-z_$][\w$]*(?=\s*\()/]],
  py: [['cm', /#[^\n]*/], ['st', /"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/],
    ['kw', /\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|pass|break|continue|lambda|yield|raise|True|False|None|async|await)\b/],
    ['nm', /\b\d+\.?\d*\b/], ['fn', /\b[A-Za-z_]\w*(?=\s*\()/]],
  html: [['cm', /<!--[\s\S]*?-->/], ['st', /"[^"]*"|'[^']*'/], ['tp', /<\/?\w[\w-]*/], ['at', /\b[\w-]+(?=\s*=)/]],
  css: [['cm', /\/\*[\s\S]*?\*\//], ['st', /"[^"]*"|'[^']*'/],
    ['nm', /#[0-9a-fA-F]{3,8}|\b\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms)?\b/],
    ['tp', /[\w-]+(?=\s*\{)/], ['kw', /\b(color|background|border|margin|padding|font|display|position|width|height|flex|grid|overflow|opacity|transition|transform|content|cursor)\b/]],
  json: [['at', /"(?:[^"\\]|\\.)*"(?=\s*:)/], ['st', /"(?:[^"\\]|\\.)*"/], ['nm', /-?\d+\.?\d*\b/], ['kw', /\b(true|false|null)\b/]],
  sql: [['cm', /--[^\n]*/], ['st', /'(?:[^'\\]|\\.)*'/], ['nm', /\b\d+\.?\d*\b/],
    ['kw', /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|ON|GROUP|BY|ORDER|HAVING|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|AS|AND|OR|NOT|IN|NULL|IS|LIMIT|CASE|WHEN|THEN|ELSE|END)\b/, 'i']],
  sh: [['cm', /#[^\n]*/], ['st', /"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/],
    ['kw', /\b(if|then|else|elif|fi|for|do|done|while|function|return|exit|export|local|source|case|esac)\b/], ['at', /\$[\w{][^}]*}?|\$\d+/]],
  md: [['kw', /^#{1,6} .+$/], ['st', /`{1,3}[\s\S]*?`{1,3}/], ['cm', /\*\*[\s\S]*?\*\*|__[\s\S]*?__/], ['fn', /\[[^\]\n]*\]\([^)\n]*\)/]],
  c: [['cm', /\/\/[^\n]*|\/\*[\s\S]*?\*\//], ['st', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/],
    ['kw', /\b(auto|bool|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|int|long|return|short|sizeof|static|struct|switch|typedef|void|volatile|while)\b/],
    ['nm', /\b\d+\.?\d*\b/], ['fn', /\b[A-Za-z_]\w*(?=\s*\()/]],
};
const COMPILED = {};
function tokenize(text, lang) {
  const rules = RULES[lang];
  if (!text || !rules) return escapeHtml(text);
  // One alternation of named groups; a rule's own groups must be non-capturing.
  const rx = COMPILED[lang] ||= new RegExp(rules.map((r, i) => `(?<g${i}>${r[1].source})`).join('|'),
    'gm' + (rules.some((r) => r[2] === 'i') ? 'i' : ''));
  rx.lastIndex = 0;
  let out = '', pos = 0, m;
  while ((m = rx.exec(text)) !== null) {
    if (!m[0]) { rx.lastIndex++; continue; }
    out += escapeHtml(text.slice(pos, m.index));
    const i = rules.findIndex((_, n) => m.groups['g' + n] !== undefined);
    out += `<span class="${rules[i][0]}">${escapeHtml(m[0])}</span>`;
    pos = rx.lastIndex;
  }
  return out + escapeHtml(text.slice(pos));
}

function renderSyntax() {
  state.syntaxLang = detectSyntax(fileName.value, editor.value);
  highlight.innerHTML = tokenize(editor.value, state.syntaxLang);
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

/* Call after any change to the text. */
function afterChange() {
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
  try {
    insertText(await navigator.clipboard.readText());
    toast(T.pasted);
  } catch { toast(T.ctrlV); }
}
function clearAll() {
  if (guard() || !editor.value) return;
  setText('');
  toast(T.cleared);
  editor.focus();
}

/* ── Files ── */
function setName(name) {
  fileName.value = name;
  setTitle(name);
}
async function loadFile(file, handle = null) {
  const text = await file.text();
  fileHandle = handle;
  setName(file.name);
  setText(text);
  if (state.view === 'edit') editor.focus();
  toast(`${file.name} ${T.opened}`);
}
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
  const name = fileName.value || DEFAULT_NAME;
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
  a.href = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain' }));
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
  bZoomIn: 'zoomIn', bFindPrev: 'prev', bFindNext: 'next', bFindClose: 'close',
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
  root.lang = state.lang;
  root.dir = T.rtl ? 'rtl' : 'ltr';
  $('langSelect').value = state.lang;
  for (const [id, key] of Object.entries(LABELS)) label(id, key);
  setTheme(state.theme);
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
  editor.setAttribute('aria-label', T.editor);
  $('toolbar').setAttribute('aria-label', T.toolbar);
  $('stLock').textContent = T.locked;
  $('aboutLink').textContent = T.about;
  hint = '';
  updateStatus();
  showCount();
}

/* ── Wiring ── */
$('bOpen').onclick = openFile;
$('fileInput').onchange = () => { const f = $('fileInput').files[0]; if (f) loadFile(f); };
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
$('langSelect').onchange = (e) => { prefs.lang = e.target.value; applyLang(prefs.lang); savePrefs(); };

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

fileName.onfocus = () => { const dot = fileName.value.lastIndexOf('.'); setTimeout(() => fileName.setSelectionRange(0, dot > 0 ? dot : fileName.value.length)); };
fileName.oninput = () => { const v = fileName.value.trim(); if (v) setTitle(v.includes('.') ? v : v + '.txt'); };
fileName.onchange = () => {
  let v = fileName.value.trim() || 'Untitled';
  if (!v.includes('.')) v += '.txt';
  if (fileHandle && fileHandle.name !== v) fileHandle = null; // renamed: the next save asks where to write
  setName(v);
  if (state.view === 'syntax') { renderSyntax(); updateMode(); }
  saveDoc();
};
fileName.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); (viewEl() || editor).focus(); } };

editor.addEventListener('input', afterChange);
for (const type of ['keyup', 'click', 'select']) editor.addEventListener(type, updateStatus);
editor.addEventListener('paste', (e) => {
  const wasEmpty = !editor.value;
  if (state.locked && !wasEmpty) { e.preventDefault(); deny(); return; }
  e.preventDefault();
  insertText(e.clipboardData.getData('text'));
  if (wasEmpty) toast(T.pasted);
});
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { // Shift+Tab still leaves the editor
    e.preventDefault();
    if (!guard()) insertText('  ');
  } else if (state.locked && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) deny();
});

document.addEventListener('keydown', (e) => {
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

/* ── Start ── */
for (const [code, lang] of Object.entries(LANGS)) $('langSelect').add(new Option(lang.name, code));
$('stVersion').textContent = VERSION;
if (typeof saved.text === 'string') editor.value = saved.text;
setName(saved.name || DEFAULT_NAME);
applyLang(state.lang);
setZoom(state.zoom);
setWrap(state.wrap);
setLock(!!saved.locked);
if (saved.view === 'syntax' || saved.view === 'markdown') await setView(saved.view);
updateStatus();
updateInvite();
if (state.view === 'edit') editor.focus();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
