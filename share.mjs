/* =========================================================================
   share.mjs — put the running game on a public URL for a few hours
   -------------------------------------------------------------------------
   `npm run share` starts the server and opens a tunnel to it, so friends on
   any network can join with a link.  Nothing is installed permanently and no
   account is needed; the tunnel dies when you press Ctrl-C.

   For something that stays up without your laptop, deploy instead — see the
   "Playing with friends" section of the README.
   ========================================================================= */

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const PORT = Number(process.env.PORT) || 3000;
const children = [];
const bye = () => { for (const c of children) { try { c.kill('SIGTERM'); } catch { /* already gone */ } } };
process.on('SIGINT', () => { bye(); process.exit(0); });
process.on('SIGTERM', () => { bye(); process.exit(0); });

const has = cmd => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
const portOpen = () => new Promise(res => {
  const s = net.connect(PORT, '127.0.0.1');
  s.on('connect', () => { s.destroy(); res(true); });
  s.on('error', () => res(false));
  setTimeout(() => { s.destroy(); res(false); }, 400);
});

const banner = (url) => {
  const line = '─'.repeat(Math.max(34, url.length + 8));
  console.log(`\n  ┌${line}┐`);
  console.log(`  │   Send this to your friends:${' '.repeat(Math.max(0, line.length - 30))}│`);
  console.log(`  │   ${url}${' '.repeat(Math.max(0, line.length - url.length - 4))}│`);
  console.log(`  └${line}┘`);
  console.log('\n  They can be on any network. Ctrl-C ends the tunnel.\n');
};

const run = async () => {
  /* --- 1. make sure the game itself is up ------------------------------- */
  if (await portOpen()) {
    console.log(`  Using the server already listening on :${PORT}`);
  } else {
    console.log(`  Starting the game server on :${PORT} …`);
    const srv = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: process.env });
    children.push(srv);
    srv.on('exit', code => { if (code) { bye(); process.exit(code); } });
    for (let i = 0; i < 40 && !(await portOpen()); i++) await new Promise(r => setTimeout(r, 250));
    if (!(await portOpen())) { console.error('  Server did not come up.'); bye(); process.exit(1); }
  }

  /* --- 2. open a tunnel -------------------------------------------------- */
  // cloudflared is by far the most reliable: real WebSockets, no interstitial.
  if (has('cloudflared')) {
    console.log('  Opening a Cloudflare tunnel …');
    const t = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], { env: process.env });
    children.push(t);
    let shown = false;
    const scan = buf => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !shown) { shown = true; banner(m[0]); }
    };
    t.stdout.on('data', scan);
    t.stderr.on('data', scan);          // cloudflared logs the URL on stderr
    t.on('exit', () => { bye(); process.exit(0); });
    return;
  }

  // fallback: localtunnel via npx. Works, but it shows visitors a one-time
  // "click to continue" page and asks for the tunnel password below.
  console.log('  cloudflared not found — falling back to localtunnel via npx …');
  console.log('  (for a smoother link: brew install cloudflared)\n');
  const t = spawn('npx', ['--yes', 'localtunnel', '--port', String(PORT)], { env: process.env });
  children.push(t);
  let shown = false;
  t.stdout.on('data', buf => {
    const m = String(buf).match(/https:\/\/\S+\.loca\.lt/);
    if (m && !shown) {
      shown = true;
      banner(m[0]);
      console.log('  localtunnel shows a one-time interstitial. The password it asks for');
      console.log('  is your public IP — get it from https://loca.lt/mytunnelpassword\n');
    }
  });
  t.stderr.on('data', b => process.stderr.write(b));
  t.on('exit', () => { bye(); process.exit(0); });
};

run().catch(e => { console.error(e); bye(); process.exit(1); });
