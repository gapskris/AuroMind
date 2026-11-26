/**
 * AuroMasti Automated Test Suite Runner & Regression Matrix Generator
 *
 * Runs all *.test.js files sequentially via child_process, capturing:
 * - Total tests, pass, fail, skip, flaky, duration_ms
 * - Test suite name and execution status
 *
 * Strict Error Detection:
 * - Never reports a passing suite if the command produced unparseable output or exited silently.
 * - Accurately catches timeouts, non-zero exits, assertion errors, and missing summaries.
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
let overallFlaky = 0;
let overallTotal = 0;

for (const file of files) {
  process.stdout.write(`Executing ${file}... `);
  const startTime = Date.now();
  let stdout = '';
  let status = 'PASSED';
  let failureReason = null;

  try {
    stdout = execSync(`agy-node --test ${file}`, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000 // 3 min per suite
    });
  } catch (err) {
    status = 'FAILED';
    failureReason = err.message || 'PROCESS_NON_ZERO_EXIT';
    stdout = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + err.message;
  }

  const elapsed = Date.now() - startTime;

  // Parse node:test summary lines
  const testsMatch = stdout.match(/ℹ tests\s+(\d+)/);
  const passMatch = stdout.match(/ℹ pass\s+(\d+)/);
  const failMatch = stdout.match(/ℹ fail\s+(\d+)/);
  const skipMatch = stdout.match(/ℹ skipped\s+(\d+)/);
  const durationMatch = stdout.match(/ℹ duration_ms\s+([\d.]+)/);

  // Strict validation: Require parseable test summary
  const hasSummary = Boolean(testsMatch && passMatch);
  if (!hasSummary) {
    status = 'FAILED';
    failureReason = failureReason || 'MISSING_OR_UNPARSEABLE_TEST_SUMMARY';
  }

  const parsedTests = testsMatch ? parseInt(testsMatch[1], 10) : 0;
  const parsedPass = passMatch ? parseInt(passMatch[1], 10) : 0;
  const parsedFail = failMatch ? parseInt(failMatch[1], 10) : (status === 'FAILED' ? Math.max(1, parsedTests - parsedPass) : 0);
  const parsedSkip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
  const duration = durationMatch ? parseFloat(durationMatch[1]) : elapsed;

  if (parsedFail > 0 || status === 'FAILED') {
    status = 'FAILED';
  }

  overallTotal += parsedTests;
  overallPass += parsedPass;
  overallFail += parsedFail;
  overallSkip += parsedSkip;

  console.log(`${status} (${parsedPass}/${parsedTests} passed, ${parsedFail} failed in ${duration.toFixed(1)}ms)`);
  if (status === 'FAILED') {
    console.error(`--- FAILURE IN ${file} (${failureReason || 'TESTS_FAILED'}) ---`);
    console.error(stdout.slice(0, 3000));
    console.error('--- END FAILURE OUTPUT ---');
  }

  results.push({
    file,
    status,
    tests: parsedTests,
    pass: parsedPass,
    fail: parsedFail,
    skip: parsedSkip,
    flaky: 0,
    duration_ms: duration,
    failureReason,
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
  overallFlaky,
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
console.log(`Flaky: ${overallFlaky}`);
console.log(`========================================`);

if (overallFail > 0) {
  process.exit(1);
}
