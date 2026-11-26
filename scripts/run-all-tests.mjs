/**
 * AuroMasti Automated Test Suite Runner & Regression Matrix Generator
 *
 * Runs all *.test.js files sequentially via child_process, capturing:
 * - Total tests, pass, fail, skip, todo, duration_ms
 * - Test suite name
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const files = readdirSync(rootDir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

console.log(`Discovered ${files.length} test files to execute.`);

const results = [];
let overallPass = 0;
let overallFail = 0;
let overallSkip = 0;
let overallTotal = 0;

for (const file of files) {
  process.stdout.write(`Executing ${file}... `);
  const startTime = Date.now();
  let stdout = '';
  let status = 'PASSED';

  try {
    stdout = execSync(`agy-node --test ${file}`, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000 // 3 min per suite
    });
  } catch (err) {
    status = 'FAILED';
    stdout = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + err.message;
  }

  const elapsed = Date.now() - startTime;

  // Parse node:test summary lines
  const testsMatch = stdout.match(/ℹ tests\s+(\d+)/);
  const passMatch = stdout.match(/ℹ pass\s+(\d+)/);
  const failMatch = stdout.match(/ℹ fail\s+(\d+)/);
  const skipMatch = stdout.match(/ℹ skipped\s+(\d+)/);
  const durationMatch = stdout.match(/ℹ duration_ms\s+([\d.]+)/);

  const tests = testsMatch ? parseInt(testsMatch[1], 10) : (status === 'PASSED' ? 1 : 0);
  const pass = passMatch ? parseInt(passMatch[1], 10) : (status === 'PASSED' ? 1 : 0);
  const fail = failMatch ? parseInt(failMatch[1], 10) : (status === 'FAILED' ? 1 : 0);
  const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
  const duration = durationMatch ? parseFloat(durationMatch[1]) : elapsed;

  overallTotal += tests;
  overallPass += pass;
  overallFail += fail;
  overallSkip += skip;

  console.log(`${status} (${pass}/${tests} passed in ${duration.toFixed(1)}ms)`);
  if (status === 'FAILED') {
    console.error(`--- OUTPUT FOR ${file} ---`);
    console.error(stdout.slice(0, 2000));
    console.error('--- END OUTPUT ---');
  }

  results.push({
    file,
    status,
    tests,
    pass,
    fail,
    skip,
    duration_ms: duration,
    outputPreview: stdout.slice(-500)
  });
}

const summary = {
  timestamp: new Date().toISOString(),
  totalSuites: files.length,
  overallTotal,
  overallPass,
  overallFail,
  overallSkip,
  results
};

writeFileSync(join(rootDir, 'test-execution-results.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n========================================`);
console.log(`FULL REGRESSION COMPLETE:`);
console.log(`Total Suites: ${files.length}`);
console.log(`Total Tests: ${overallTotal}`);
console.log(`Passed: ${overallPass}`);
console.log(`Failed: ${overallFail}`);
console.log(`Skipped: ${overallSkip}`);
console.log(`========================================`);

if (overallFail > 0) {
  process.exit(1);
}
