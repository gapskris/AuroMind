/**
 * AuroMasti — Safe Network & Database Connectivity Diagnostic
 *
 * Distinguishes:
 * 1. DNS Resolution (IPv4 vs IPv6)
 * 2. TCP Port Connectivity (Direct 5432 vs Pooler 6543)
 * 3. Supabase REST API Reachability
 * 4. Architectural Roles (Direct vs Session Pooler vs Transaction Pooler vs Management API)
 *
 * Guarantees zero secret exposure (all tokens and passwords strictly redacted).
 */

import net from 'node:net';
import dns from 'node:dns/promises';
import { loadEnvironment } from './load-env.mjs';

const CANONICAL_PROJECT_REF = 'rlqrtbjynaihdspbqtce';
const CANONICAL_REGION = 'ap-southeast-1';
const DIRECT_DB_HOST = `db.${CANONICAL_PROJECT_REF}.supabase.co`;
const POOLER_HOST = `aws-0-${CANONICAL_REGION}.pooler.supabase.com`;
const REST_ENDPOINT = `https://${CANONICAL_PROJECT_REF}.supabase.co/rest/v1/`;

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
 * Probes TCP port connectivity with a timeout.
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
 * Runs the full diagnostic suite.
 */
export async function runDiagnostic({ rootDir = process.cwd(), timeoutMs = 2500 } = {}) {
  const loaded = loadEnvironment({ rootDir, injectProcessEnv: false });
  const env = loaded.env;

  const dnsDirect = await checkDnsResolution(DIRECT_DB_HOST);
  const dnsPooler = await checkDnsResolution(POOLER_HOST);

  const tcpDirect = await probeTcpPort(DIRECT_DB_HOST, 5432, timeoutMs);
  const tcpPoolerSession = await probeTcpPort(POOLER_HOST, 6543, timeoutMs);
  const tcpPoolerTransaction = await probeTcpPort(POOLER_HOST, 5432, timeoutMs);

  const restProbe = await probeRestApi(REST_ENDPOINT, timeoutMs);

  return {
    timestamp: new Date().toISOString(),
    projectRef: CANONICAL_PROJECT_REF,
    region: CANONICAL_REGION,
    credentials: {
      hasPublishableKey: Boolean(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY),
      hasAccessToken: Boolean(env.SUPABASE_ACCESS_TOKEN),
      hasDbPassword: Boolean(env.SUPABASE_DB_PASSWORD)
    },
    dns: {
      direct: dnsDirect,
      pooler: dnsPooler
    },
    tcp: {
      directPort5432: tcpDirect,
      poolerSessionPort6543: tcpPoolerSession,
      poolerTransactionPort5432: tcpPoolerTransaction
    },
    rest: restProbe,
    architectureSummary: {
      directPostgres: {
        port: 5432,
        host: DIRECT_DB_HOST,
        role: 'Direct PostgreSQL wire protocol. Required for standard DDL migrations. Requires IPv6 or direct IPv4 route.'
      },
      sessionPooler: {
        port: 6543,
        host: POOLER_HOST,
        role: 'Supavisor Session Pooler. Recommended fallback for IPv4-only networks (e.g. mobile hotspots).'
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
  console.log('AUROMASTI SUPABASE NETWORK & POOLER DIAGNOSTIC');
  console.log(`Target Project: ${CANONICAL_PROJECT_REF} | Region: ${CANONICAL_REGION}`);
  console.log('==============================================================================\n');

  console.log('Running diagnostics (timeout: 2.5s per probe)...');
  const report = await runDiagnostic();

  console.log('\n1. DNS RESOLUTION:');
  console.log(`   - Direct Host (${DIRECT_DB_HOST}):`);
  console.log(`     IPv4: ${report.dns.direct.ipv4 || 'NONE / NOT_RESOLVED'}`);
  console.log(`     IPv6: ${report.dns.direct.ipv6 || 'NONE / NOT_RESOLVED'}`);
  console.log(`     Status: ${report.dns.direct.status} ${report.dns.direct.error ? `(${report.dns.direct.error})` : ''}`);
  console.log(`   - Pooler Host (${POOLER_HOST}):`);
  console.log(`     IPv4: ${report.dns.pooler.ipv4 || 'NONE / NOT_RESOLVED'}`);
  console.log(`     IPv6: ${report.dns.pooler.ipv6 || 'NONE / NOT_RESOLVED'}`);
  console.log(`     Status: ${report.dns.pooler.status} ${report.dns.pooler.error ? `(${report.dns.pooler.error})` : ''}\n`);

  console.log('2. TCP CONNECTIVITY:');
  console.log(`   - Direct Host Port 5432 (Postgres DDL):      ${report.tcp.directPort5432.status} ${report.tcp.directPort5432.error ? `(${report.tcp.directPort5432.error})` : `(${report.tcp.directPort5432.latencyMs}ms)`}`);
  console.log(`   - Pooler Host Port 6543 (Session Pooler):    ${report.tcp.poolerSessionPort6543.status} ${report.tcp.poolerSessionPort6543.error ? `(${report.tcp.poolerSessionPort6543.error})` : `(${report.tcp.poolerSessionPort6543.latencyMs}ms)`}`);
  console.log(`   - Pooler Host Port 5432 (Transaction Pooler):${report.tcp.poolerTransactionPort5432.status} ${report.tcp.poolerTransactionPort5432.error ? `(${report.tcp.poolerTransactionPort5432.error})` : `(${report.tcp.poolerTransactionPort5432.latencyMs}ms)`}\n`);

  console.log('3. HTTPS REST API:');
  console.log(`   - Origin: ${report.rest.url}`);
  console.log(`   - Status: ${report.rest.status} ${report.rest.httpStatus ? `(HTTP ${report.rest.httpStatus})` : `(${report.rest.error || 'N/A'})`}\n`);

  console.log('4. ARCHITECTURAL ROLES:');
  for (const [name, meta] of Object.entries(report.architectureSummary)) {
    console.log(`   - ${name}: ${meta.role}`);
  }

  console.log('\n==============================================================================');
  console.log('DIAGNOSTIC STATUS: SAFE & COMPLETED (Zero credentials or secrets logged)');
  console.log('==============================================================================');
}

if (process.argv[1] && process.argv[1].endsWith('diagnose-network.mjs')) {
  runCli().catch(err => {
    console.error('Diagnostic error:', err.message);
  });
}
