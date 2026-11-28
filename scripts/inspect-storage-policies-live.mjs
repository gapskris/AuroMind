import fs from 'node:fs';
import path from 'node:path';
import { runSupabaseCli } from './migration-workflow.mjs';
import { loadEnvironment } from './load-env.mjs';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const loaded = loadEnvironment({ rootDir, injectProcessEnv: false });

const sql = `
  SELECT policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
  ORDER BY policyname;
`;

const tempFile = path.join(rootDir, 'temp_inspect_policies.sql');
fs.writeFileSync(tempFile, sql, 'utf8');

try {
  const out = runSupabaseCli(['db', 'query', '--file', tempFile, '--yes'], {
    env: loaded.env,
    rootDir,
    targetPooler: true
  });
  console.log('LIVE POLICIES ON storage.objects:\n' + out);
} catch (err) {
  console.error('Error querying policies:', err.message);
  if (err.stdout) console.log('STDOUT:', err.stdout);
  if (err.stderr) console.error('STDERR:', err.stderr);
} finally {
  if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
}
