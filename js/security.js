/**
 * 🛡️ EXTREME SECURITY SYSTEM (v3.0) - "BLACKOUT EDITION"
 * 
 * This is the ultimate defense for mobile browsers.
 * Instead of blurring small areas, we now blackout the ENTIRE Pokédex
 * the instant focus is lost or a multi-touch capture gesture is detected.
 */

const SecuritySystem = {
    config: {
        // We now target the entire CRT screen for 100% coverage
        mainContainer: '.crt-screen',
        stealthClass: 'security-blackout-active',
        overlayMessage: 'ENCRYPTION LOCK: SIGNAL LOST'
    },

    init() {
        console.log("🛡️ [Security] Extreme Blackout Mode Active");
        this.createGlobalOverlay();
        this.bindHardenedEvents();
    },

    createGlobalOverlay() {
        const screen = document.querySelector(this.config.mainContainer);
        if (!screen) return;

        // Create the full-screen blackout barrier
        const overlay = document.createElement('div');
        overlay.id = 'extreme-security-barrier';
        overlay.innerHTML = `
            <div class="security-lock-box">
                <span class="material-symbols-rounded">lock</span>
                <p class="lock-text">${this.config.overlayMessage}</p>
                <div class="lock-scanline"></div>
            </div>
        `;
        screen.appendChild(overlay);
    },

    activateLockdown() {
        const screen = document.querySelector(this.config.mainContainer);
        document.body.classList.add(this.config.stealthClass);
        if (screen) {
            screen.classList.add(this.config.stealthClass);
            // Block all input
            screen.style.pointerEvents = 'none';
            if (window.bgMusic) window.bgMusic.pause();
        }
    },

    releaseLockdown() {
        const screen = document.querySelector(this.config.mainContainer);
        document.body.classList.remove(this.config.stealthClass);
        if (screen) {
            // Check if we are actually allowed to release (not still hidden)
            if (document.hidden) return;
            screen.classList.remove(this.config.stealthClass);
            screen.style.pointerEvents = 'all';
        }
    },

    releaseTimer: null,

    cancelRelease() {
        if (this.releaseTimer) {
            clearTimeout(this.releaseTimer);
            this.releaseTimer = null;
        }
    },

    scheduleRelease(delay) {
        this.cancelRelease();
        this.releaseTimer = setTimeout(() => this.releaseLockdown(), delay);
    },

    bindHardenedEvents() {
        // 1. VISIBILITY (Tab switch / Home button)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.activateLockdown();
            else {
                this.scheduleRelease(300);
            }
        });

        // 2. WINDOW BLUR (Swipe down notifications / Control Center)
        window.addEventListener('blur', () => this.activateLockdown());
        window.addEventListener('focus', () => {
            this.scheduleRelease(300);
        });

        // 3. iOS SPECIFIC (Safari Multitasking)
        window.addEventListener('pagehide', () => this.activateLockdown());

        // 4. MULTI-TOUCH GESTURE PROTECTION
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length >= 5) {
                console.warn("🛡️ [Security] 5-Finger Gesture Detected");
                this.activateLockdown();
                this.scheduleRelease(2000);
            }
        }, { passive: true });

        // 5. HARDWARE PRINT SCREEN / RECORDING SHORTCUTS
        document.addEventListener('keydown', (e) => {
            const forbiddenMatch =
                e.key === 'PrintScreen' ||
                (e.ctrlKey && (e.key === 'p' || e.key === 's' || e.key === 'u')) ||
                (e.metaKey && e.shiftKey && (e.key === '4' || e.key === '3'));

            if (forbiddenMatch) {
                this.activateLockdown();
                this.scheduleRelease(2000);
            }
        });

        // 7. PREVENT CONTEXT / DRAG
        document.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('dragstart', e => e.preventDefault());
    }
};

// Auto-init
SecuritySystem.init();
