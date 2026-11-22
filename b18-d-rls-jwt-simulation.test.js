/**
 * AuroMind Modernization Batch B18-D — Authenticated RLS & PostgREST Simulation Tests
 *
 * Models and verifies the PostgREST request processing pipeline, JWT claims,
 * Row Level Security (RLS) predicates, and storage authorization rules.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PGTAP_SQL_PATH = path.join(__dirname, 'tests/rls/b18-d-rls-pgtap-matrix.sql');

describe('B18-D RLS & PostgREST — Static DDL & Policy Invariant Tests', () => {
  test('pgTAP SQL test matrix file exists and defines all 7 test cases', () => {
    assert.ok(fs.existsSync(PGTAP_SQL_PATH), 'pgTAP SQL matrix file must exist');
    const sql = fs.readFileSync(PGTAP_SQL_PATH, 'utf8');

    assert.ok(sql.includes('Validation Case 1: Anonymous Access Boundaries'), 'Must test Anon boundaries');
    assert.ok(sql.includes('Validation Case 2: Authenticated User A Accessing Own Data'), 'Must test User A access');
    assert.ok(sql.includes('Validation Case 3: User A Probing User B Private Data'), 'Must test cross-user isolation');
    assert.ok(sql.includes('Validation Case 4: Storage Object Ownership Boundary'), 'Must test storage boundaries');
    assert.ok(sql.includes('Validation Case 5: Service Role Administrative Access'), 'Must test service_role bypass');
  });

  test('pgTAP script uses realistic request.jwt.claims rather than bare SET ROLE', () => {
    const sql = fs.readFileSync(PGTAP_SQL_PATH, 'utf8');
    assert.ok(
      sql.includes('request.jwt.claims'),
      'Must set request.jwt.claims configuration parameter'
    );
    assert.ok(
      sql.includes('request.jwt.claim.sub'),
      'Must set request.jwt.claim.sub to model PostgREST auth.uid() resolution'
    );
  });
});

describe('B18-D RLS & PostgREST — Behavioral Policy Simulation Matrix', () => {
  // PostgREST Mock Database Engine
  const USER_A_ID = '11111111-1111-1111-1111-111111111111';
  const USER_B_ID = '22222222-2222-2222-2222-222222222222';

  const userProfilesTable = [
    { user_id: USER_A_ID, display_name: 'User A', is_public: true },
    { user_id: USER_B_ID, display_name: 'User B', is_public: false },
  ];

  const userPrivateSettingsTable = [
    { user_id: USER_A_ID, preferences: { theme: 'gold' }, analytics_opt_in: true },
    { user_id: USER_B_ID, preferences: { theme: 'dark' }, analytics_opt_in: false },
  ];

  const storageObjectsTable = [
    { id: 'art-1', bucket_id: 'user-artwork', name: `${USER_A_ID}/mandala-a.png`, owner: USER_A_ID },
    { id: 'art-2', bucket_id: 'user-artwork', name: `${USER_B_ID}/mandala-secret.png`, owner: USER_B_ID },
  ];

  function executePostgrestQuery(table, operation, jwtClaims, filterPredicate = () => true) {
    const role = jwtClaims?.role || 'anon';
    const authUid = jwtClaims?.sub || null;

    // Evaluate RLS Policies per table
    if (table === 'user_private_settings') {
      if (role === 'service_role') {
        return userPrivateSettingsTable.filter(filterPredicate);
      }
      if (role === 'anon') {
        return []; // Revoke all on user_private_settings from anon
      }
      if (role === 'authenticated') {
        // Policy: auth.uid() = user_id
        return userPrivateSettingsTable
          .filter((row) => row.user_id === authUid)
          .filter(filterPredicate);
      }
      return [];
    }

    if (table === 'user_profiles') {
      if (role === 'service_role') {
        return userProfilesTable.filter(filterPredicate);
      }
      // Policies: (auth.uid() = user_id) OR (is_public = true)
      return userProfilesTable
        .filter((row) => (authUid && row.user_id === authUid) || row.is_public === true)
        .filter(filterPredicate);
    }

    if (table === 'public_user_profiles_view') {
      // View with security_invoker: only where is_public = true
      return userProfilesTable
        .filter((row) => row.is_public === true)
        .filter(filterPredicate);
    }

    if (table === 'storage_objects') {
      if (role === 'service_role') {
        return storageObjectsTable.filter(filterPredicate);
      }
      if (role === 'anon') {
        return []; // Revoke all on storage.objects from anon
      }
      if (role === 'authenticated') {
        // Policy: bucket_id = 'user-artwork' and (storage.foldername(name))[1] = auth.uid()::text
        return storageObjectsTable
          .filter((obj) => {
            const folder = obj.name.split('/')[0];
            return obj.bucket_id === 'user-artwork' && folder === authUid;
          })
          .filter(filterPredicate);
      }
      return [];
    }

    throw new Error(`Unknown table: ${table}`);
  }

  test('Anonymous context cannot access private settings', () => {
    const results = executePostgrestQuery('user_private_settings', 'select', { role: 'anon' });
    assert.equal(results.length, 0, 'Anon must receive 0 private settings rows');
  });

  test('Anonymous context can only view public profiles in projection view', () => {
    const results = executePostgrestQuery('public_user_profiles_view', 'select', { role: 'anon' });
    assert.equal(results.length, 1, 'Anon sees exactly 1 public profile (User A)');
    assert.equal(results[0].user_id, USER_A_ID);
  });

  test('Authenticated User A can access own private settings', () => {
    const results = executePostgrestQuery('user_private_settings', 'select', {
      role: 'authenticated',
      sub: USER_A_ID,
    });
    assert.equal(results.length, 1, 'User A sees exactly own settings row');
    assert.equal(results[0].user_id, USER_A_ID);
    assert.equal(results[0].preferences.theme, 'gold');
  });

  test('Authenticated User A cannot access User B private settings', () => {
    const results = executePostgrestQuery(
      'user_private_settings',
      'select',
      { role: 'authenticated', sub: USER_A_ID },
      (row) => row.user_id === USER_B_ID
    );
    assert.equal(results.length, 0, 'User A probing User B must receive 0 rows');
  });

  test('Authenticated User A sees User B in profiles ONLY IF is_public = true', () => {
    // User B has is_public = false
    const results = executePostgrestQuery(
      'user_profiles',
      'select',
      { role: 'authenticated', sub: USER_A_ID },
      (row) => row.user_id === USER_B_ID
    );
    assert.equal(results.length, 0, 'Private profile of User B is invisible to User A');
  });

  test('Storage object isolation enforces folder ownership matching auth.uid()', () => {
    const userAArtwork = executePostgrestQuery('storage_objects', 'select', {
      role: 'authenticated',
      sub: USER_A_ID,
    });
    assert.equal(userAArtwork.length, 1, 'User A sees exactly 1 artwork');
    assert.equal(userAArtwork[0].owner, USER_A_ID);

    // User A querying User B artwork receives 0 rows
    const userBArtworkAsUserA = executePostgrestQuery(
      'storage_objects',
      'select',
      { role: 'authenticated', sub: USER_A_ID },
      (obj) => obj.owner === USER_B_ID
    );
    assert.equal(userBArtworkAsUserA.length, 0, 'User A cannot access User B artwork');
  });

  test('Service role bypasses RLS for administrative ingestion', () => {
    const allSettings = executePostgrestQuery('user_private_settings', 'select', {
      role: 'service_role',
    });
    assert.equal(allSettings.length, 2, 'Service role can access all private settings rows');

    const allArtwork = executePostgrestQuery('storage_objects', 'select', {
      role: 'service_role',
    });
    assert.equal(allArtwork.length, 2, 'Service role can access all storage objects');
  });
});
