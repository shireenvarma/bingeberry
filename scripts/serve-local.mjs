import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT || process.argv[2] || '4174', 10);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function resolveRequestPath(urlPath, root = rootDir) {
  const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  if (relativePath.includes('\0') || relativePath.split(/[\\/]/).some((part) => part.startsWith('.'))) return null;
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return absolutePath;
}

const server = http.createServer(async (req, res) => {
  if (!['GET','HEAD'].includes(req.method)) {
    send(res,405,'Method not allowed');
    return;
  }
  let absolutePath;
  try { absolutePath = resolveRequestPath(req.url || '/'); }
  catch { send(res,400,'Malformed URL'); return; }
  if (!absolutePath) { send(res,403,'Forbidden'); return; }
  try {
    const resolved = await realpath(absolutePath);
    const relative = path.relative(await realpath(rootDir),resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { send(res,403,'Forbidden'); return; }
    const details = await stat(absolutePath);
    if (details.isDirectory()) {
      send(res, 403, 'Directory listing is disabled.');
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(resolved).on('error', () => res.destroy()).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
});

server.on('error', (error) => { console.error(`Cannot start BingeBerry: ${error.message}`); process.exitCode = 1; });
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) server.listen(port, host, () => {
  console.log(`BingeBerry is running at http://${host}:${port}`);
  console.log('Open that URL in Chrome, Safari, or any other browser.');
  console.log('Do not open index.html directly from Finder or as a file:// URL.');
});
