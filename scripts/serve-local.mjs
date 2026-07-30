import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
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

function resolveRequestPath(urlPath) {
  const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!absolutePath.startsWith(rootDir)) return null;
  return absolutePath;
}

const server = http.createServer(async (req, res) => {
  const absolutePath = resolveRequestPath(req.url || '/');
  if (!absolutePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  try {
    await access(absolutePath);
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
    createReadStream(absolutePath).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
});

server.listen(port, host, () => {
  console.log(`BingeBerry is running at http://${host}:${port}`);
  console.log('Open that URL in Chrome, Safari, or any other browser.');
  console.log('Do not open index.html directly from Finder or as a file:// URL.');
});
