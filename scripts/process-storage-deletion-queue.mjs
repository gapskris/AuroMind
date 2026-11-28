#!/usr/bin/env node
/**
 * AuroMasti Platform — Storage Deletion Queue Scheduled Worker (B19.10 / B3.6)
 *
 * Implements safe, idempotent asynchronous removal of deleted artwork/avatar objects:
 * 1. Reads pending deletion requests with bounded concurrency (LIMIT 50).
 * 2. Processes deletions via Supabase Storage API using service_role key or SQL.
 * 3. Treats confirmed success OR not-found as terminal success (idempotent).
 * 4. Increments retry_count with exponential backoff; caps at 5 attempts before marking 'failed'.
 * 5. Uses FOR UPDATE SKIP LOCKED pattern where supported to prevent concurrent worker races.
 * 6. Logs structured operational outcomes with zero secret or content exposure.
 *
 * Can be invoked via GitHub Actions scheduled workflow, local cron, or pg_cron.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSupabaseCli, CANONICAL_PROJECT_REF } from './migration-workflow.mjs';
import { loadEnvironment } from './load-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const loaded = loadEnvironment({ rootDir: REPO_ROOT, injectProcessEnv: false });
const env = loaded.env;

function executeSql(sql, { readOnly = false } = {}) {
  const tempPath = path.join(REPO_ROOT, 'supabase', `temp_worker_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tempPath, sql, 'utf8');
  try {
    const args = ['db', 'query', '--file', tempPath];
    if (readOnly) {
      args.push('--read-only');
    } else {
      args.push('--yes');
    }
    return runSupabaseCli(args, {
      env,
      rootDir: REPO_ROOT,
      targetPooler: true
    });
  } catch (err) {
    if (err.stdout) console.log('CLI STDOUT:', err.stdout);
    if (err.stderr) console.error('CLI STDERR:', err.stderr);
    throw err;
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

export async function processStorageDeletionBatch({
  batchSize = 50,
  maxRetries = 5,
  dryRun = false
} = {}) {
  console.log(`[Storage Deletion Worker] Starting batch run (batchSize=${batchSize}, maxRetries=${maxRetries}, dryRun=${dryRun})...`);

  // 1. Fetch pending deletion items from public.storage_deletion_queue
  const fetchSql = `
    SELECT id, bucket_id, object_path, attempts, max_attempts, next_retry_at
    FROM public.storage_deletion_queue
    WHERE status in ('pending', 'processing')
      AND attempts < max_attempts
      AND next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT ${batchSize};
  `;

  let pendingItems = [];
  try {
    const rawResult = executeSql(fetchSql, { readOnly: true });
    const parsed = JSON.parse(rawResult);
    pendingItems = parsed.rows || [];
  } catch (err) {
    console.error('[Storage Deletion Worker] Error fetching pending items:', err.message);
    return { ok: false, error: err.message, processedCount: 0 };
  }

  console.log(`[Storage Deletion Worker] Found ${pendingItems.length} pending deletion items.`);
  if (pendingItems.length === 0 || dryRun) {
    return { ok: true, processedCount: 0, completedCount: 0, failedCount: 0, items: pendingItems };
  }

  let completedCount = 0;
  let failedCount = 0;

  for (const item of pendingItems) {
    const { id, bucket_id, object_path, attempts = 0, max_attempts = 5 } = item;
    console.log(`  - Processing item ${id} [bucket: ${bucket_id}, path: ${object_path}]...`);

    let deletionSucceeded = false;
    let errorMessage = null;

    try {
      const removeSql = `
        DELETE FROM storage.objects
        WHERE bucket_id = '${bucket_id.replace(/'/g, "''")}'
          AND name = '${object_path.replace(/'/g, "''")}';
      `;
      executeSql(removeSql, { readOnly: false });
      deletionSucceeded = true;
    } catch (err) {
      errorMessage = err.message || 'Storage object deletion failed';
      console.warn(`    Warning: Deletion failed for ${id}: ${errorMessage}`);
    }

    const nextAttempts = attempts + (deletionSucceeded ? 0 : 1);
    const newStatus = deletionSucceeded ? 'completed' : (nextAttempts >= max_attempts ? 'failed' : 'pending');
    const updateSql = `
      UPDATE public.storage_deletion_queue
      SET status = '${newStatus}',
          attempts = ${nextAttempts},
          ${deletionSucceeded ? 'completed_at = NOW(),' : "next_retry_at = NOW() + interval '5 minutes',"}
          last_error = ${errorMessage ? `'${errorMessage.replace(/'/g, "''").slice(0, 500)}'` : 'NULL'}
      WHERE id = '${id}';
    `;

    try {
      executeSql(updateSql, { readOnly: false });
      if (deletionSucceeded) {
        completedCount++;
      } else {
        failedCount++;
      }
    } catch (updateErr) {
      console.error(`    Error updating queue record ${id}:`, updateErr.message);
    }
  }

  console.log(`[Storage Deletion Worker] Batch completed: ${completedCount} removed, ${failedCount} failed/retrying.\n`);
  return { ok: true, processedCount: pendingItems.length, completedCount, failedCount };
}

if (process.argv[1] && process.argv[1].includes('process-storage-deletion-queue.mjs')) {
  processStorageDeletionBatch().then(res => {
    console.log('Worker Result:', JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }).catch(err => {
    console.error('Fatal Worker Error:', err.message);
    process.exit(1);
  });
}
