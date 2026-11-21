/**
 * AuroMind B17.3 E2E Browser Test Harness
 * 
 * Provides deterministic local server lifecycle, real Chromium browser automation,
 * isolated incognito browser contexts per test, CDP offline network emulation,
 * console error capture, and failure screenshots.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Find bundled puppeteer from Antigravity resources
const BUNDLED_PUPPETEER_PATH = 'C:/Users/gopal_ogmm83y/AppData/Local/Programs/antigravity/resources/app.asar.unpacked/node_modules/chrome-devtools-mcp/build/src/third_party/index.js';

// Executable path for installed Chromium (Microsoft Edge)
const EDGE_EXECUTABLE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export async function createTestEnvironment(options = {}) {
  const port = options.port || 3335;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Start local deterministic server
  const serverModule = await import(pathToFileURL(path.join(ROOT_DIR, 'server.js')).href);
  const createApp = serverModule.createApp;
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  // 2. Load Puppeteer
  const tpUrl = pathToFileURL(BUNDLED_PUPPETEER_PATH).href;
  const { puppeteer } = await import(tpUrl);

  const testArtifactsDir = path.join(ROOT_DIR, 'test-results', 'artifacts');
  if (!fs.existsSync(testArtifactsDir)) {
    fs.mkdirSync(testArtifactsDir, { recursive: true });
  }

  // 3. Launch real Chromium browser
  const browser = await puppeteer.launch({
    executablePath: EDGE_EXECUTABLE_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const browserVersion = await browser.version();

  /**
   * Helper to create an instrumented page in an isolated incognito context
   */
  async function createInstrumentedPage(pageOptions = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const consoleLogs = [];
    const consoleErrors = [];
    const failedRequests = [];

    if (pageOptions.viewport) {
      await page.setViewport(pageOptions.viewport);
    } else {
      await page.setViewport({ width: 1280, height: 800 });
    }

    page.on('console', msg => {
      const entry = { type: msg.type(), text: msg.text() };
      consoleLogs.push(entry);
      if (msg.type() === 'error') {
        consoleErrors.push(entry);
      }
    });

    page.on('pageerror', err => {
      consoleErrors.push({ type: 'pageerror', text: err.message, stack: err.stack });
    });

    page.on('requestfailed', req => {
      failedRequests.push({
        url: req.url(),
        method: req.method(),
        errorText: req.failure() ? req.failure().errorText : 'Unknown failure'
      });
    });

    /**
     * Emulates offline network conditions via CDP
     */
    async function setOffline(isOffline) {
      const client = await page.createCDPSession();
      await client.send('Network.emulateNetworkConditions', {
        offline: isOffline,
        latency: 0,
        downloadThroughput: isOffline ? 0 : -1,
        uploadThroughput: isOffline ? 0 : -1
      });
    }

    /**
     * Captures a failure screenshot
     */
    async function captureScreenshot(name) {
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = path.join(testArtifactsDir, `${Date.now()}_${safeName}.png`);
      try {
        await page.screenshot({ path: filename, fullPage: true });
        return filename;
      } catch (e) {
        return null;
      }
    }

    async function close() {
      try {
        await page.close();
      } catch (e) {}
      try {
        await context.close();
      } catch (e) {}
    }

    return {
      context,
      page,
      consoleLogs,
      consoleErrors,
      failedRequests,
      setOffline,
      captureScreenshot,
      close
    };
  }

  async function teardown() {
    try {
      await browser.close();
    } catch (e) {}

    await new Promise(resolve => server.close(resolve));
  }

  return {
    baseUrl,
    browser,
    browserVersion,
    createInstrumentedPage,
    teardown
  };
}
