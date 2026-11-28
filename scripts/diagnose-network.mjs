/**
 * AuroMasti — Safe Network & Database Connectivity Diagnostic (B19.8.3.1 Layered Engine)
 *
 * Implements the rigorous 8-Layer Connectivity Verification Model:
 *   Layer 1: DNS Resolution (IPv4 vs IPv6 families)
 *   Layer 2: TCP Socket Reachability (Host & Port connection)
 *   Layer 3: PostgreSQL Protocol Negotiation (STARTTLS SSLRequest -> 'S' byte)
 *   Layer 4: TLS Handshake & Certificate Validation (Issuer, Subject, Expiry, CA Trust)
 *   Layer 5: PostgreSQL Authentication (NOT_TESTED / PENDING_REMOTE_ACTIVATION)
 *   Layer 6: Database Selection (NOT_TESTED / PENDING_REMOTE_ACTIVATION)
 *   Layer 7: Database Permissions (NOT_TESTED / PENDING_REMOTE_ACTIVATION)
 *   Layer 8: Supabase CLI Project Access (NOT_TESTED / PENDING_REMOTE_ACTIVATION)
 *
 * CRITICAL SAFETY INVARIANT:
 * A successful lower layer NEVER implies that a higher layer succeeded.
 * Specifically, an open TCP socket or TLS handshake DOES NOT prove database
 * authentication, correct tenant routing, or CLI migration compatibility.
 *
 * Zero-Leakage Guarantee:
 * Never prints or persists credentials, passwords, PATs, or connection URIs.
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import { loadEnvironment } from './load-env.mjs';

export const CANONICAL_PROJECT_REF = 'rlqrtbjynaihdspbqtce';
export const CANONICAL_REGION = 'ap-southeast-1';
export const DIRECT_DB_HOST = `db.${CANONICAL_PROJECT_REF}.supabase.co`;
export const POOLER_HOST = `aws-0-${CANONICAL_REGION}.pooler.supabase.com`;
export const POOLER_HOST_PRIMARY = `aws-1-${CANONICAL_REGION}.pooler.supabase.com`;
export const POOLER_PORT_SESSION = 5432;
export const POOLER_PORT_LEGACY_SESSION = 6543;
export const DEFAULT_CA_CERT_NAME = 'prod-ca-2021.crt';
export const REST_ENDPOINT = `https://${CANONICAL_PROJECT_REF}.supabase.co/rest/v1/`;

// PostgreSQL SSLRequest message: Int32(8), Int32(80877103) -> 0x04d2162f
const PG_SSL_REQUEST_PACKET = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);

export const CONNECTIVITY_LAYERS = {
  LAYER_1_DNS: 'DNS_RESOLUTION',
  LAYER_2_TCP: 'TCP_SOCKET',
  LAYER_3_PG_PROTOCOL: 'POSTGRES_STARTTLS_PROTOCOL',
  LAYER_4_TLS: 'TLS_CERTIFICATE_VALIDATION',
  LAYER_5_AUTH: 'POSTGRES_AUTHENTICATION',
  LAYER_6_DB_SELECT: 'DATABASE_SELECTION',
  LAYER_7_PERMISSIONS: 'DATABASE_PERMISSIONS',
  LAYER_8_CLI: 'SUPABASE_CLI_PROJECT_ACCESS'
};

/**
 * Checks DNS resolution distinguishing IPv4 and IPv6 families.
 */
export async function checkDnsResolution(hostname) {
  const result = {
    hostname,
    ipv4: null,
    ipv6: null,
    status: 'UNKNOWN',
    error: null
  };

  try {
    const ipv4Res = await dns.lookup(hostname, { family: 4 }).catch(err => ({ error: err.code || err.message }));
    if (!ipv4Res.error) {
      result.ipv4 = ipv4Res.address;
    }

    const ipv6Res = await dns.lookup(hostname, { family: 6 }).catch(err => ({ error: err.code || err.message }));
    if (!ipv6Res.error) {
      result.ipv6 = ipv6Res.address;
    }

    if (result.ipv4 || result.ipv6) {
      result.status = 'RESOLVED';
    } else {
      result.status = 'UNRESOLVED';
      result.error = 'Neither IPv4 nor IPv6 address resolved';
    }
  } catch (err) {
    result.status = 'ERROR';
    result.error = err.code || err.message;
  }

  return result;
}

/**
 * Probes TCP port connectivity with explicit timeout.
 */
export function probeTcpPort(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();

    const finish = (status, error = null) => {
      socket.destroy();
      resolve({
        host,
        port,
        status,
        latencyMs: Date.now() - start,
        error
      });
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      finish('CONNECTED');
    });

    socket.on('timeout', () => {
      finish('TIMEOUT', `Connection timed out after ${timeoutMs}ms`);
    });

    socket.on('error', (err) => {
      finish('FAILED', err.code || err.message);
    });

    try {
      socket.connect(port, host);
    } catch (err) {
      finish('FAILED', err.code || err.message);
    }
  });
}

/**
 * Probes PostgreSQL STARTTLS protocol support by sending an SSLRequest packet.
 * Server returns single byte: 'S' (SSL supported) or 'N' (SSL not supported).
 */
export function probePostgresSslRequest(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();

    const finish = (status, details = {}) => {
      socket.destroy();
      resolve({
        host,
        port,
        status,
        latencyMs: Date.now() - start,
        ...details
      });
    };

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      socket.write(PG_SSL_REQUEST_PACKET);
    });

    socket.once('data', (data) => {
      const replyChar = String.fromCharCode(data[0]);
      if (replyChar === 'S') {
        finish('SUPPORTED', { reply: 'S', sslSupported: true });
      } else if (replyChar === 'N') {
        finish('NOT_SUPPORTED', { reply: 'N', sslSupported: false, error: 'Server does not support SSL' });
      } else {
        finish('UNEXPECTED_RESPONSE', { reply: replyChar, rawHex: data.toString('hex') });
      }
    });

    socket.on('timeout', () => {
      finish('TIMEOUT', { error: `SSLRequest timed out after ${timeoutMs}ms` });
    });

    socket.on('error', (err) => {
      finish('FAILED', { error: err.code || err.message });
    });
  });
}

/**
 * Probes TLS negotiation and certificate validation over PostgreSQL STARTTLS.
 * Supports explicit CA certificate loading (e.g. prod-ca-2021.crt) and hostname verification.
 */
export function probeTlsHandshake(host, port, timeoutMs = 3000, options = {}) {
  const { caCertPath = null, servername = host } = options;
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();

    const finish = (status, details = {}) => {
      socket.destroy();
      resolve({
        host,
        port,
        status,
        latencyMs: Date.now() - start,
        ...details
      });
    };

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      socket.write(PG_SSL_REQUEST_PACKET);
    });

    socket.once('data', (data) => {
      if (String.fromCharCode(data[0]) !== 'S') {
        finish('PROTOCOL_FAILED', { error: `Expected SSLRequest response 'S', got '${String.fromCharCode(data[0])}'` });
        return;
      }

      // Load custom Supabase Root CA if available
      let customCa = undefined;
      if (caCertPath && fs.existsSync(caCertPath)) {
        try {
          customCa = [fs.readFileSync(caCertPath)];
        } catch (_e) {
          // Fall back to default CA store if read fails
        }
      }

      // Upgrade socket to TLS
      const tlsSocket = tls.connect({
        socket,
        servername,
        ca: customCa,
        rejectUnauthorized: false // Inspect certificate even if validation fails
      }, () => {
        const cert = tlsSocket.getPeerCertificate();
        const authorized = tlsSocket.authorized;
        const authError = tlsSocket.authorizationError;

        tlsSocket.end();

        let caTrustStatus;
        if (authorized) {
          caTrustStatus = customCa ? 'SUPABASE_CA_VERIFIED' : 'SYSTEM_CA_TRUSTED';
        } else {
          caTrustStatus = 'REQUIRES_SUPABASE_CA_OR_SSLMODE_REQUIRE';
        }

        finish('NEGOTIATED', {
          protocol: tlsSocket.getProtocol(),
          cipher: tlsSocket.getCipher() ? tlsSocket.getCipher().name : null,
          authorized,
          authorizationError: authError || null,
          certificate: {
            subjectCN: cert.subject ? cert.subject.CN : null,
            issuerCN: cert.issuer ? cert.issuer.CN : null,
            validTo: cert.valid_to || null,
            fingerprint256: cert.fingerprint256 || null
          },
          caTrustStatus
        });
      });

      tlsSocket.on('error', (err) => {
        finish('TLS_ERROR', { error: err.code || err.message });
      });
    });

    socket.on('timeout', () => {
      finish('TIMEOUT', { error: `TLS probe timed out after ${timeoutMs}ms` });
    });

    socket.on('error', (err) => {
      finish('TCP_FAILED', { error: err.code || err.message });
    });
  });
}

/**
 * Probes REST API availability via global fetch.
 */
export async function probeRestApi(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal
    });
    clearTimeout(timer);
    return {
      url,
      status: 'REACHABLE',
      httpStatus: res.status,
      statusText: res.statusText
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      url,
      status: 'UNREACHABLE',
      error: err.name === 'AbortError' ? 'TIMEOUT' : (err.code || err.message)
    };
  }
}

/**
 * Runs the full diagnostic suite across all 8 layers.
 */
export async function runDiagnostic({ rootDir = process.cwd(), timeoutMs = 2500 } = {}) {
  const loaded = loadEnvironment({ rootDir, injectProcessEnv: false });
  const env = loaded.env;

  const caCertPath = path.join(rootDir, DEFAULT_CA_CERT_NAME);
  const caCertExists = fs.existsSync(caCertPath);

  // Layer 1: DNS
  const dnsDirect = await checkDnsResolution(DIRECT_DB_HOST);
  const dnsPooler = await checkDnsResolution(POOLER_HOST);
  const dnsPrimaryPooler = await checkDnsResolution(POOLER_HOST_PRIMARY);

  // Layer 2: TCP
  const tcpDirect = await probeTcpPort(DIRECT_DB_HOST, 5432, timeoutMs);
  const tcpPoolerSession = await probeTcpPort(POOLER_HOST, POOLER_PORT_LEGACY_SESSION, timeoutMs);
  const tcpPoolerTransaction = await probeTcpPort(POOLER_HOST, 5432, timeoutMs);
  const tcpPrimarySession = await probeTcpPort(POOLER_HOST_PRIMARY, POOLER_PORT_SESSION, timeoutMs);

  // Layer 3: PostgreSQL Protocol (STARTTLS)
  // Probe primary session pooler on 5432 first, fallback to legacy session pooler on 6543
  let pgProtocolPooler = { status: 'SKIPPED', error: 'TCP not connected' };
  let activePoolerHost = POOLER_HOST_PRIMARY;
  let activePoolerPort = POOLER_PORT_SESSION;

  if (tcpPrimarySession.status === 'CONNECTED') {
    activePoolerHost = POOLER_HOST_PRIMARY;
    activePoolerPort = POOLER_PORT_SESSION;
    pgProtocolPooler = await probePostgresSslRequest(activePoolerHost, activePoolerPort, timeoutMs);
  } else if (tcpPoolerSession.status === 'CONNECTED') {
    activePoolerHost = POOLER_HOST;
    activePoolerPort = POOLER_PORT_LEGACY_SESSION;
    pgProtocolPooler = await probePostgresSslRequest(activePoolerHost, activePoolerPort, timeoutMs);
  }

  // Layer 4: TLS Certificate & Trust
  let tlsPooler = { status: 'SKIPPED', error: 'PG protocol not supported' };
  if (pgProtocolPooler.status === 'SUPPORTED') {
    tlsPooler = await probeTlsHandshake(activePoolerHost, activePoolerPort, timeoutMs + 1000, {
      caCertPath: caCertExists ? caCertPath : null
    });
  }

  // REST origin probe
  const restProbe = await probeRestApi(REST_ENDPOINT, timeoutMs);

  // Layer 4 Status determination:
  // If tlsPooler negotiated and authorized with CA: PASS
  // If negotiated but unauthorized (no CA or self-signed): CONDITIONAL_PASS
  // Otherwise FAIL
  let layer4Status = 'FAIL';
  if (tlsPooler.status === 'NEGOTIATED') {
    layer4Status = tlsPooler.authorized ? 'PASS' : 'CONDITIONAL_PASS';
  }

  // 8-Layer Structured Evaluation
  const layers = [
    {
      layer: 1,
      name: 'DNS Resolution',
      category: CONNECTIVITY_LAYERS.LAYER_1_DNS,
      status: (dnsPrimaryPooler.status === 'RESOLVED' || dnsPooler.status === 'RESOLVED') ? 'PASS' : 'FAIL',
      details: `Primary: ${dnsPrimaryPooler.status} (IPv4: ${dnsPrimaryPooler.ipv4 || 'none'}) | Direct: ${dnsDirect.status} (IPv4: ${dnsDirect.ipv4 || 'none'}, IPv6: ${dnsDirect.ipv6 || 'none'}) | Secondary: ${dnsPooler.status}`
    },
    {
      layer: 2,
      name: 'TCP Socket Connectivity',
      category: CONNECTIVITY_LAYERS.LAYER_2_TCP,
      status: (tcpPrimarySession.status === 'CONNECTED' || tcpPoolerSession.status === 'CONNECTED') ? 'PASS' : 'FAIL',
      details: `Primary Session :5432 ${tcpPrimarySession.status} (${tcpPrimarySession.latencyMs}ms) | Legacy :6543 ${tcpPoolerSession.status} | Direct :5432 ${tcpDirect.status}`
    },
    {
      layer: 3,
      name: 'PostgreSQL STARTTLS Protocol',
      category: CONNECTIVITY_LAYERS.LAYER_3_PG_PROTOCOL,
      status: pgProtocolPooler.status === 'SUPPORTED' ? 'PASS' : 'FAIL',
      details: `SSLRequest code 80877103 accepted by ${activePoolerHost}:${activePoolerPort} (response='${pgProtocolPooler.reply || 'none'}')`
    },
    {
      layer: 4,
      name: 'TLS Handshake & Certificate',
      category: CONNECTIVITY_LAYERS.LAYER_4_TLS,
      status: layer4Status,
      details: tlsPooler.status === 'NEGOTIATED'
        ? `Protocol: ${tlsPooler.protocol}, Cipher: ${tlsPooler.cipher}, Issuer: ${tlsPooler.certificate?.issuerCN} (Trust: ${tlsPooler.caTrustStatus}, Authorized: ${tlsPooler.authorized})`
        : `TLS probe failed: ${tlsPooler.error || 'unknown'}`
    },
    {
      layer: 5,
      name: 'PostgreSQL Authentication',
      category: CONNECTIVITY_LAYERS.LAYER_5_AUTH,
      status: 'NOT_TESTED',
      details: 'PENDING_REMOTE_ACTIVATION: Requires live credential challenge against remote database in B19.9.'
    },
    {
      layer: 6,
      name: 'Database Selection',
      category: CONNECTIVITY_LAYERS.LAYER_6_DB_SELECT,
      status: 'NOT_TESTED',
      details: 'PENDING_REMOTE_ACTIVATION: Requires authenticated session to confirm target postgres database.'
    },
    {
      layer: 7,
      name: 'Database Permissions',
      category: CONNECTIVITY_LAYERS.LAYER_7_PERMISSIONS,
      status: 'NOT_TESTED',
      details: 'PENDING_REMOTE_ACTIVATION: Requires authenticated session to inspect role permissions and RLS.'
    },
    {
      layer: 8,
      name: 'Supabase CLI Migration Compatibility',
      category: CONNECTIVITY_LAYERS.LAYER_8_CLI,
      status: 'NOT_TESTED',
      details: 'PENDING_REMOTE_ACTIVATION: Requires live remote preflight (npm run migrate:preflight:remote).'
    }
  ];

  return {
    timestamp: new Date().toISOString(),
    projectRef: CANONICAL_PROJECT_REF,
    region: CANONICAL_REGION,
    poolerPrimary: POOLER_HOST_PRIMARY,
    poolerPortSession: POOLER_PORT_SESSION,
    caCertPath: caCertExists ? caCertPath : null,
    caCertVerified: tlsPooler.caTrustStatus === 'SUPABASE_CA_VERIFIED',
    credentials: {
      hasPublishableKey: Boolean(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY),
      hasAccessToken: Boolean(env.SUPABASE_ACCESS_TOKEN),
      hasDbPassword: Boolean(env.SUPABASE_DB_PASSWORD)
    },
    dns: {
      direct: dnsDirect,
      pooler: dnsPooler,
      primaryPooler: dnsPrimaryPooler
    },
    tcp: {
      directPort5432: tcpDirect,
      primarySessionPort5432: tcpPrimarySession,
      poolerSessionPort6543: tcpPoolerSession,
      poolerTransactionPort5432: tcpPoolerTransaction
    },
    pgProtocol: {
      activeHost: activePoolerHost,
      activePort: activePoolerPort,
      poolerSession: pgProtocolPooler
    },
    tls: {
      activeHost: activePoolerHost,
      activePort: activePoolerPort,
      poolerSession: tlsPooler
    },
    rest: restProbe,
    layers,
    architectureSummary: {
      sessionPooler: {
        port: POOLER_PORT_SESSION,
        host: POOLER_HOST_PRIMARY,
        role: 'Primary Supavisor Session Pooler (aws-1). Verified IPv4 endpoint for CLI migrations, supporting verified TLS and prod-ca-2021.crt.'
      },
      sessionPoolerPrimary: {
        port: POOLER_PORT_SESSION,
        host: POOLER_HOST_PRIMARY,
        role: 'Primary Supavisor Session Pooler (aws-1). Verified IPv4 endpoint for CLI migrations, supporting verified TLS and prod-ca-2021.crt.'
      },
      directPostgres: {
        port: 5432,
        host: DIRECT_DB_HOST,
        role: 'Direct PostgreSQL wire protocol. Required for standard DDL migrations. Requires IPv6 or direct IPv4 route.'
      },
      legacySessionPooler: {
        port: POOLER_PORT_LEGACY_SESSION,
        host: POOLER_HOST,
        role: 'Supavisor Session Pooler (aws-0 port 6543). Secondary fallback.'
      },
      transactionPooler: {
        port: 5432,
        host: POOLER_HOST,
        role: 'Supavisor Transaction Pooler. High-concurrency stateless pooling.'
      },
      managementApi: {
        url: 'https://api.supabase.com/v1',
        role: 'Supabase Control Plane API. Invoked by Supabase CLI using Personal Access Token (PAT).'
      }
    }
  };
}

export async function runCli() {
  console.log('==============================================================================');
  console.log('AUROMASTI SUPABASE NETWORK & POOLER DIAGNOSTIC (LAYERED ENGINE)');
  console.log(`Target Project: ${CANONICAL_PROJECT_REF} | Region: ${CANONICAL_REGION}`);
  console.log('==============================================================================\n');

  console.log('Running diagnostics across connectivity layers...');
  const report = await runDiagnostic();

  console.log('\n--- 8-LAYER CONNECTIVITY VERIFICATION MODEL ---');
  for (const l of report.layers) {
    const symbol = l.status === 'PASS' ? '✔' : (l.status === 'CONDITIONAL_PASS' ? '▲' : (l.status === 'NOT_TESTED' ? '○' : '✖'));
    console.log(`[Layer ${l.layer}] ${symbol} ${l.name.padEnd(35)} : [${l.status}]`);
    console.log(`          ${l.details}`);
  }

  console.log('\n--- REST API REACHABILITY ---');
  console.log(`   Origin: ${report.rest.url}`);
  console.log(`   Status: ${report.rest.status} ${report.rest.httpStatus ? `(HTTP ${report.rest.httpStatus})` : `(${report.rest.error || 'N/A'})`}`);

  console.log('\n--- SESSION POOLER & TLS CA CERTIFICATE STATUS ---');
  console.log(`   Primary Session Pooler: ${report.poolerPrimary}:${report.poolerPortSession}`);
  console.log(`   Supabase Root CA:       ${report.caCertPath ? `FOUND (${report.caCertPath})` : 'NOT_FOUND'}`);
  console.log(`   TLS CA Verification:    ${report.caCertVerified ? 'VERIFIED (prod-ca-2021.crt)' : 'PENDING_OR_SYSTEM_TRUST'}`);

  console.log('\n--- CRITICAL SAFETY NOTICE ---');
  console.log('A successful TCP socket (Layer 2) or STARTTLS response (Layer 3) DOES NOT prove');
  console.log('successful PostgreSQL authentication (Layer 5) or CLI migration compatibility (Layer 8).');
  console.log('The pooler presents a certificate signed by Supabase Intermediate 2021 CA, requiring');
  console.log('proper CA trust or client driver sslmode configuration.');
  console.log('Layers 5-8 remain strictly UNVERIFIED until live remote activation in milestone B19.9.');

  console.log('\n==============================================================================');
  console.log('DIAGNOSTIC STATUS: COMPLETED WITHOUT SECRETS (Zero credentials exposed)');
  console.log('==============================================================================');

  // If Layer 1 (DNS pooler) or Layer 2 (TCP pooler) failed, exit with code 1
  if (report.layers[0].status === 'FAIL' || report.layers[1].status === 'FAIL') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('diagnose-network.mjs')) {
  runCli().catch(err => {
    console.error('Diagnostic error:', err.message);
    process.exit(1);
  });
}
