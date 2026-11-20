/**
 * AuroMind Owner Analytics — Interactive Dashboard Controller
 * Connects the UI to AuroMind Platform SDK services and Supabase Owner Metrics.
 * Enforces dedicated Administrator Login, Owner Role Verification, and Session Expiry.
 */

import { calculateMetrics, BENCHMARK_BASELINES } from './models/analyticsDataContract.js';
import { detectEnvironment, resolveBackendConfig } from '../assets/sdk/config/backend-config.js';

let sdkInstance = null;
let supabaseClient = null;
let activeSession = null;
let activeOwnerEmail = null;
let cachedRemoteMetrics = null;

// =========================================================================
// 1. SUPABASE CONFIGURATION & CLIENT RESOLUTION (FIND-05 Remediated)
// =========================================================================

function getSupabaseConfig() {
  if (typeof window === 'undefined') return { supabaseUrl: null, supabaseAnonKey: null };
  const resolved = resolveBackendConfig();
  return {
    supabaseUrl: resolved.supabaseUrl,
    supabaseAnonKey: resolved.supabaseAnonKey
  };
}

async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const config = getSupabaseConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }
  try {
    const mod = await import('../assets/sdk/providers/supabase/supabase-client.js');
    if (mod && mod.createSupabaseClient) {
      supabaseClient = mod.createSupabaseClient(config);
      return supabaseClient;
    }
  } catch (err) {
    console.warn('[Analytics Dashboard] Could not initialize Supabase Client:', err);
  }
  return null;
}

async function resolveSDK() {
  if (typeof window !== 'undefined' && window.AuroMind && typeof window.AuroMind.init === 'function') {
    return window.AuroMind;
  }
  try {
    const mod = await import('../assets/sdk/auromind-sdk.js');
    return (mod && (mod.AuroMind || mod.default)) || window.AuroMind;
  } catch (err) {
    console.warn('[Analytics Dashboard] Could not import Shared SDK:', err);
    return null;
  }
}

// =========================================================================
// 2. AUTHENTICATION & ACCESS CONTROL
// =========================================================================

function showAuthMessage(msg, type = 'error') {
  const el = document.getElementById('admin-auth-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = `auth-msg ${type}`;
  el.style.display = 'block';
}

function clearAuthMessage() {
  const el = document.getElementById('admin-auth-msg');
  if (el) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function lockDashboard() {
  const overlay = document.getElementById('admin-auth-overlay');
  const dashboard = document.getElementById('dashboard-container');
  if (overlay) overlay.style.display = 'flex';
  if (dashboard) dashboard.style.display = 'none';
  activeSession = null;
  activeOwnerEmail = null;
  cachedRemoteMetrics = null;
}

function unlockDashboard(email, isLocalBypass = false) {
  const currentEnv = detectEnvironment();
  if (isLocalBypass && currentEnv === 'production') {
    console.error('[Security Violation] Developer bypass attempt blocked in production mode.');
    lockDashboard();
    showAuthMessage('Security Violation: Developer bypass is strictly forbidden in production mode.', 'error');
    return;
  }

  const overlay = document.getElementById('admin-auth-overlay');
  const dashboard = document.getElementById('dashboard-container');
  const emailDisplay = document.getElementById('owner-email-display');
  const roleBadge = document.querySelector('.badge-role');
  const bannerContainer = document.getElementById('dev-warning-banner-container');

  if (overlay) overlay.style.display = 'none';
  if (dashboard) dashboard.style.display = 'block';
  if (emailDisplay) emailDisplay.textContent = email;

  if (isLocalBypass) {
    if (roleBadge) {
      roleBadge.textContent = 'LOCAL DEV (SYNTHETIC)';
      roleBadge.style.background = 'var(--accent-teal)';
    }
    if (bannerContainer) {
      bannerContainer.innerHTML = '<div class="dev-warning-banner">⚠️ LOCAL DEVELOPER TEST MODE: Displaying synthetic benchmark baselines. Live production backend is disconnected.</div>';
      bannerContainer.style.display = 'block';
    }
  } else {
    if (roleBadge) {
      roleBadge.textContent = 'OWNER';
      roleBadge.style.background = 'var(--accent-gold)';
    }
    if (bannerContainer) {
      bannerContainer.innerHTML = '';
      bannerContainer.style.display = 'none';
    }
  }

  activeOwnerEmail = email;
}

async function verifyOwnerRole(token) {
  const config = getSupabaseConfig();
  if (!config.supabaseUrl || !token) {
    return { authorized: false, error: 'NO_CONFIG_OR_TOKEN' };
  }

  try {
    const res = await fetch(`${config.supabaseUrl}/functions/v1/owner-metrics`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': config.supabaseAnonKey,
        'Content-Type': 'application/json'
      }
    });

    if (res.status === 200) {
      const data = await res.json();
      return { authorized: true, metrics: data.metrics };
    } else if (res.status === 403) {
      return { authorized: false, error: 'FORBIDDEN_OWNER_ROLE_REQUIRED' };
    } else if (res.status === 401) {
      return { authorized: false, error: 'UNAUTHORIZED' };
    } else {
      return { authorized: false, error: `HTTP_${res.status}` };
    }
  } catch (err) {
    return { authorized: false, error: err.message || 'NETWORK_ERROR' };
  }
}

async function handleAdminSignIn(e) {
  if (e) e.preventDefault();
  clearAuthMessage();

  const emailEl = document.getElementById('admin-email');
  const passwordEl = document.getElementById('admin-password');
  const email = emailEl?.value?.trim();
  const password = passwordEl?.value;

  if (!email || !password) {
    showAuthMessage('Please enter both administrator email and password.');
    return;
  }

  const client = await getSupabaseClient();
  if (!client || !client.isConfigured()) {
    showAuthMessage('Supabase backend is unconfigured. Please configure SUPABASE_URL and SUPABASE_ANON_KEY, or use Local Developer Mode below.');
    return;
  }

  const signinBtn = document.getElementById('btn-admin-signin');
  if (signinBtn) {
    signinBtn.disabled = true;
    signinBtn.innerHTML = '<span>⏳</span> Verifying Credentials...';
  }

  try {
    const authRes = await client.auth.signInWithPassword({ email, password });
    if (!authRes.ok || !authRes.session) {
      showAuthMessage(authRes.error || 'Authentication failed. Please check your credentials.');
      return;
    }

    // Verify owner role on server
    const verification = await verifyOwnerRole(authRes.session.access_token);
    if (!verification.authorized) {
      if (verification.error === 'FORBIDDEN_OWNER_ROLE_REQUIRED') {
        showAuthMessage(`Access Denied: Account '${email}' does not have owner role privileges in public.owner_roles.`);
      } else {
        showAuthMessage(`Authorization verification failed: ${verification.error}`);
      }
      // Purge unauthorized session
      await client.auth.signOut();
      return;
    }

    // Authenticated and verified
    activeSession = authRes.session;
    cachedRemoteMetrics = verification.metrics;
    unlockDashboard(email);
    await refreshDashboard();

  } catch (err) {
    showAuthMessage(`Login error: ${err.message || err}`);
  } finally {
    if (signinBtn) {
      signinBtn.disabled = false;
      signinBtn.innerHTML = '<span>🔐</span> Sign In as Owner';
    }
  }
}

async function handlePasswordRecovery(e) {
  if (e) e.preventDefault();
  clearAuthMessage();

  const emailEl = document.getElementById('admin-recovery-email');
  const email = emailEl?.value?.trim();
  if (!email) {
    showAuthMessage('Please enter your administrator email.');
    return;
  }

  const client = await getSupabaseClient();
  if (!client || !client.isConfigured()) {
    showAuthMessage('Supabase backend is unconfigured.');
    return;
  }

  const btn = document.getElementById('btn-send-recovery');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Sending Reset Link...';
  }

  try {
    const res = await client.auth.resetPasswordForEmail(email);
    if (res.ok) {
      showAuthMessage('Password recovery link has been sent to your email.', 'success');
    } else {
      showAuthMessage(res.error || 'Failed to send recovery email.');
    }
  } catch (err) {
    showAuthMessage(err.message || 'Recovery request failed.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>✉️</span> Send Recovery Email';
    }
  }
}

async function handleAdminSignOut() {
  const client = await getSupabaseClient();
  if (client) {
    try {
      await client.auth.signOut();
    } catch {}
  }
  lockDashboard();
  showAuthMessage('You have been signed out of the Administrator Portal.', 'success');
}

async function checkExistingSession() {
  const currentEnv = detectEnvironment();
  const client = await getSupabaseClient();
  if (!client || !client.isConfigured()) {
    const indicator = document.getElementById('backend-status-indicator');
    const localBtn = document.getElementById('btn-dev-local-access');
    if (currentEnv === 'production') {
      if (indicator) {
        indicator.textContent = 'Production Backend Unavailable: Unconfigured credentials. Fail-closed enforced.';
        indicator.style.color = 'var(--accent-rose)';
      }
      if (localBtn) {
        localBtn.style.display = 'none';
      }
      lockDashboard();
      return;
    }

    if (indicator) indicator.textContent = 'Development Mode (Supabase unconfigured)';
    if (localBtn) localBtn.style.display = 'inline-block';
    return;
  }

  const indicator = document.getElementById('backend-status-indicator');
  if (indicator) indicator.textContent = 'Supabase Connected. Sign in with owner credentials.';

  // Session expiry listener
  if (typeof client.auth.onAuthStateChange === 'function') {
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && activeSession)) {
        lockDashboard();
        showAuthMessage('Session expired. Please sign in again.');
      }
    });
  }

  const session = client.auth.getSession();
  if (session && session.access_token) {
    const verification = await verifyOwnerRole(session.access_token);
    if (verification.authorized) {
      activeSession = session;
      cachedRemoteMetrics = verification.metrics;
      const email = session.user?.email || 'owner@auromind.org';
      unlockDashboard(email);
      await refreshDashboard();
      return;
    }
  }

  lockDashboard();
}

function setupAuthEventListeners() {
  const loginForm = document.getElementById('admin-login-form');
  if (loginForm) loginForm.addEventListener('submit', handleAdminSignIn);

  const recoveryForm = document.getElementById('admin-recovery-form');
  if (recoveryForm) recoveryForm.addEventListener('submit', handlePasswordRecovery);

  const toggleRecoveryBtn = document.getElementById('btn-toggle-recovery');
  if (toggleRecoveryBtn) {
    toggleRecoveryBtn.addEventListener('click', () => {
      clearAuthMessage();
      if (loginForm) loginForm.style.display = 'none';
      if (recoveryForm) recoveryForm.style.display = 'block';
    });
  }

  const cancelRecoveryBtn = document.getElementById('btn-cancel-recovery');
  if (cancelRecoveryBtn) {
    cancelRecoveryBtn.addEventListener('click', () => {
      clearAuthMessage();
      if (recoveryForm) recoveryForm.style.display = 'none';
      if (loginForm) loginForm.style.display = 'block';
    });
  }

  const signoutBtn = document.getElementById('btn-admin-signout');
  if (signoutBtn) signoutBtn.addEventListener('click', handleAdminSignOut);

  const localBypassBtn = document.getElementById('btn-dev-local-access');
  if (localBypassBtn) {
    localBypassBtn.addEventListener('click', () => {
      const env = detectEnvironment();
      if (env === 'production') {
        console.error('[Security Violation] Developer fallback is strictly prohibited in production mode.');
        showAuthMessage('Access Denied: Developer fallback is strictly forbidden in production mode.', 'error');
        return;
      }
      unlockDashboard('developer@local.test', true);
      refreshDashboard();
    });
  }
}

// =========================================================================
// 3. TAB NAVIGATION & VIEW RENDERING
// =========================================================================

function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-content');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      tabButtons.forEach((b) => b.classList.remove('active'));
      tabPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
}

function renderKPIs(metrics) {
  const sum = metrics.summary;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setVal('kpi-total-seekers', sum.totalRegisteredSeekers.toLocaleString());
  setVal('kpi-dau', sum.dailyActiveSeekers.toLocaleString());
  setVal('kpi-mau', sum.monthlyActiveSeekers.toLocaleString());
  setVal('kpi-session-len', `${sum.avgSessionDurationMin}m`);
  setVal('kpi-retention-d1', `${(sum.retentionRateD1 * 100).toFixed(1)}%`);
  setVal('kpi-retention-d7', `${(sum.retentionRateD7 * 100).toFixed(1)}%`);
  setVal('kpi-health-rate', `${sum.technicalHealthRate}%`);

  setVal('kpi-theater-launches', metrics.liveTelemetry.gameLaunches['portal'] || 0);
  setVal('kpi-buffered-events', metrics.liveTelemetry.bufferedEventCount);
  setVal('kpi-consent-status', metrics.privacy.consentActive ? 'OPTED IN' : 'OPTED OUT');
}

function renderGamesDistribution(metrics) {
  const container = document.getElementById('games-distribution-list');
  if (!container) return;

  container.innerHTML = '';
  const games = metrics.gamePerformance.baselines;
  const liveLaunches = metrics.gamePerformance.liveLaunches;

  for (const [key, data] of Object.entries(games)) {
    const liveCount = liveLaunches[key] || 0;
    const sharePercent = (data.sessionsShare * 100).toFixed(1);

    const row = document.createElement('div');
    row.className = 'bar-item';
    row.innerHTML = `
      <div class="bar-labels">
        <span class="bar-name">${data.name} ${liveCount > 0 ? `<strong style="color:var(--accent-emerald)">(+${liveCount} live)</strong>` : ''}</span>
        <span class="bar-value">${sharePercent}% (${data.avgSessionMin}m avg)</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${sharePercent}%;"></div>
      </div>
    `;
    container.appendChild(row);
  }
}

function renderStorageHealth(diagnostics) {
  const container = document.getElementById('storage-health-grid');
  if (!container) return;

  const health = diagnostics?.storageHealth || {};
  container.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-title">IndexedDB Available</div>
      <div class="kpi-value">${health.idbAvailable ? 'YES' : 'NO'}</div>
      <div class="kpi-subtext">Primary persistent storage</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">localStorage Mirror</div>
      <div class="kpi-value">${health.lsAvailable ? 'YES' : 'NO'}</div>
      <div class="kpi-subtext">Synchronous cache mirror</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Web Locks Supported</div>
      <div class="kpi-value">${health.webLocksSupported ? 'YES' : 'NO'}</div>
      <div class="kpi-subtext">Cross-tab write synchronization</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">BroadcastChannel Supported</div>
      <div class="kpi-value">${health.broadcastChannelSupported ? 'YES' : 'NO'}</div>
      <div class="kpi-subtext">Cross-tab real-time event bus</div>
    </div>
  `;
}

function renderDiagnosticsLogs(diagnostics) {
  const tbody = document.getElementById('logs-table-body');
  if (!tbody) return;

  const logs = diagnostics?.logs || [];
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:0.6;">No diagnostics logs available</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  const reversed = [...logs].reverse();
  for (const entry of reversed) {
    const tr = document.createElement('tr');
    const badgeClass =
      entry.level === 'ERROR' || entry.level === 'FATAL'
        ? 'badge-error'
        : entry.level === 'WARN'
        ? 'badge-warn'
        : 'badge-info';

    const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '--';
    const dataStr = entry.data ? JSON.stringify(entry.data) : '';

    tr.innerHTML = `
      <td style="white-space:nowrap; opacity:0.8;">${timeStr}</td>
      <td><span class="level-badge ${badgeClass}">${entry.level}</span></td>
      <td><strong>${entry.tag || 'platform'}</strong></td>
      <td>${entry.message || ''}</td>
      <td style="font-family:monospace; font-size:0.75rem; opacity:0.85; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${dataStr}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function refreshDashboard() {
  if (!sdkInstance) return;

  const liveQueue = sdkInstance.telemetry && typeof sdkInstance.telemetry.getQueue === 'function'
    ? sdkInstance.telemetry.getQueue(200)
    : [];

  const diagnostics = sdkInstance.diagnostics && typeof sdkInstance.diagnostics.exportDiagnostics === 'function'
    ? sdkInstance.diagnostics.exportDiagnostics()
    : null;

  const metrics = calculateMetrics(liveQueue, diagnostics);

  // If we have active session and haven't fetched remote metrics yet, fetch them
  if (activeSession && !cachedRemoteMetrics) {
    const v = await verifyOwnerRole(activeSession.access_token);
    if (v.authorized) {
      cachedRemoteMetrics = v.metrics;
    }
  }

  if (cachedRemoteMetrics) {
    if (cachedRemoteMetrics.totalRegisteredUsers) {
      metrics.summary.totalRegisteredSeekers = cachedRemoteMetrics.totalRegisteredUsers;
    }
    if (cachedRemoteMetrics.dau) {
      metrics.summary.dailyActiveSeekers = cachedRemoteMetrics.dau;
    }
    if (cachedRemoteMetrics.mau) {
      metrics.summary.monthlyActiveSeekers = cachedRemoteMetrics.mau;
    }
    if (cachedRemoteMetrics.totalIngestedEvents) {
      metrics.liveTelemetry.bufferedEventCount = cachedRemoteMetrics.totalIngestedEvents;
    }
    if (cachedRemoteMetrics.gamePopularity) {
      for (const [gId, gData] of Object.entries(cachedRemoteMetrics.gamePopularity)) {
        metrics.gamePerformance.liveLaunches[gId] = (metrics.gamePerformance.liveLaunches[gId] || 0) + (gData.launches || 0);
      }
    }
    if (cachedRemoteMetrics.retention) {
      if (typeof cachedRemoteMetrics.retention.d1 === 'number') metrics.summary.retentionRateD1 = cachedRemoteMetrics.retention.d1;
      if (typeof cachedRemoteMetrics.retention.d7 === 'number') metrics.summary.retentionRateD7 = cachedRemoteMetrics.retention.d7;
      if (typeof cachedRemoteMetrics.retention.d30 === 'number') metrics.summary.retentionRateD30 = cachedRemoteMetrics.retention.d30;
    }
  }

  renderKPIs(metrics);
  renderGamesDistribution(metrics);
  renderStorageHealth(diagnostics);
  renderDiagnosticsLogs(diagnostics);

  const gateActive = sdkInstance.entitlements && typeof sdkInstance.entitlements.isCommercialGateActive === 'function'
    ? sdkInstance.entitlements.isCommercialGateActive()
    : false;
  const gateEl = document.getElementById('kpi-gate-state');
  if (gateEl) {
    gateEl.textContent = gateActive ? 'ACTIVE' : 'INACTIVE';
  }

  const entList = sdkInstance.entitlements && typeof sdkInstance.entitlements.getEntitlements === 'function'
    ? sdkInstance.entitlements.getEntitlements()
    : [];
  const entEl = document.getElementById('kpi-local-entitlements-count');
  if (entEl) {
    entEl.textContent = entList.length;
  }
}

function setupActions() {
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshDashboard);
  }

  const exportBtn = document.getElementById('btn-export-diagnostics');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!sdkInstance || !sdkInstance.diagnostics) return;
      const data = sdkInstance.diagnostics.exportDiagnostics();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auromind-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  const clearLogsBtn = document.getElementById('btn-clear-logs');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      if (sdkInstance && sdkInstance.logging && typeof sdkInstance.logging.clear === 'function') {
        sdkInstance.logging.clear();
        refreshDashboard();
      }
    });
  }
}

async function init() {
  initTabNavigation();
  setupActions();
  setupAuthEventListeners();

  sdkInstance = await resolveSDK();
  if (sdkInstance && typeof sdkInstance.init === 'function') {
    try {
      await sdkInstance.init({ gameId: 'owner-analytics', appVersion: '1.0.0' });
    } catch (_e) {}
  }

  await checkExistingSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
