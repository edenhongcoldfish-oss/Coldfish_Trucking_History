'use strict';
// Builds a single-file clickable preview that needs no server -> dist/preview.html
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('public/style.css') + `
.demo-bar{background:var(--brand-soft);color:var(--brand);font-size:.85rem;padding:6px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.demo-bar button{background:none;border:1px solid currentColor;color:inherit;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:.8rem}`;
// claude.ai artifacts add the doctype/head/body skeleton, so write content only
const html = `<title>Trip Log Draft</title>
<style>${css}
header.top{top:env(safe-area-inset-top,0px)}</style>
<div class="demo-bar">Preview: runs entirely in this browser with no server. Data stays on this device only. <button id="demo-reset" type="button">Reset demo data</button></div>
<div id="app"></div>
<script>${read('shared/logic.js')}</script>
<script>${read('preview/mock-api.js')}</script>
<script>document.getElementById('demo-reset').addEventListener('click', function () { window.MockAPI.reset(); });</script>
<script>${read('public/app.js')}</script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'preview.html'), html);
console.log('dist/preview.html', (html.length / 1024).toFixed(0) + 'KB');
