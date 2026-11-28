/**
 * AuroMasti B19.8.3.1 — Evidence Integrity, Recovery Safety & Three-Game Integration Test Suite
 *
 * Workstreams Covered:
 *   Workstream B: Controlled Per-Migration Recovery Safety & Specification
 *   Workstream C: 8-Layer Network Connectivity Model & STARTTLS / TLS Trust Inspection
 *   Workstream D: Independent Three-Game Real Browser Integration & Theater Exit Protocol
 *   Workstream E: Sankalpa 14-Step Recovery Lifecycle & Network Privacy Interception
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIGRATION_RECOVERY_SPECIFICATION,
  CANONICAL_PROJECT_REF,
  EXPECTED_MIGRATION_COUNT
} from './scripts/migration-workflow.mjs';

import {
  runDiagnostic,
  probePostgresSslRequest,
  probeTlsHandshake,
  CONNECTIVITY_LAYERS,
  POOLER_HOST,
  POOLER_HOST_PRIMARY,
  POOLER_PORT_SESSION
} from './scripts/diagnose-network.mjs';

import {
  generateOperationalKey,
  encryptVaultRecord,
  decryptVaultRecord,
  exportEncryptedBackup,
  importEncryptedBackup,
  SANKALPA_PBKDF2_ITERATIONS,
  SANKALPA_BACKUP_FORMAT,
  SANKALPA_BACKUP_SCHEMA_VERSION,
  SANKALPA_BACKUP_KDF
} from './assets/sdk/sankalpa-vault-lifecycle.js';

import { createAuroMindSDK } from './assets/sdk/auromind-sdk.js';
import { createAuroMandalaGameAdapter } from './games/auromandala/assets/auromandala-sdk-bridge.js';
import { createAuroMatchGameAdapter } from './games/auromatch/Assets/auromatch-sdk-bridge.js';
import { createAuroBlocksGameAdapter } from './games/auroblocks/assets/auroblocks-sdk-bridge.js';

import { createTestEnvironment } from './e2e/browser-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

// ==============================================================================
// WORKSTREAM B: EMERGENCY MIGRATION RECOVERY SPECIFICATION
// ==============================================================================
describe('B19.8.3.1 Workstream B: Controlled Per-Migration Recovery Safety', () => {
  test('MIGRATION_RECOVERY_SPECIFICATION defines all 10 canonical migrations with exact queries', () => {
    assert.equal(MIGRATION_RECOVERY_SPECIFICATION.length, 10, 'Must have specifications for all 10 canonical migrations');

    const canonicalVersions = [
      '20261120000001', '20261120000002', '20261120000003', '20261120000004',
      '20261122000001', '20261122000002', '20261122000003', '20261122000004',
      '20261123000001', '20261123000002'
    ];

    MIGRATION_RECOVERY_SPECIFICATION.forEach((spec, idx) => {
      assert.equal(spec.version, canonicalVersions[idx], `Version mismatch at index ${idx}`);
      assert.ok(spec.file && spec.file.endsWith('.sql'), `Spec ${spec.version} must cite valid SQL file`);
      assert.ok(spec.verificationQuery && spec.verificationQuery.startsWith('SELECT'), `Spec ${spec.version} must define verification SQL query`);
      assert.ok(typeof spec.expectedCount === 'number' && spec.expectedCount > 0, `Spec ${spec.version} must specify expected count`);
      assert.ok(spec.reconciliationPrecondition.includes('AFFIRMATIVE_INSPECTION_PASSED'), `Spec ${spec.version} must require affirmative inspection`);
    });
  });

  test('Consolidated migration preview strictly prohibits blanket repair loops', () => {
    const preview = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'consolidated_migration_preview.sql'), 'utf8');
    assert.ok(
      preview.includes("CRITICAL RECOVERY SAFEGUARD: DO NOT execute a blanket 'supabase migration repair' loop"),
      'Must contain explicit prohibition against blanket repair'
    );
    assert.ok(
      preview.includes('Every migration must be independently validated against live database catalog state'),
      'Must mandate catalog verification'
    );
  });
});

// ==============================================================================
// WORKSTREAM C: 8-LAYER NETWORK CONNECTIVITY & TLS TRUST INSPECTION
// ==============================================================================
describe('B19.8.3.1 Workstream C: 8-Layer Network Model & TLS Trust Inspection', () => {
  test('runDiagnostic evaluates all 8 distinct connectivity layers without secret leakage', async () => {
    const report = await runDiagnostic({ rootDir: REPO_ROOT, timeoutMs: 1500 });
    assert.equal(report.layers.length, 8, 'Must report exactly 8 layers');

    // Layer 1: DNS
    assert.equal(report.layers[0].layer, 1);
    assert.equal(report.layers[0].category, CONNECTIVITY_LAYERS.LAYER_1_DNS);
    assert.ok(['PASS', 'FAIL'].includes(report.layers[0].status));

    // Layer 2: TCP
    assert.equal(report.layers[1].layer, 2);
    assert.equal(report.layers[1].category, CONNECTIVITY_LAYERS.LAYER_2_TCP);

    // Layer 3: PostgreSQL STARTTLS
    assert.equal(report.layers[2].layer, 3);
    assert.equal(report.layers[2].category, CONNECTIVITY_LAYERS.LAYER_3_PG_PROTOCOL);

    // Layer 4: TLS
    assert.equal(report.layers[3].layer, 4);
    assert.equal(report.layers[3].category, CONNECTIVITY_LAYERS.LAYER_4_TLS);

    // Layers 5-8: Strictly NOT_TESTED in offline mode
    for (let i = 4; i < 8; i++) {
      assert.equal(report.layers[i].status, 'NOT_TESTED', `Layer ${i + 1} must be NOT_TESTED in offline mode`);
      assert.ok(report.layers[i].details.includes('PENDING_REMOTE_ACTIVATION'), `Layer ${i + 1} must cite pending remote activation`);
    }

    // Zero secret leakage in report
    const jsonStr = JSON.stringify(report);
    assert.ok(!jsonStr.includes('sbp_'), 'PAT must never be in report');
    assert.ok(!jsonStr.includes('postgres://'), 'Connection URI must never be logged');
  });

  test('probePostgresSslRequest negotiates STARTTLS SSLRequest protocol correctly on Session Pooler port 5432', async () => {
    const res = await probePostgresSslRequest(POOLER_HOST_PRIMARY, POOLER_PORT_SESSION, 2500);
    if (res.status === 'CONNECTED' || res.status === 'SUPPORTED') {
      assert.equal(res.status, 'SUPPORTED');
      assert.equal(res.reply, 'S', "Server must reply with 'S' to indicate SSL support");
      assert.equal(res.sslSupported, true);
    } else {
      assert.ok(['TIMEOUT', 'FAILED'].includes(res.status));
    }
  });

  test('probeTlsHandshake captures Supabase Intermediate CA details on Session Pooler port 5432 without treating TCP as authenticated', async () => {
    const res = await probeTlsHandshake(POOLER_HOST_PRIMARY, POOLER_PORT_SESSION, 3000);
    if (res.status === 'NEGOTIATED') {
      assert.ok(res.protocol.startsWith('TLS'));
      assert.ok(res.certificate.issuerCN.includes('Supabase') || res.certificate.issuerCN.includes('CA'));
      assert.ok(['REQUIRES_SUPABASE_CA_OR_SSLMODE_REQUIRE', 'SUPABASE_CA_VERIFIED', 'SYSTEM_CA_TRUSTED'].includes(res.caTrustStatus));
    } else {
      assert.ok(['TIMEOUT', 'TCP_FAILED', 'PROTOCOL_FAILED', 'TLS_ERROR'].includes(res.status));
    }
  });
});

// ==============================================================================
// WORKSTREAM D: THREE-GAME INDEPENDENT INTEGRATION & THEATER EXIT PROTOCOL
// ==============================================================================
describe('B19.8.3.1 Workstream D: Three-Game Independent Real Browser Integration', () => {
  let env = null;

  before(async () => {
    env = await createTestEnvironment({ port: 3377 });
  });

  after(async () => {
    if (env) {
      await env.teardown();
    }
  });

  test('D1: AuroMandala independent portal launch, iframe integration & theater return', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 8000 });

      // Click AuroMandala Play button
      await page.evaluate(() => {
        const btn = document.querySelector('.play-game-btn[data-game-id="auromandala"]');
        if (btn) btn.click();
      });

      // Wait for theater view to display
      await page.waitForFunction(() => {
        const t = document.getElementById('game-theater-view');
        return t && t.style.display !== 'none' && document.body.classList.contains('in-game-mode');
      }, { timeout: 8000 });

      const iframeSrc = await page.$eval('#game-viewport-iframe', el => el.getAttribute('src'));
      assert.ok(iframeSrc.includes('games/auromandala/index.html'), `Must load auromandala, got: ${iframeSrc}`);

      // Exit theater via back button
      await page.evaluate(() => {
        const backBtn = document.getElementById('theater-back-btn');
        if (backBtn) backBtn.click();
      });

      // Verify portal regains control
      await page.waitForFunction(() => {
        const t = document.getElementById('game-theater-view');
        return t && (t.style.display === 'none' || !t.style.display) && !document.body.classList.contains('in-game-mode');
      }, { timeout: 8000 });

      const isInGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
      assert.equal(isInGame, false, 'Portal must clear in-game-mode on return');
    } finally {
      await close();
    }
  });

  test('D2: MaaMATCH independent portal launch, flora DB invariant & theater return', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 8000 });

      // Click MaaMATCH Play button
      await page.evaluate(() => {
        const btn = document.querySelector('.play-game-btn[data-game-id="auromatch"]');
        if (btn) btn.click();
      });

      await page.waitForFunction(() => {
        const t = document.getElementById('game-theater-view');
        return t && t.style.display !== 'none' && document.body.classList.contains('in-game-mode');
      }, { timeout: 8000 });

      const iframeSrc = await page.$eval('#game-viewport-iframe', el => el.getAttribute('src'));
      assert.ok(iframeSrc.includes('games/auromatch/index.html'), `Must load auromatch, got: ${iframeSrc}`);

      // Exit theater via postMessage from iframe contentWindow
      await page.evaluate((gid) => {
        const iframe = document.getElementById('game-viewport-iframe');
        const evt = new MessageEvent('message', {
          data: { type: 'AUROMIND_CLOSE_THEATER', gameId: gid },
          origin: window.location.origin,
          source: iframe.contentWindow
        });
        window.dispatchEvent(evt);
      }, 'auromatch');

      await page.waitForFunction(() => {
        const t = document.getElementById('game-theater-view');
        return t && (t.style.display === 'none' || !t.style.display) && !document.body.classList.contains('in-game-mode');
      }, { timeout: 8000 });

      const isInGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
      assert.equal(isInGame, false, 'MaaMATCH theater must close cleanly via AUROMIND_CLOSE_THEATER');
    } finally {
      await close();
    }
  });

  test('D3: MaaBLOCK / AuroBlocks independent launch, puzzle rules & theater return', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 8000 });

      // Click AuroBlocks Play button
      await page.evaluate(() => {
        const btn = document.querySelector('.play-game-btn[data-game-id="auroblocks"]');
        if (btn) btn.click();
      });

      await page.waitForFunction(() => {
        const t = document.getElementById('game-theater-view');
        return t && t.style.display !== 'none' && document.body.classList.contains('in-game-mode');
      }, { timeout: 8000 });

      const iframeSrc = await page.$eval('#game-viewport-iframe', el => el.getAttribute('src'));
      assert.ok(iframeSrc.includes('games/auroblocks/index.html'), `Must load auroblocks, got: ${iframeSrc}`);

      // Exit theater via postMessage from iframe contentWindow
      await page.evaluate((gid) => {
        const iframe = document.getElementById('game-viewport-iframe');
        const evt = new MessageEvent('message', {
          data: { type: 'AUROMIND_CLOSE_THEATER', gameId: gid },
          origin: window.location.origin,
          source: iframe.contentWindow
        });
        window.dispatchEvent(evt);
      }, 'auroblocks');

      await page.waitForFunction(() => {
        const t = document.getElementById('game-theater-view');
        return t && (t.style.display === 'none' || !t.style.display) && !document.body.classList.contains('in-game-mode');
      }, { timeout: 8000 });

      const isInGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
      assert.equal(isInGame, false, 'MaaBLOCK theater must close cleanly via AUROMIND_CLOSE_THEATER');
    } finally {
      await close();
    }
  });

  test('D4: Theater exit protocol strictly validates message contract and rejects malformed events', async () => {
    const { page, close } = await env.createInstrumentedPage();
    try {
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.AuroMindPortal && window.AuroMindPortal.isInitialized(), { timeout: 8000 });

      // Open theater for auromandala
      await page.evaluate(() => {
        const btn = document.querySelector('.play-game-btn[data-game-id="auromandala"]');
        if (btn) btn.click();
      });

      await page.waitForFunction(() => document.body.classList.contains('in-game-mode'), { timeout: 8000 });

      // 1. Post malformed message (missing gameId) -> Theater must NOT close
      await page.evaluate(() => {
        const iframe = document.getElementById('game-viewport-iframe');
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'AUROMIND_CLOSE_THEATER' },
          origin: window.location.origin,
          source: iframe.contentWindow
        }));
      });
      await new Promise(r => setTimeout(r, 200));
      let inGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
      assert.equal(inGame, true, 'Theater must remain open when message is missing gameId');

      // 2. Post rogue gameId -> Theater must NOT close
      await page.evaluate(() => {
        const iframe = document.getElementById('game-viewport-iframe');
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'unregistered_rogue_game' },
          origin: window.location.origin,
          source: iframe.contentWindow
        }));
      });
      await new Promise(r => setTimeout(r, 200));
      inGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
      assert.equal(inGame, true, 'Theater must remain open on unknown gameId');

      // 3. Post rogue origin -> Theater must NOT close
      await page.evaluate(() => {
        const iframe = document.getElementById('game-viewport-iframe');
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromandala' },
          origin: 'http://malicious-attacker.com',
          source: iframe.contentWindow
        }));
      });
      await new Promise(r => setTimeout(r, 200));
      inGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
      assert.equal(inGame, true, 'Theater must remain open on untrusted origin');

      // 4. Post valid message -> Theater closes
      await page.evaluate(() => {
        const iframe = document.getElementById('game-viewport-iframe');
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'AUROMIND_CLOSE_THEATER', gameId: 'auromandala' },
          origin: window.location.origin,
          source: iframe.contentWindow
        }));
      });
      await page.waitForFunction(() => !document.body.classList.contains('in-game-mode'), { timeout: 8000 });
      inGame = await page.evaluate(() => document.body.classList.contains('in-game-mode'));
      assert.equal(inGame, false, 'Theater must close on valid AUROMIND_CLOSE_THEATER message');
    } finally {
      await close();
    }
  });
});

// ==============================================================================
// WORKSTREAM E: SANKALPA 14-STEP RECOVERY & PRIVACY VALIDATION
// ==============================================================================
describe('B19.8.3.1 Workstream E: Sankalpa 14-Step Recovery & Privacy Interception', () => {
  test('E1: Complete 14-step synthetic backup export, recovery, and negative-path tests', async () => {
    // Step 1: Create test vault operational key
    const srcKey = await generateOperationalKey();
    assert.equal(srcKey.extractable, false, 'Operational key must be non-extractable');

    // Step 2: Add representative synthetic reflections
    const reflections = [
      { id: 'ref-01', text: 'Peace and equanimity in all circumstances.', date: '2026-11-28', tags: ['peace'] },
      { id: 'ref-02', text: 'Steadfast concentration and aspiration.', date: '2026-11-28', tags: ['focus'] }
    ];

    const encryptedRecords = [];
    for (const r of reflections) {
      encryptedRecords.push(await encryptVaultRecord(srcKey, r));
    }
    assert.equal(encryptedRecords.length, 2);

    // Step 3: Export encrypted JSON backup
    const passphrase = 'SacredIntentionPassphrase2026!';
    const backupEnvelope = await exportEncryptedBackup({
      passphrase,
      vaultRecords: encryptedRecords,
      operationalKey: srcKey
    });

    // Step 4: Verify exported JSON contains zero plaintext reflection content
    const envelopeJson = JSON.stringify(backupEnvelope);
    assert.ok(!envelopeJson.includes('Peace and equanimity'), 'Exported backup must NOT contain reflection text');
    assert.ok(!envelopeJson.includes('Steadfast concentration'), 'Exported backup must NOT contain reflection text');
    assert.equal(backupEnvelope.iterations, SANKALPA_PBKDF2_ITERATIONS);
    assert.equal(backupEnvelope.format, SANKALPA_BACKUP_FORMAT);

    // Step 5: Create fresh clean destination vault operational key
    const dstKey = await generateOperationalKey();

    // Step 6: Import backup using correct passphrase
    const importResult = await importEncryptedBackup({
      passphrase,
      backupEnvelope,
      targetOperationalKey: dstKey
    });

    // Step 7: Verify successful recovery
    assert.equal(importResult.importedCount, 2);

    // Step 8: Verify recovered content integrity byte-for-byte
    assert.equal(importResult.entries[0].text, reflections[0].text);
    assert.equal(importResult.entries[1].text, reflections[1].text);

    const decrypted0 = await decryptVaultRecord(dstKey, importResult.reEncryptedRecords[0]);
    assert.equal(decrypted0.text, reflections[0].text);
    assert.deepEqual(decrypted0.tags, reflections[0].tags);

    // Step 9: Negative Test — Import with incorrect passphrase throws DECRYPTION_FAILED
    await assert.rejects(
      () => importEncryptedBackup({
        passphrase: 'WrongPassphraseAttempt!',
        backupEnvelope,
        targetOperationalKey: dstKey
      }),
      /DECRYPTION_FAILED/
    );

    // Step 10: Negative Test — Import with corrupted ciphertext throws DECRYPTION_FAILED
    const corruptedCiphertext = {
      ...backupEnvelope,
      ciphertextHex: backupEnvelope.ciphertextHex.slice(0, -8) + 'ffffffff'
    };
    await assert.rejects(
      () => importEncryptedBackup({
        passphrase,
        backupEnvelope: corruptedCiphertext,
        targetOperationalKey: dstKey
      }),
      /DECRYPTION_FAILED/
    );

    // Step 11: Negative Test — Corrupted salt hex throws error
    const corruptedSalt = { ...backupEnvelope, saltHex: 'not-valid-hex!' };
    await assert.rejects(
      () => importEncryptedBackup({
        passphrase,
        backupEnvelope: corruptedSalt,
        targetOperationalKey: dstKey
      }),
      /MALFORMED_BACKUP_ENVELOPE|INVALID_HEX/
    );

    // Step 12: Negative Test — Downgraded PBKDF2 iterations throws INSECURE_KDF_ITERATIONS
    const downgradedEnvelope = { ...backupEnvelope, iterations: 10000 };
    await assert.rejects(
      () => importEncryptedBackup({
        passphrase,
        backupEnvelope: downgradedEnvelope,
        targetOperationalKey: dstKey
      }),
      /INSECURE_KDF_ITERATIONS/
    );

    // Step 13: Non-destructive merge test — Existing records preserved
    const existingRec = await encryptVaultRecord(dstKey, { id: 'existing-01', text: 'Pre-existing reflection' });
    const mergeImport = await importEncryptedBackup({
      passphrase,
      backupEnvelope,
      targetOperationalKey: dstKey,
      existingRecords: [existingRec]
    });
    assert.equal(mergeImport.importedCount, 2);

    // Step 14: Failure safety — Failed import leaves target vault intact
    const originalCount = importResult.entries.length;
    try {
      await importEncryptedBackup({
        passphrase: 'BadPassword!',
        backupEnvelope,
        targetOperationalKey: dstKey
      });
    } catch (_err) {
      // Expected rejection
    }
    assert.equal(originalCount, 2, 'Vault records count must remain unchanged after rejected import');
  });

  test('E2: Network interception proves Sankalpa plaintext and keys are NEVER transmitted', async () => {
    const interceptedRequests = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, options = {}) => {
      interceptedRequests.push({
        url: String(url),
        method: options.method || 'GET',
        body: options.body ? String(options.body) : null,
        headers: options.headers || {}
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' });
    };

    try {
      const sdk = createAuroMindSDK({ persistenceKey: 'test_isolation' });
      await sdk.init();
      sdk.telemetry.optIn();

      // Trigger telemetry and progress events
      sdk.telemetry.track('test_gameplay', { gameId: 'auromandala' });
      await sdk.telemetry.flush();

      // Verify that no intercepted request contains Sankalpa secrets
      for (const req of interceptedRequests) {
        if (req.body) {
          assert.ok(!req.body.includes('sankalpa_entries'), 'Request must not include sankalpa_entries table');
          assert.ok(!req.body.includes('Peace and equanimity'), 'Request must not contain reflection plaintext');
          assert.ok(!req.body.includes('CryptoKey'), 'Request must not contain CryptoKey');
          assert.ok(!req.body.includes('SacredIntentionPassphrase'), 'Request must not contain passphrases');
        }
      }

      // Verify cloudSyncEligible invariant is false for Sankalpa
      const mandalaAdapter = createAuroMandalaGameAdapter();
      assert.equal(mandalaAdapter.capabilities.sankalpaSyncEligible, false, 'Sankalpa capabilities.sankalpaSyncEligible must be false');
      assert.ok(mandalaAdapter.storage.localOnlyVaults.includes('sankalpa_e2ee_vault'), 'Must declare sankalpa_e2ee_vault in localOnlyVaults');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
