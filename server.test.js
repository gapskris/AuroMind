import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.js';

test('Express static server serves portal, assets, and all live games', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const checks = [
      { path: '/', expectedContentType: 'text/html', expectedText: 'AuroMind' },
      { path: '/health', expectedContentType: 'application/json', expectedText: '"ok":true' },
      { path: '/assets/js/portal.js', expectedContentType: 'javascript', expectedText: 'initTheaterMode' },
      { path: '/assets/css/portal.css', expectedContentType: 'text/css', expectedText: '' },
      { path: '/games/vak/index.html', expectedContentType: 'text/html', expectedText: 'Vak' },
      { path: '/games/vak-living-sanctuary/index.html', expectedContentType: 'text/html', expectedText: 'VAK' },
      { path: '/games/auromatch/index.html', expectedContentType: 'text/html', expectedText: 'AuroMatch' },
      { path: '/games/word-riddle/index.html', expectedContentType: 'text/html', expectedText: 'Word Discovery' },
      { path: '/games/auromandala/index.html', expectedContentType: 'text/html', expectedText: 'PranaMandala' },
      { path: '/games/auroblocks/index.html', expectedContentType: 'text/html', expectedText: 'AuroBlocks' },
      { path: '/manifest.json', expectedContentType: 'application/json', expectedText: 'icon-192.png' },
      { path: '/sw.js', expectedContentType: 'javascript', expectedText: 'auro-portal-v1.0.0' },
      { path: '/assets/icons/icon-192.png', expectedContentType: 'image/png', expectedText: '' },
      { path: '/assets/icons/icon-512.png', expectedContentType: 'image/png', expectedText: '' },
      { path: '/assets/artwork/hero-sacred-geometry.webp', expectedContentType: 'image/webp', expectedText: '' }
    ];

    for (const check of checks) {
      const res = await fetch(`${baseUrl}${check.path}`);
      assert.equal(res.status, 200, `Expected 200 for ${check.path}`);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(
        contentType.includes(check.expectedContentType),
        `Expected content-type ${check.expectedContentType} for ${check.path}, got ${contentType}`
      );
      if (check.expectedText) {
        const body = await res.text();
        assert.ok(body.includes(check.expectedText), `Expected ${check.path} to contain ${check.expectedText}`);
      }
    }

    const blockedPaths = [
      '/server.js',
      '/server.test.js',
      '/package.json',
      '/bun.lock',
      '/phase0-audit',
      '/phase0-audit/',
      '/phase0-audit/AUROMIND_PHASE_0_1_NON_SUPABASE_RECONCILIATION.md',
      '/.gitignore',
      '/.git/HEAD',
      '/.aistudio/config.json',
      '/.playwright-cli/page.yml',
      '/node_modules/express/package.json',
      '/non-existent-route-xyz'
    ];

    for (const blockedPath of blockedPaths) {
      const res = await fetch(`${baseUrl}${blockedPath}`);
      assert.equal(res.status, 404, `Expected 404 for blocked path ${blockedPath}, got ${res.status}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
