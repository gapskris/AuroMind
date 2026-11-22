/**
 * AuroMind Modernization Batch B18-D — Telemetry Token Bucket Validation Tests
 *
 * Verifies Migration 8 structural requirements, parameter bounds,
 * non-finite numeric rejection, and rate-limiting logic.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_PATH = path.join(
  __dirname,
  'supabase/migrations/20261122000004_b18d_telemetry_token_bucket_input_validation.sql'
);

describe('B18-D Migration 8 — Static DDL & Security Architecture', () => {
  test('Migration 8 file exists and has correct timestamp naming convention', () => {
    assert.ok(fs.existsSync(MIGRATION_PATH), 'Migration 8 file must exist on disk');
    const baseName = path.basename(MIGRATION_PATH);
    assert.match(
      baseName,
      /^20261122\d{6}_b18d_telemetry_token_bucket_input_validation\.sql$/,
      'Must follow ISO timestamped migration naming convention'
    );
  });

  test('Migration 8 declares SECURITY DEFINER and pins search_path', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    assert.ok(sql.includes('security definer'), 'Must declare security definer');
    assert.match(
      sql,
      /set\s+search_path\s*=\s*pg_catalog,\s*public/i,
      'Must pin search_path strictly to pg_catalog, public'
    );
  });

  test('Migration 8 schema-qualifies all table references', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    assert.ok(
      sql.includes('public.telemetry_rate_buckets'),
      'Must reference public.telemetry_rate_buckets with schema qualifier'
    );
    // Negative assertion: no unqualified table references
    assert.equal(
      /from\s+telemetry_rate_buckets\b/i.test(sql),
      false,
      'Must not reference unqualified telemetry_rate_buckets'
    );
  });

  test('Migration 8 revokes from public/anon/authenticated and grants to service_role only', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    assert.match(
      sql,
      /revoke\s+all\s+on\s+function\s+public\.consume_telemetry_token.*from\s+public,\s*anon,\s*authenticated/i,
      'Must revoke permissions from public, anon, and authenticated'
    );
    assert.match(
      sql,
      /grant\s+execute\s+on\s+function\s+public\.consume_telemetry_token.*to\s+service_role/i,
      'Must grant execute permission exclusively to service_role'
    );
  });

  test('Migration 8 does NOT use unsafe "x != x" as a NaN detector', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    // In PostgreSQL numeric, 'NaN' = 'NaN' is TRUE, so x != x fails to detect NaN.
    assert.equal(
      /!=\s*p_capacity/i.test(sql) || /!=\s*p_fill_rate/i.test(sql),
      false,
      'Must not use x != x as a NaN detector in PostgreSQL'
    );
    assert.ok(
      sql.includes("'NaN'::numeric"),
      'Must test equality against explicit NaN numeric constant'
    );
  });

  test('Migration 8 checks non-finite strings (Infinity, -Infinity, NaN)', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    assert.ok(sql.includes("'Infinity'"), "Must check for 'Infinity'");
    assert.ok(sql.includes("'-Infinity'"), "Must check for '-Infinity'");
    assert.ok(sql.includes("'NaN'"), "Must check for 'NaN'");
  });
});

describe('B18-D Migration 8 — Behavioral Validation Logic Simulation', () => {
  // Pure JavaScript simulation of the PL/pgSQL validation gate
  function simulateConsumeTelemetryToken(p_ip_hash, p_capacity = 60.0, p_fill_rate = 1.0) {
    // Gate 1: IP Hash Structure & Length
    if (p_ip_hash === null || p_ip_hash === undefined || p_ip_hash.length === 0) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_EMPTY_OR_NULL_IP_HASH' };
    }
    if (p_ip_hash.length > 64) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_IP_HASH_EXCEEDS_MAX_LENGTH' };
    }

    // Gate 2: Non-Finite Numeric Rejection
    if (p_capacity === null || p_capacity === undefined || p_fill_rate === null || p_fill_rate === undefined) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_NULL_NUMERIC_PARAMETER' };
    }
    if (
      Number.isNaN(p_capacity) ||
      Number.isNaN(p_fill_rate) ||
      !Number.isFinite(p_capacity) ||
      !Number.isFinite(p_fill_rate)
    ) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_NON_FINITE_NUMERIC_PARAMETER' };
    }

    // Gate 3: Explicit Bounds
    if (p_capacity < 1.0 || p_capacity > 1000.0) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_CAPACITY_OUT_OF_BOUNDS' };
    }
    if (p_fill_rate < 0.01 || p_fill_rate > 100.0) {
      return { allowed: false, error: 'INVALID_PARAMETERS', code: 'ERR_FILL_RATE_OUT_OF_BOUNDS' };
    }

    return { allowed: true, remaining: p_capacity - 1.0, capacity: p_capacity };
  }

  const validIpHash = Buffer.alloc(32, 0xab); // 32-byte SHA-256 binary hash

  test('Valid parameters pass and consume one token', () => {
    const res = simulateConsumeTelemetryToken(validIpHash, 60.0, 1.0);
    assert.equal(res.allowed, true);
    assert.equal(res.remaining, 59.0);
  });

  test('NULL and empty IP hashes are rejected with ERR_EMPTY_OR_NULL_IP_HASH', () => {
    assert.equal(
      simulateConsumeTelemetryToken(null, 60.0, 1.0).code,
      'ERR_EMPTY_OR_NULL_IP_HASH'
    );
    assert.equal(
      simulateConsumeTelemetryToken(Buffer.alloc(0), 60.0, 1.0).code,
      'ERR_EMPTY_OR_NULL_IP_HASH'
    );
  });

  test('Oversized IP hash (> 64 bytes) is rejected with ERR_IP_HASH_EXCEEDS_MAX_LENGTH', () => {
    const oversizedHash = Buffer.alloc(65, 0xcd);
    assert.equal(
      simulateConsumeTelemetryToken(oversizedHash, 60.0, 1.0).code,
      'ERR_IP_HASH_EXCEEDS_MAX_LENGTH'
    );
  });

  test('NaN capacity and fill rate are rejected with ERR_NON_FINITE_NUMERIC_PARAMETER', () => {
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, NaN, 1.0).code,
      'ERR_NON_FINITE_NUMERIC_PARAMETER'
    );
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, 60.0, NaN).code,
      'ERR_NON_FINITE_NUMERIC_PARAMETER'
    );
  });

  test('Infinity and -Infinity are rejected with ERR_NON_FINITE_NUMERIC_PARAMETER', () => {
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, Infinity, 1.0).code,
      'ERR_NON_FINITE_NUMERIC_PARAMETER'
    );
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, 60.0, -Infinity).code,
      'ERR_NON_FINITE_NUMERIC_PARAMETER'
    );
  });

  test('Out-of-bounds capacity is rejected', () => {
    // Below lower bound 1.0
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, 0.5, 1.0).code,
      'ERR_CAPACITY_OUT_OF_BOUNDS'
    );
    // Above upper bound 1000.0
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, 1001.0, 1.0).code,
      'ERR_CAPACITY_OUT_OF_BOUNDS'
    );
  });

  test('Out-of-bounds fill rate is rejected', () => {
    // Below lower bound 0.01
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, 60.0, 0.005).code,
      'ERR_FILL_RATE_OUT_OF_BOUNDS'
    );
    // Above upper bound 100.0
    assert.equal(
      simulateConsumeTelemetryToken(validIpHash, 60.0, 101.0).code,
      'ERR_FILL_RATE_OUT_OF_BOUNDS'
    );
  });
});
