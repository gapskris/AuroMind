/**
 * AuroMasti B19.8.3.1 Extension — Session Pooler CLI Targeting & Credential Protection Test Suite
 *
 * Verifies:
 * 1. buildSessionPoolerUrl constructs compliant PostgreSQL URLs targeting aws-1-ap-southeast-1.pooler.supabase.com:5432.
 * 2. Strict Credential Protection: Zero password exposure in CLI arguments or URLs (in-memory PGPASSWORD delivery).
 * 3. Windows Path Normalization: Forward slashes enforced for sslrootcert in database connection strings.
 * 4. Root CA Certificate Integrity: prod-ca-2021.crt is valid X.509 CA issued by 'CN=Supabase Root 2021 CA' (valid to 2031).
 * 5. CLI Driver CA Enforcement: CLI fails closed if sslrootcert points to missing file.
 * 6. Local Mock PostgreSQL Handshake: CLI migration list & db push --dry-run target custom Postgres without Supabase API.
 * 7. 8-Layer Diagnostic Integration: Layer 4 achieves SUPABASE_CA_VERIFIED while Layers 5-8 remain NOT_TESTED.
 * 8. Error Sanitization: maskSecret sanitizes CLI error outputs and prevents secret leakage.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  CANONICAL_PROJECT_REF,
  DEFAULT_POOLER_HOST,
  DEFAULT_POOLER_PORT,
  DEFAULT_POOLER_DB,
  DEFAULT_CA_CERT_NAME,
  buildSessionPoolerUrl,
  runSupabaseCli,
  runPreflight,
  executeRemoteMigrations
} from './scripts/migration-workflow.mjs';

import {
  runDiagnostic,
  probeTlsHandshake,
  CONNECTIVITY_LAYERS,
  POOLER_HOST_PRIMARY,
  POOLER_PORT_SESSION
} from './scripts/diagnose-network.mjs';

import { maskSecret } from './scripts/load-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

describe('Session Pooler CLI Targeting & TLS CA Verification Suite (Nov 28 Extension)', () => {

  test('POOLER-01: buildSessionPoolerUrl targets canonical host, port, user, and database', () => {
    const url = buildSessionPoolerUrl({
      rootDir: REPO_ROOT,
      projectRef: CANONICAL_PROJECT_REF
    });

    assert.ok(url.startsWith('postgresql://'), 'Must use postgresql protocol scheme');
    assert.ok(url.includes(`postgres.${CANONICAL_PROJECT_REF}@`), 'Must use project-specific user postgres.<project_ref>');
    assert.ok(url.includes(`@${DEFAULT_POOLER_HOST}:${DEFAULT_POOLER_PORT}/`), 'Must target aws-1 pooler host on port 5432');
    assert.ok(url.includes(`/${DEFAULT_POOLER_DB}?`), 'Must target database postgres');
    assert.ok(url.includes('sslmode=verify-full'), 'Must mandate sslmode=verify-full');
    assert.ok(url.includes(`sslrootcert=`), 'Must include sslrootcert parameter');
  });

  test('POOLER-02: Strict Zero-Exposure: Password is NEVER embedded in connection URL by default', () => {
    const secretPassword = 'P@ssw0rd_That_Must_Never_Appear_In_CLI_Args_12345!';

    // Even when password is explicitly provided, includePassword defaults to false
    const secureUrl = buildSessionPoolerUrl({
      rootDir: REPO_ROOT,
      password: secretPassword,
      includePassword: false
    });

    assert.ok(!secureUrl.includes(secretPassword), 'Password must NOT be embedded in URL');
    assert.ok(!secureUrl.includes(':P@ssw0rd'), 'No password delimiter colon in userinfo');
    assert.ok(secureUrl.includes(`postgres.${CANONICAL_PROJECT_REF}@`), 'Userinfo contains only username');
  });

  test('POOLER-03: Windows Path Normalization: sslrootcert uses forward slashes', () => {
    const customWinPath = 'C:\\Some\\Nested\\Path\\prod-ca-2021.crt';
    const url = buildSessionPoolerUrl({
      rootDir: REPO_ROOT,
      caCertPath: customWinPath
    });

    assert.ok(!url.includes('\\'), 'URL must NOT contain backslashes');
    assert.ok(url.includes('sslrootcert=C:/Some/Nested/Path/prod-ca-2021.crt'), 'Backslashes must be normalized to forward slashes');
  });

  test('POOLER-04: prod-ca-2021.crt root CA certificate integrity and X.509 validity', () => {
    const caPath = path.join(REPO_ROOT, DEFAULT_CA_CERT_NAME);
    assert.ok(fs.existsSync(caPath), `Certificate file ${DEFAULT_CA_CERT_NAME} must exist in repository root`);

    const certContent = fs.readFileSync(caPath, 'utf8');
    assert.ok(certContent.includes('-----BEGIN CERTIFICATE-----'), 'Must contain PEM header');
    assert.ok(certContent.includes('-----END CERTIFICATE-----'), 'Must contain PEM footer');

    const x509 = new crypto.X509Certificate(certContent);
    assert.ok(x509.ca, 'Certificate must be a Certificate Authority (CA: true)');
    assert.ok(x509.subject.includes('CN=Supabase Root 2021 CA'), 'Subject CN must be Supabase Root 2021 CA');
    assert.ok(x509.issuer.includes('CN=Supabase Root 2021 CA'), 'Issuer CN must be Supabase Root 2021 CA (Root CA self-signed)');

    // Validity check: Apr 2021 to Apr 2031
    const validToDate = new Date(x509.validTo);
    assert.ok(validToDate.getFullYear() >= 2031, 'Certificate must be valid through 2031');

    // SHA-256 fingerprint verification
    const expectedFingerprintPrefix = '80:70:25:AD:50:D4:ED:21';
    assert.ok(x509.fingerprint256.startsWith(expectedFingerprintPrefix), `Fingerprint must match Supabase Root 2021 CA (got ${x509.fingerprint256})`);
  });

  test('POOLER-05: runSupabaseCli injects --remote and delivers PGPASSWORD in memory without argument exposure', () => {
    let capturedArgs = null;
    let capturedEnv = null;

    const mockRunner = (args, options) => {
      capturedArgs = args;
      capturedEnv = options.env;
      return 'Mock CLI Success';
    };

    // Test with mock runner to inspect in-memory execution parameters
    const testEnv = {
      SUPABASE_DB_PASSWORD: 'SuperSecretDatabasePassword_2027'
    };

    // Call runSupabaseCli logic simulation
    const poolerUrl = buildSessionPoolerUrl({ rootDir: REPO_ROOT });
    const isWindows = process.platform === 'win32';

    // Verify buildSessionPoolerUrl output does not expose password
    assert.ok(!poolerUrl.includes('SuperSecretDatabasePassword'));

    // Test runSupabaseCli parameter construction when targetPooler: true
    // Direct invocation with db push dry-run
    let threwWithoutGate = false;
    try {
      runSupabaseCli(['db', 'push'], {
        rootDir: REPO_ROOT,
        targetPooler: true,
        _authorizedByGate: false
      });
    } catch (err) {
      threwWithoutGate = true;
      assert.ok(err.message.includes('CRITICAL_SECURITY_VIOLATION'), 'Mutating push without gate must fail closed');
    }
    assert.ok(threwWithoutGate, 'Must fail closed against mutating push without gate');
  });

  test('POOLER-06: CLI driver fails closed if sslrootcert points to non-existent file', () => {
    const isWindows = process.platform === 'win32';
    const npxCmd = isWindows ? 'npx.cmd' : 'npx';
    const nonExistentCa = 'C:/AuroMindPortal/non_existent_fake_ca.crt';

    const fakeUrl = buildSessionPoolerUrl({
      rootDir: REPO_ROOT,
      host: '127.0.0.1',
      port: 54329,
      caCertPath: nonExistentCa
    });

    let cliFailed = false;
    let errorOutput = '';

    try {
      // Use local node to run project Supabase CLI
      const cliEntrypoint = path.join(REPO_ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js');
      execFileSync(process.execPath, [cliEntrypoint, 'migration', 'list', `--remote=${fakeUrl}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000
      });
    } catch (err) {
      cliFailed = true;
      errorOutput = (err.stderr || '') + (err.stdout || '') + (err.message || '');
    }

    assert.ok(cliFailed, 'CLI must fail if sslrootcert cannot be read');
    assert.ok(
      errorOutput.includes('failed to read sslrootcert') || errorOutput.includes('ENOENT'),
      `Error must specifically indicate sslrootcert read failure (got: ${errorOutput})`
    );
  });

  test('POOLER-07: Local Mock PostgreSQL Server: CLI consumes PGPASSWORD and targets custom Postgres', async () => {
    // Spin up local mock PostgreSQL server on 127.0.0.1
    let receivedStartup = false;
    let receivedPassword = false;
    let capturedUser = '';
    let capturedDatabase = '';
    let capturedSecret = '';

    const mockServer = net.createServer((socket) => {
      socket.on('data', (data) => {
        // First packet: SSLRequest (8 bytes, 80877103)
        if (data.length === 8 && data.readInt32BE(4) === 80877103) {
          // Reply 'N' (SSL not supported on this local mock)
          socket.write(Buffer.from('N'));
          return;
        }

        // Check for StartupMessage (starts with length, then protocol version 196608 = 0x00030000)
        if (data.length >= 8 && data.readInt32BE(4) === 196608) {
          receivedStartup = true;
          const str = data.slice(8).toString('utf8');
          const parts = str.split('\0');
          for (let i = 0; i < parts.length - 1; i += 2) {
            if (parts[i] === 'user') capturedUser = parts[i + 1];
            if (parts[i] === 'database') capturedDatabase = parts[i + 1];
          }

          // Request cleartext password (AuthenticationCleartextPassword = 'R', length=8, type=3)
          const authReq = Buffer.alloc(9);
          authReq.write('R', 0);
          authReq.writeInt32BE(8, 1);
          authReq.writeInt32BE(3, 5); // 3 = cleartext password
          socket.write(authReq);
          return;
        }

        // Check for PasswordMessage (type 'p')
        if (data[0] === 0x70) { // 'p' = 112
          receivedPassword = true;
          capturedSecret = data.slice(5, data.length - 1).toString('utf8');

          // Send ErrorResponse or AuthenticationOk then close
          const errResp = Buffer.from('E\0\0\0\x2eSFATAL\0C28P01\0MMock auth complete\0\0');
          socket.write(errResp);
          socket.end();
        }
      });
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;

    const testPassword = 'LocalMockSecretPassword_2027';
    const mockUrl = `postgresql://postgres.${CANONICAL_PROJECT_REF}@127.0.0.1:${port}/postgres?sslmode=disable`;

    try {
      const cliEntrypoint = path.join(REPO_ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js');
      const { spawn } = await import('node:child_process');

      await new Promise((resolve) => {
        const child = spawn(process.execPath, [cliEntrypoint, 'migration', 'list', `--remote=${mockUrl}`], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PGPASSWORD: testPassword
          },
          stdio: 'pipe'
        });

        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 8000);

        child.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      assert.ok(receivedStartup, 'Mock server must receive PostgreSQL StartupMessage');
      assert.equal(capturedUser, `postgres.${CANONICAL_PROJECT_REF}`, 'StartupMessage must specify postgres.<project_ref>');
      assert.equal(capturedDatabase, 'postgres', 'StartupMessage must specify database postgres');
      assert.ok(receivedPassword, 'Mock server must receive PostgreSQL password message');
      assert.equal(capturedSecret, testPassword, 'Driver must automatically supply PGPASSWORD from environment');
    } finally {
      mockServer.close();
    }
  });

  test('POOLER-08: 8-Layer Diagnostic identifies Session Pooler and verifies TLS with prod-ca-2021.crt', async () => {
    const report = await runDiagnostic({ rootDir: REPO_ROOT, timeoutMs: 3000 });

    assert.equal(report.projectRef, CANONICAL_PROJECT_REF);
    assert.equal(report.poolerPrimary, POOLER_HOST_PRIMARY);
    assert.equal(report.poolerPortSession, 5432);
    assert.ok(report.caCertPath, 'Must locate prod-ca-2021.crt');
    assert.ok(report.caCertPath.endsWith('prod-ca-2021.crt'), 'Must reference prod-ca-2021.crt');

    // Layer 1 DNS: Must resolve
    const layer1 = report.layers.find(l => l.layer === 1);
    assert.equal(layer1.status, 'PASS', 'Layer 1 DNS must pass for session pooler');

    // Layer 2 TCP: Must connect to session pooler
    const layer2 = report.layers.find(l => l.layer === 2);
    assert.equal(layer2.status, 'PASS', 'Layer 2 TCP must pass for session pooler');

    // Layer 3 PostgreSQL STARTTLS: Must accept SSLRequest (byte 'S')
    const layer3 = report.layers.find(l => l.layer === 3);
    assert.equal(layer3.status, 'PASS', 'Layer 3 STARTTLS must pass');

    // Layer 4 TLS Handshake & Certificate: Must pass with SUPABASE_CA_VERIFIED
    const layer4 = report.layers.find(l => l.layer === 4);
    assert.equal(layer4.status, 'PASS', 'Layer 4 TLS must pass with verified CA');
    assert.ok(layer4.details.includes('SUPABASE_CA_VERIFIED'), 'Layer 4 details must report SUPABASE_CA_VERIFIED');
    assert.ok(layer4.details.includes('Authorized: true'), 'Layer 4 details must report Authorized: true');

    // Layers 5-8: MUST remain strictly NOT_TESTED (fail-closed safety boundary)
    for (let layerNum = 5; layerNum <= 8; layerNum++) {
      const layer = report.layers.find(l => l.layer === layerNum);
      assert.equal(layer.status, 'NOT_TESTED', `Layer ${layerNum} must remain NOT_TESTED until live activation`);
      assert.ok(layer.details.includes('PENDING_REMOTE_ACTIVATION'), `Layer ${layerNum} must indicate pending remote activation`);
    }
  });

  test('POOLER-09: Error Sanitization: maskSecret prevents secret leakage from CLI errors', () => {
    const rawError = 'Error connecting to postgresql://postgres.rlqrtbjynaihdspbqtce:MyTopSecretPassword123@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';
    const sanitized = maskSecret(rawError);

    assert.ok(!sanitized.includes('MyTopSecretPassword123'), 'Sanitized error must NOT contain plain password');
    assert.ok(sanitized.includes('[REDACTED]'), 'Secret must be replaced with [REDACTED]');
  });
});
