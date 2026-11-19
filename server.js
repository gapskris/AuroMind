import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOCKED_ROOT_SEGMENTS = new Set([
  'server.js',
  'server.test.js',
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'phase0-audit',
  'node_modules'
]);

export function createApp() {
  const app = express();

  // Block public HTTP exposure of internal Studio files, audit reports, and hidden directories (AURO-33)
  app.use((req, res, next) => {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path || '/');
    } catch (_err) {
      return res.status(404).end();
    }

    const segments = decodedPath.split('/').filter(Boolean);
    if (segments.length > 0) {
      // Block any hidden file or directory (.git, .gitignore, .aistudio, .playwright-cli, etc.)
      if (segments.some((seg) => seg.startsWith('.') || seg === '..')) {
        return res.status(404).end();
      }

      const firstSegment = segments[0].toLowerCase();
      if (
        BLOCKED_ROOT_SEGMENTS.has(firstSegment) ||
        (segments.length === 1 &&
          (firstSegment.endsWith('.md') ||
            firstSegment.endsWith('.lock') ||
            firstSegment.endsWith('.test.js')))
      ) {
        return res.status(404).end();
      }
    }

    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Map root-relative AuroBlocks artwork requests to their sub-game directory
  app.use('/assets/artwork', express.static(path.join(__dirname, 'games/auroblocks/assets/artwork'), {
    dotfiles: 'ignore'
  }));

  app.use(express.static(__dirname, {
    index: 'index.html',
    dotfiles: 'ignore'
  }));

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const host = '0.0.0.0';
  const app = createApp();
  app.listen(port, host, () => {
    console.log(`AuroMind portal listening at http://${host}:${port}`);
  });
}
