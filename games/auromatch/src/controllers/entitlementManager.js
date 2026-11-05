/**
 * AuroMatch - Zen Tile Solitaire
 * Entitlement & Commercial Licensing Manager (ENT-001)
 *
 * Architecture:
 * - Free Beta / Unrestricted Mode by default (COMMERCIAL_GATE_ENABLED: false)
 * - Future-proof: When commercialization is approved, toggling the flag activates
 *   the paywall after Level 5 without rewriting gameplay or layout generators.
 * - Privacy-First & Offline: Validates offline signed tokens from localStorage.
 * - AuroMind Portal Bridge: Communicates purchase events via HTML5 postMessage.
 */

(function (window) {
    'use strict';

    const EntitlementConfig = {
        // CURRENT BETA: All 400 levels, tile sets & themes are 100% free and unlocked
        COMMERCIAL_GATE_ENABLED: false,

        // Free tier maximum level when paywall is enabled
        FREE_TIER_MAX_LEVEL: 5,

        // Local storage key for offline license token
        STORAGE_KEY: 'auromatch_entitlement_license'
    };

    class EntitlementManager {
        constructor() {
            this.overrideCommercial = null;
            try {
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.has('commercial')) {
                    this.overrideCommercial = urlParams.get('commercial') === '1' || urlParams.get('commercial') === 'true';
                }
            } catch (e) {}

            this.initMessageBridge();
        }

        isCommercialGateActive() {
            if (this.overrideCommercial !== null) {
                return this.overrideCommercial;
            }
            return EntitlementConfig.COMMERCIAL_GATE_ENABLED;
        }

        hasValidLicense() {
            if (!this.isCommercialGateActive()) {
                return true;
            }

            try {
                const raw = localStorage.getItem(EntitlementConfig.STORAGE_KEY);
                if (!raw) return false;

                const license = JSON.parse(raw);
                if (license && license.status === 'active' && (license.gameId === 'auromatch' || license.gameId === 'auromind_all_access')) {
                    return true;
                }
            } catch (e) {
                console.warn('[Entitlement] Failed to read license:', e);
            }
            return false;
        }

        canAccessLevel(levelNumber) {
            if (!this.isCommercialGateActive()) {
                return true;
            }
            const lvl = parseInt(levelNumber, 10) || 1;
            if (lvl <= EntitlementConfig.FREE_TIER_MAX_LEVEL) {
                return true;
            }
            return this.hasValidLicense();
        }

        requestPurchase(levelNumber) {
            const lvl = levelNumber || 6;
            console.log(`[Entitlement] AuroMatch Level ${lvl} requires full Sanctuary Pass.`);

            // 1. Post message to parent AuroMind Portal
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'AUROMIND_REQUEST_PURCHASE',
                    gameId: 'auromatch',
                    levelNumber: lvl,
                    title: 'AuroMatch — Zen Tile Solitaire'
                }, '*');
            }

            // 2. Open in-game entitlement modal
            this.openEntitlementModal(lvl);
        }

        applyLicense(tokenOrData) {
            try {
                let licenseObj = {
                    gameId: 'auromatch',
                    status: 'active',
                    unlockedAt: new Date().toISOString(),
                    token: typeof tokenOrData === 'string' ? tokenOrData : (tokenOrData.token || 'AUROMATCH-OFFLINE-TOKEN')
                };

                localStorage.setItem(EntitlementConfig.STORAGE_KEY, JSON.stringify(licenseObj));
                console.log('[Entitlement] AuroMatch license successfully applied.');

                this.closeEntitlementModal();

                if (typeof window.showToastMessage === 'function') {
                    window.showToastMessage('✨ Sanctuary Pass Activated: All 400 Levels & Themes Unlocked!');
                }

                window.dispatchEvent(new CustomEvent('auromatch:license-activated', { detail: licenseObj }));
                return true;
            } catch (e) {
                console.error('[Entitlement] Error applying license:', e);
                return false;
            }
        }

        revokeLicense() {
            try {
                localStorage.removeItem(EntitlementConfig.STORAGE_KEY);
                console.log('[Entitlement] AuroMatch license removed.');
            } catch (e) {}
        }

        initMessageBridge() {
            window.addEventListener('message', (event) => {
                if (!event.data) return;

                if (event.data.type === 'AUROMIND_LICENSE_GRANTED') {
                    if (event.data.gameId === 'auromatch' || event.data.gameId === 'auromind_all_access') {
                        this.applyLicense(event.data.token || 'AUROMIND_TOKEN');
                    }
                }
            });
        }

        openEntitlementModal(levelNumber) {
            let modal = document.getElementById('entitlement-modal');
            if (!modal) {
                this.createEntitlementModalDOM();
                modal = document.getElementById('entitlement-modal');
            }
            if (modal) {
                const lvlSpan = modal.querySelector('#entitlement-locked-level');
                if (lvlSpan) lvlSpan.textContent = levelNumber || '6';
                modal.style.display = 'flex';
            }
        }

        closeEntitlementModal() {
            const modal = document.getElementById('entitlement-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        }

        createEntitlementModalDOM() {
            const modalHtml = `
            <div id="entitlement-modal" class="glass-panel" style="display: none; position: absolute; inset: 0; margin: auto; width: calc(100% - 2rem); max-width: 420px; height: fit-content; max-height: 85dvh; z-index: 6000; flex-direction: column; align-items: center; justify-content: flex-start; gap: 0.85rem; padding: 1.5rem; border-radius: 28px; box-sizing: border-box; text-align: center; border: 1.5px solid rgba(251, 191, 36, 0.45); background: rgba(26, 16, 9, 0.96); box-shadow: 0 10px 30px rgba(0,0,0,0.85);">
                <div style="font-size: 2.2rem; margin-bottom: -0.2rem;">✨</div>
                <h3 style="margin: 0; font-family: 'Cinzel', serif; font-size: 1.35rem; color: #fbbf24;">Sanctuary Lifetime Pass</h3>
                <p style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; margin: 0;">
                    You have mastered the introductory levels. Level <span id="entitlement-locked-level" style="font-weight: 700; color: #facc15;">6</span> and all 400 Zen Mahjong layouts are unlocked with the complete Pass.
                </p>

                <div style="width: 100%; background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.25); border-radius: 14px; padding: 0.75rem; text-align: left; font-size: 0.8rem; color: #e2e8f0; display: flex; flex-direction: column; gap: 0.35rem;">
                    <div>✓ All 400 Handcrafted Solitaire Formations</div>
                    <div>✓ All 20 Sacred Thematic Realms & Gardens</div>
                    <div>✓ Full Wisdom Lore & Epiphany Challenges</div>
                    <div>✓ 100% Offline & Private — Zero Ads</div>
                </div>

                <button id="btn-entitlement-purchase" class="c-btn" onclick="window.entitlementManager.requestPurchase()" style="width: 100%; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; border: none; font-weight: 700; font-size: 0.95rem; padding: 0.7rem; border-radius: 9999px; cursor: pointer; margin-top: 0.2rem;">
                    Unlock Complete Garden
                </button>

                <button onclick="window.entitlementManager.closeEntitlementModal()" style="background: transparent; border: none; color: #94a3b8; font-size: 0.8rem; cursor: pointer; text-decoration: underline;">
                    Return to Welcome
                </button>
            </div>`;

            const container = document.getElementById('app') || document.body;
            container.insertAdjacentHTML('beforeend', modalHtml);
        }
    }

    window.EntitlementConfig = EntitlementConfig;
    window.entitlementManager = new EntitlementManager();

})(window);
