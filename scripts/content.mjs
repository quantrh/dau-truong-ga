import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_ORIGIN = 'https://dau-truong-ga-quan.bidv-it-grou-8424.chatgpt.site';
const scripts = ['peerjs.min.js', 'game-engine.js', 'rooster-net.js', 'controls.js', 'game-app.js'];
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
    return external ? SITE_ORIGIN + route : route;
  };
  for (const key of ['atlas', 'background', 'walkAtlas']) map[key] = assetURL(map[key]);
  shell = shell.replace(/\/assets\/[a-zA-Z0-9_.-]+/g, assetURL);
  // Same-origin on the hosted site/preview; explicit production origin only
  // for the downloadable HTML and GitHub Pages frontend.
  const config = `window.ROOSTER_ONLINE_ORIGIN=${JSON.stringify(standalone || external ? SITE_ORIGIN : '')};`;
  const parts = [`<script>${config}window.ROOSTER_ASSETS=${JSON.stringify(map).replace(/<\//g, '<\\/')};</script>`];
  for (const name of scripts) {
    const script = await readFile(path.join(ROOT, 'client', name), 'utf8');
    parts.push('<script>\n' + script.replace(/<\/script/gi, '<\\/script') + '\n</script>');
  }
  return shell.replace('<!--GAME_SCRIPTS-->', parts.join('\n'));
}
