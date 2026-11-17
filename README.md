# Quick Web Notepad

A fast, private notepad that runs in the browser. No account, no backend, no build step.

**Live:** https://qwnotepad.ofcodedev.me/

## Features

- Plain text editing; open and save local files (saves in place where the browser supports the File System Access API, otherwise downloads)
- Find and replace with match case and regex
- Syntax view: read-only highlighting for JS, Python, HTML, CSS, JSON, SQL, shell, C, Markdown
- Markdown view: read-only rendered preview (GFM tables, task lists, highlighted code blocks)
- Lock mode to protect the text from accidental edits
- Light and dark themes, zoom, word wrap
- 15 interface languages, detected from the browser
- Installable and usable offline (PWA)
- The text of each tab survives a reload; a new tab always starts empty

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Open / Save | Ctrl+O / Ctrl+S |
| Find | Ctrl+F |
| Copy all or selection | Ctrl+Shift+C |
| Syntax view | Ctrl+Shift+H |
| Markdown view | Alt+M |
| Lock | Ctrl+Shift+L |
| Word wrap | Alt+Z |
| Zoom | Ctrl+= / Ctrl+− / Ctrl+0 |
| Clear | Esc Esc (Esc ×3 when locked) |

## Project layout

```
index.html              the app page
assets/app.css          styles; the color palette is the token block at the top
assets/app.js           app logic (ES module)
assets/i18n.js          interface strings
assets/page.css         styles for the static pages
assets/vendor/          marked and DOMPurify, pinned and served locally
sw.js                   service worker (offline support)
manifest.webmanifest    PWA manifest
about.html, privacy.html, contact.html, 404.html
```

## Development

Serve the folder with any static server, for example:

```
python3 -m http.server 8000
```

When a cached file list changes, bump `CACHE` in `sw.js`.

## Author

Created by OFCode-dev
