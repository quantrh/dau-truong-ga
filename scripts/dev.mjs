import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { makeHTML, ROOT } from './content.mjs';
import { handleRoomRequest } from '../worker/rooms.js';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback; };
const port = Number(value('--port', '4173'));
const hostname = value('--host', '0.0.0.0');
await mkdir(path.join(ROOT, '.sites-runtime'), { recursive: true });
const sqlite = new DatabaseSync(path.join(ROOT, '.sites-runtime/preview.sqlite'));
sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
for (const name of (await readdir(path.join(ROOT, 'drizzle'))).filter(n => n.endsWith('.sql')).sort()) {
  if (!sqlite.prepare('SELECT name FROM _local_migrations WHERE name=?').get(name)) {
    sqlite.exec(await readFile(path.join(ROOT, 'drizzle', name), 'utf8'));
    sqlite.prepare('INSERT INTO _local_migrations (name) VALUES (?)').run(name);
  }
}
function statement(sql, values = []) {
  const st = sqlite.prepare(sql);
  return {
    bind(...bindings) { return statement(sql, bindings); },
    async first(column) { const row = st.get(...values); return row ? column ? row[column] : { ...row } : null; },
    async all() { return { success: true, results: st.all(...values).map(r => ({ ...r })) }; },
    async run() { const r = st.run(...values); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  };
}
const DB = { prepare: sql => statement(sql) };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + req.headers.host);
    let response;
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 32768) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body, duplex: 'half' } : {}) });
      if (url.pathname === '/api/health') response = Response.json({ ok: true, version: '3.0.0', preview: true });
      else response = await handleRoomRequest(request, { DB }, { waitUntil: p => p.catch(() => {}) });
    } else if (url.pathname.startsWith('/assets/')) {
      const name = url.pathname.slice(8);
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) response = new Response('Not found', { status: 404 });
      else {
        const bytes = await readFile(path.join(ROOT, 'assets', name));
        response = new Response(bytes, { headers: { 'Content-Type': name.endsWith('.woff') ? 'font/woff' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/png' } });
      }
    } else if (url.pathname === '/' || url.pathname === '/index.html') response = new Response(await makeHTML(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    else response = new Response('Not found', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error.message); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Preview error'); }
});
server.listen(port, hostname, () => console.log(`Game preview listening on ${hostname}:${port}`));
