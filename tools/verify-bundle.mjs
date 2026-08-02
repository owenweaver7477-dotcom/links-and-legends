#!/usr/bin/env node
/* =========================================================================
   verify-bundle.mjs — would this build survive being uploaded to a portal?
   -------------------------------------------------------------------------
   CrazyGames serves an uploaded bundle from a SUBDIRECTORY, not from the
   domain root.  Any absolute path in the build therefore resolves against
   the portal's own root and 404s.  The failure mode is nasty because it is
   silent in every local test: served from our own server at "/", absolute
   paths work perfectly.  On the portal the same build renders as an
   unstyled white page with the SDK reported as missing.

   So this serves public/ from a deliberately nested path and follows every
   asset reference the way a browser would, from index.html through the
   module graph.  Anything that does not resolve is a launch blocker.

     node tools/verify-bundle.mjs
   ========================================================================= */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PREFIX = '/en_US/links-and-legends';   // the shape of a real portal path

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(PREFIX)) { res.writeHead(404).end('outside bundle'); return; }
  let rel = url.pathname.slice(PREFIX.length) || '/';
  if (rel.endsWith('/')) rel += 'index.html';
  try {
    const body = await fs.readFile(path.join(PUBLIC, rel));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});

await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}${PREFIX}/`;

/* ------------------------------------------------------------------------
   Walk the build the way a browser does: start at index.html, follow every
   reference, and keep going through imports.  Absolute references are
   recorded as failures rather than followed, because that is the bug.
   ------------------------------------------------------------------------ */
const seen = new Set();
const problems = [];
let checked = 0;

const REFS = [
  /<script[^>]+src=["']([^"']+)["']/g,
  /<link[^>]+href=["']([^"']+)["']/g,
  /<img[^>]+src=["']([^"']+)["']/g,
  /<meta[^>]+content=["'](https?:\/\/[^"']+|[^"':]+\.(?:png|jpg|svg))["']/g,
  /\bfrom\s+["']([^"']+)["']/g,          // static imports
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\burl\(\s*["']?([^"')]+)["']?\s*\)/g  // css
];

async function walk(relUrl, fromLabel) {
  if (seen.has(relUrl)) return;
  seen.add(relUrl);

  const abs = new URL(relUrl, base);
  const res = await fetch(abs);
  checked++;
  if (!res.ok) {
    problems.push(`${res.status} ${relUrl}  (referenced by ${fromLabel})`);
    return;
  }
  const ext = path.extname(abs.pathname);
  if (!['.html', '.js', '.mjs', '.css'].includes(ext)) return;

  const text = await res.text();
  for (const re of REFS) {
    for (const [, ref] of text.matchAll(re)) {
      if (!ref || ref.startsWith('data:') || ref.startsWith('#')) continue;
      if (/^https?:\/\//.test(ref)) continue;                 // external CDN: fine
      if (ref.startsWith('/')) {
        problems.push(`ABSOLUTE PATH "${ref}" in ${relUrl} — 404s from a subdirectory`);
        continue;
      }
      await walk(new URL(ref, abs).href.slice(base.length), relUrl);
    }
  }
}

await walk('index.html', '(entry)');
server.close();

/* ------------------------------------------------------------------- size */
async function dirSize(dir) {
  let total = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.endsWith('.br') || e.name.endsWith('.gz')) continue;  // not uploaded
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await fs.stat(p)).size;
  }
  return total;
}
const mb = (await dirSize(PUBLIC)) / 1024 / 1024;
const LIMIT = 23;

console.log(`\n  bundle served from ${PREFIX}/`);
console.log(`  ${checked} assets followed from index.html through the module graph`);
console.log(`  size ${mb.toFixed(2)} MB of the ${LIMIT} MB target\n`);

if (mb > LIMIT) problems.push(`bundle is ${mb.toFixed(1)} MB, over the ${LIMIT} MB target`);

if (problems.length) {
  console.error('  NOT portal-safe:\n');
  for (const p of problems) console.error('   - ' + p);
  console.error('');
  process.exit(1);
}
console.log('  portal-safe: every reference resolves from a subdirectory.\n');
