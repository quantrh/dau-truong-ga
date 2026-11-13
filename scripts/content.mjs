import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_ORIGIN = 'https://dau-truong-ga-quan.bidv-it-grou-8424.chatgpt.site';
export const SUPABASE_ROOM_API = 'https://rmbsxccrwrktbjlnezpu.supabase.co/functions/v1/rooster-rooms';
export const PUBLIC_GAME_URL = 'https://quantrh.github.io/dau-truong-ga/';
export const SUPABASE_URL = 'https://rmbsxccrwrktbjlnezpu.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtYnN4Y2Nyd3JrdGJqbG5lenB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg2MjczNjQsImV4cCI6MjA2NDIwMzM2NH0.ydCqificftdtn1niRciFCifeuo8aX6SDGti-hCY5Z_Y';
const scripts = ['peerjs.min.js', 'game-engine.js', 'rooster-net.js', 'direct-peer-room.js', 'controls.js', 'progression.js', 'profile.js', 'game-app.js'];
const mimeFor = name => name.endsWith('.woff') ? 'font/woff' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/png';

export async function embeddedAssets() {
  const result = {};
  for (const name of (await readdir(path.join(ROOT, 'assets'))).sort()) {
    result[name] = { mime: mimeFor(name), base64: (await readFile(path.join(ROOT, 'assets', name))).toString('base64') };
  }
  return result;
}

export async function makeHTML({ standalone = false, external = false } = {}) {
  let shell = await readFile(path.join(ROOT, 'client/shell.html'), 'utf8');
  const map = JSON.parse(await readFile(path.join(ROOT, 'client/asset-map.json'), 'utf8'));
  const files = standalone ? await embeddedAssets() : null;
  const assetURL = route => {
    if (standalone) {
      const file = files[route.split('/').pop()];
      return `data:${file.mime};base64,${file.base64}`;
    }
    return external ? PUBLIC_GAME_URL + route.replace(/^\//, '') : route;
  };
  for (const key of ['atlas', 'background', 'walkAtlas']) map[key] = assetURL(map[key]);
  shell = shell.replace(/\/assets\/[a-zA-Z0-9_.-]+/g, assetURL);
  // Same-origin on the hosted site/preview; explicit production origin only
  // for the downloadable HTML and GitHub Pages frontend.
  const config = `window.ROOSTER_ONLINE_API=${JSON.stringify(SUPABASE_ROOM_API)};window.ROOSTER_PUBLIC_GAME_URL=${JSON.stringify(PUBLIC_GAME_URL)};window.ROOSTER_SUPABASE_URL=${JSON.stringify(SUPABASE_URL)};window.ROOSTER_SUPABASE_KEY=${JSON.stringify(SUPABASE_KEY)};window.ROOSTER_ONLINE_ORIGIN='';`;
  const parts = [`<script>${config}window.ROOSTER_ASSETS=${JSON.stringify(map).replace(/<\//g, '<\\/')};</script>`];
  for (const name of scripts) {
    const script = await readFile(path.join(ROOT, 'client', name), 'utf8');
    parts.push('<script>\n' + script.replace(/<\/script/gi, '<\\/script') + '\n</script>');
  }
  return shell.replace('<!--GAME_SCRIPTS-->', parts.join('\n'));
}
