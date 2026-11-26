/**
 * Read-only probe for external staging and production origins.
 */

async function probeOrigin(targetUrl) {
  console.log(`\n========================================`);
  console.log(`Probing Origin: ${targetUrl}`);
  console.log(`========================================`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const startTime = Date.now();
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'AuroMasti-Deploy-Probe/2.0' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    const duration = Date.now() - startTime;

    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(`Final URL: ${res.url}`);
    console.log(`Response Time: ${duration}ms`);
    console.log(`Headers:`);
    for (const [k, v] of res.headers.entries()) {
      console.log(`  ${k}: ${v}`);
    }

    const text = await res.text();
    console.log(`Body Length: ${text.length} bytes`);
    console.log(`Body Preview: ${text.slice(0, 300).replace(/\r?\n/g, ' ')}...`);

    // Check release manifest on origin
    const manifestUrl = new URL('/release-manifest.json', targetUrl).href;
    try {
      const mRes = await fetch(manifestUrl, { headers: { 'User-Agent': 'AuroMasti-Deploy-Probe/2.0' } });
      console.log(`Release Manifest (${manifestUrl}): ${mRes.status} ${mRes.statusText}`);
      if (mRes.ok) {
        const mJson = await mRes.json();
        console.log(`Manifest Data: Version ${mJson.version}, Apps: ${mJson.applications?.map(a => a.id).join(', ')}`);
      }
    } catch (mErr) {
      console.log(`Release Manifest Fetch Error: ${mErr.message}`);
    }

    return { reachable: true, status: res.status, url: res.url, headers: Object.fromEntries(res.headers.entries()) };
  } catch (err) {
    console.log(`PROBE FAILED: ${err.message} (code: ${err.code || 'UNKNOWN'}, cause: ${err.cause?.code || err.cause?.message || 'none'})`);
    return { reachable: false, error: err.message, code: err.code || err.cause?.code };
  }
}

async function run() {
  const origins = [
    'https://staging.auromasti.pages.dev',
    'https://auromasti.com'
  ];

  const results = {};
  for (const url of origins) {
    results[url] = await probeOrigin(url);
  }

  console.log(`\nProbe Results Summary:`, JSON.stringify(results, null, 2));
}

run();
