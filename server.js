import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let expressModule = null;
try {
  expressModule = (await import('express')).default;
} catch {
  // Graceful fallback for zero-dependency test/production environments without npm node_modules
}

const BLOCKED_ROOT_SEGMENTS = new Set([
  'server.js',
  'server.test.js',
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'phase0-audit',
  'architecture-design',
  'node_modules'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function createZeroDepStatic(rootDir, options = {}) {
  const index = options.index || 'index.html';
  return (req, res, next) => {
    let rawPath = decodeURIComponent(req.path || req.url.split('?')[0]);
    if (rawPath === '/' || rawPath === '') rawPath = '/' + index;
    const resolvedRoot = path.resolve(rootDir);
    let fullPath = path.resolve(rootDir, '.' + rawPath);

    if (!fullPath.startsWith(resolvedRoot)) {
      return next();
    }

    fs.stat(fullPath, (err, stats) => {
      if (!err && stats.isDirectory()) {
        fullPath = path.join(fullPath, index);
        fs.stat(fullPath, (err2, stats2) => {
          if (err2 || !stats2.isFile()) return next();
          serveFile(fullPath, stats2, res);
        });
        return;
      }
      if (err || !stats.isFile()) {
        return next();
      }
      serveFile(fullPath, stats, res);
    });
  };
}

function applyStaticCacheHeaders(filePath, res) {
  const normalized = (filePath || '').replace(/\\/g, '/').toLowerCase();
  const baseName = path.basename(normalized);
  const ext = path.extname(normalized);
  const isContentHashedAsset = /-[a-z0-9_-]{6,}\.(js|css)$/i.test(baseName);

  if (
    ext === '.html' ||
    baseName === 'sw.js' ||
    baseName === 'precache-manifest.json' ||
    baseName === 'manifest.json' ||
    baseName === 'manifest.webmanifest' ||
    ((ext === '.js' || ext === '.css' || ext === '.json') && !isContentHashedAsset)
  ) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (isContentHashedAsset || ext === '.woff2') {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
}

function serveFile(filePath, stats, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', contentType);
  }
  applyStaticCacheHeaders(filePath, res);
  if (stats && typeof stats.size === 'number') {
    res.setHeader('Content-Length', stats.size);
  }
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

function createZeroDepApp() {
  const middlewares = [];

  function app(req, res) {
    let idx = 0;
    const next = () => {
      if (idx < middlewares.length) {
        const fn = middlewares[idx++];
        fn(req, res, next);
      } else {
        res.statusCode = 404;
        res.end();
      }
    };
    next();
  }

  app.use = function (routeOrFn, maybeFn) {
    if (typeof routeOrFn === 'function') {
      middlewares.push(routeOrFn);
    } else {
      const prefix = routeOrFn.endsWith('/') ? routeOrFn.slice(0, -1) : routeOrFn;
      const fn = maybeFn;
      middlewares.push((req, res, next) => {
        const reqPath = req.path || req.url.split('?')[0];
        if (reqPath === prefix || reqPath.startsWith(prefix + '/')) {
          const origPath = req.path;
          req.path = reqPath.slice(prefix.length) || '/';
          fn(req, res, () => {
            req.path = origPath;
            next();
          });
        } else {
          next();
        }
      });
    }
    return app;
  };

  app.get = function (route, fn) {
    middlewares.push((req, res, next) => {
      const parsedPath = req.path || req.url.split('?')[0];
      if (req.method === 'GET' && parsedPath === route) {
        fn(req, res);
      } else {
        next();
      }
    });
    return app;
  };

  app.listen = function (port, hostOrCallback, maybeCallback) {
    const host = typeof hostOrCallback === 'string' ? hostOrCallback : '0.0.0.0';
    const callback = typeof hostOrCallback === 'function' ? hostOrCallback : maybeCallback;
    const server = http.createServer((req, res) => {
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
        return res;
      };
      req.path = decodeURIComponent(req.url.split('?')[0]);
      app(req, res);
    });
    return server.listen(port, host, callback);
  };

  return app;
}

export function createApp() {
  const app = expressModule ? expressModule() : createZeroDepApp();
  const staticHandler = expressModule ? expressModule.static : createZeroDepStatic;

  // 1. Set hardened HTTP security headers on all responses (AUDIT-SEC-04)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.web3forms.com https://cdn.jsdelivr.net https://fonts.googleapis.com; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self';"
    );
    if (req.secure || (req.headers && req.headers['x-forwarded-proto'] === 'https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // 2. Block public HTTP exposure of internal Studio files, audit reports, and hidden directories (AURO-33)
  app.use((req, res, next) => {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path || req.url.split('?')[0] || '/');
    } catch (_err) {
      return res.status ? res.status(404).end() : (res.statusCode = 404, res.end());
    }

    const segments = decodedPath.split('/').filter(Boolean);
    if (segments.length > 0) {
      // Block any hidden file or directory (.git, .gitignore, .aistudio, .playwright-cli, etc.)
      if (segments.some((seg) => seg.startsWith('.') || seg === '..')) {
        return res.status ? res.status(404).end() : (res.statusCode = 404, res.end());
      }

      const firstSegment = segments[0].toLowerCase();
      if (
        BLOCKED_ROOT_SEGMENTS.has(firstSegment) ||
        (segments.length === 1 &&
          (firstSegment.endsWith('.md') ||
            firstSegment.endsWith('.lock') ||
            firstSegment.endsWith('.test.js')))
      ) {
        return res.status ? res.status(404).end() : (res.statusCode = 404, res.end());
      }
    }

    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Map root-relative AuroBlocks artwork requests to their sub-game directory
  app.use('/assets/artwork', staticHandler(path.join(__dirname, 'games/auroblocks/assets/artwork'), {
    dotfiles: 'ignore',
    setHeaders: (res, servedPath) => applyStaticCacheHeaders(servedPath, res)
  }));

  app.use(staticHandler(__dirname, {
    index: 'index.html',
    dotfiles: 'ignore',
    setHeaders: (res, servedPath) => applyStaticCacheHeaders(servedPath, res)
  }));

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const host = '0.0.0.0';
  const app = createApp();
  app.listen(port, host, () => {
    console.log(`AuroMasti portal listening at http://${host}:${port}`);
  });
}
