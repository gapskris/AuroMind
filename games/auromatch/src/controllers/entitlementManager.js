/**
 * AuroMatch - Zen Tile Solitaire
 * Entitlement & Commercial Licensing Manager (ENT-001)
 *
 * Architecture:
 * - Free Beta / Unrestricted Mode by default (COMMERCIAL_GATE_ENABLED: false)
 * - Future-proof: When commercialization is approved, verified server-side
 *   entitlements will govern optional passes; client-side localStorage passes
 *   and unverified postMessage unlock tokens are disabled.
 */

(function (window) {
    'use strict';

    const EntitlementConfig = {
        // CURRENT BETA: All 520 levels, tile sets & themes are 100% free and unlocked
        COMMERCIAL_GATE_ENABLED: false,

        // Free tier maximum level when paywall is enabled
        FREE_TIER_MAX_LEVEL: 5,

        // Local storage key reference (legacy reads disabled in beta)
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
            // Client-side localStorage pass reads are disabled until server-verified entitlements exist.
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

        isPackUnlocked() {
            return !this.isCommercialGateActive() || this.hasValidLicense();
        }

        requestPurchase(levelNumber) {
            const lvl = levelNumber || 6;

            // 1. Notify same-origin parent AuroMind Portal if embedded
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'AUROMIND_REQUEST_PURCHASE',
                    gameId: 'auromatch',
                    levelNumber: lvl,
                    title: 'AuroMatch — Zen Tile Solitaire'
                }, window.location.origin);
            }

            // 2. Open informational in-game beta/planned-pass modal
            this.openEntitlementModal(lvl);
        }

        applyLicense() {
            // Disabled: client-side token activation is not permitted.
            this.closeEntitlementModal();
            return false;
        }

        revokeLicense() {
            try {
                localStorage.removeItem(EntitlementConfig.STORAGE_KEY);
            } catch (e) {}
        }

        initMessageBridge() {
            // Disabled AUROMIND_LICENSE_GRANTED client-side postMessage unlock listener.
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
                <h3 style="margin: 0; font-family: 'Cinzel', serif; font-size: 1.35rem; color: #fbbf24;">Sanctuary Lifetime Pass (Planned)</h3>
                <p style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; margin: 0;">
                    All levels and sacred themes are currently unlocked for beta play (including Level <span id="entitlement-locked-level" style="font-weight: 700; color: #facc15;">6</span>). Online checkout for the planned one-time Sanctuary Lifetime Pass is not yet enabled.
                </p>

                <div style="width: 100%; background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.25); border-radius: 14px; padding: 0.75rem; text-align: left; font-size: 0.8rem; color: #e2e8f0; display: flex; flex-direction: column; gap: 0.35rem;">
                    <div>✓ All 520 Handcrafted Solitaire Formations</div>
                    <div>✓ All 20 Sacred Thematic Realms &amp; Gardens</div>
                    <div>✓ Full Wisdom Lore &amp; Epiphany Challenges</div>
                    <div>✓ 100% Offline-Ready — Zero Advertisements</div>
                </div>

                <button id="btn-entitlement-continue" class="c-btn" onclick="window.entitlementManager.closeEntitlementModal()" style="width: 100%; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; border: none; font-weight: 700; font-size: 0.95rem; padding: 0.7rem; border-radius: 9999px; cursor: pointer; margin-top: 0.2rem;">
                    Continue Beta Sanctuary Play
                </button>
            </div>`;

            const container = document.getElementById('app') || document.body;
            container.insertAdjacentHTML('beforeend', modalHtml);
        }
    }

    window.EntitlementConfig = EntitlementConfig;
    window.entitlementManager = new EntitlementManager();

})(window);
