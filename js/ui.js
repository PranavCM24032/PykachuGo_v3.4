// ==============================
// UTILITY FUNCTIONS
// ==============================
function escapeHTML(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const screen = document.querySelector('.crt-screen');
    if (!screen) return;

    // Use specific glass classes for toasts
    const glassClass = type === 'error' ? 'glass-black' :
        type === 'success' ? 'glass-green' : 'glass-blue';

    // absolute positioning, glassmorphism, refined smaller font, and containment width
    toast.className = `absolute top-6 left-1/2 transform -translate-x-1/2 glass-toast ${glassClass} px-3 py-2 rounded-lg border shadow-xl font-pixel text-[8px] text-white z-[9999] transition-all duration-300 pointer-events-none w-[80%] max-w-[200px]`;

    // Use truncate for the message to prevent overflow if it's too long
    toast.innerHTML = `
        <div class="flex items-center gap-2 relative z-10 w-full">
            <span class="material-symbols-rounded text-xs shrink-0">${type === 'error' ? 'warning' : type === 'success' ? 'check_circle' : 'info'}</span>
            <span class="text-[8px] leading-tight break-words">${escapeHTML(message)}</span>
        </div>
    `;

    screen.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.transform = 'translate(-50%, 0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);

    if (type === 'error') playSound('error');
    if (type === 'success') playSound('success');
}

// Handle of the dialog currently on screen. showConfirmDialog is re-entrant
// (the power button fires on every pointerup), and two dialogs used to stack —
// the top one swallowed the OK click and the orphan then covered the next
// screen. A second call while one is open reuses the first.
let activeConfirmDialog = null;

function showConfirmDialog(opts) {
    const screen = document.querySelector('.crt-screen');
    if (!screen) return Promise.resolve(false);

    if (activeConfirmDialog) return activeConfirmDialog.promise;

    opts = opts || {};

    const overlay = document.createElement('div');
    overlay.className = 'absolute inset-0 z-[90] glass-panel flex flex-col items-center justify-center p-4 confirm-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const primaryBtn = opts.primaryClass || 'bg-yellow-600 text-black hover:bg-yellow-700';
    const safeMessage = escapeHTML(opts.message || '').replace(/\n/g, '<br>');

    overlay.innerHTML = `
        <div class="bg-gray-900/90 border-2 ${opts.accentClass || 'border-yellow-600/50'} rounded-xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm text-center">
            <span class="material-symbols-rounded ${opts.iconClass || 'text-yellow-500'} text-3xl sm:text-4xl">${escapeHTML(opts.icon || 'lightbulb')}</span>
            <h3 class="font-pixel ${opts.titleClass || 'text-yellow-500'} text-sm sm:text-base my-3">${escapeHTML(opts.title || 'Confirm')}</h3>
            <p class="text-gray-400 text-xs sm:text-sm mb-4 leading-relaxed">${safeMessage}</p>
            <div class="flex gap-2 sm:gap-3">
                <button type="button" data-act="ok" onclick="playSound('click')"
                    class="${primaryBtn} font-bold flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base transition-colors min-h-[44px]">
                    <span class="flex items-center justify-center gap-2"><span class="material-symbols-rounded text-base">${opts.primaryIcon || 'check_circle'}</span>${escapeHTML(opts.okText || 'PROCEED')}</span>
                </button>
                <button type="button" data-act="cancel" onclick="playSound('click')"
                    class="bg-gray-800 text-white flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base hover:bg-gray-700 transition-colors min-h-[44px]">
                    <span class="flex items-center justify-center gap-2"><span class="material-symbols-rounded text-base">close</span>${escapeHTML(opts.cancelText || 'CANCEL')}</span>
                </button>
            </div>
        </div>
    `;

    let resolveDialog;
    // NOTE: the promise is created *after* the wiring on purpose. A Promise
    // executor runs synchronously, so registering the dialog from inside it
    // touched `promise` while it was still in its TDZ.
    const promise = new Promise((resolve) => { resolveDialog = resolve; });

    function close(result) {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        activeConfirmDialog = null;
        resolveDialog(result);
    }

    function onKey(e) {
        if (e.key === 'Escape') close(false);
    }

    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKey);

    activeConfirmDialog = { overlay, promise };
    screen.appendChild(overlay);

    return promise;
}

function triggerShake(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.remove('animate-shake');
    void el.offsetWidth; // Force reflow to reliably restart the animation
    el.classList.add('animate-shake');
    setTimeout(() => el.classList.remove('animate-shake'), 500);
}

function showFeedback(elementId, message, type) {
    const fb = document.getElementById(elementId);
    fb.textContent = message;

    if (type === 'error') {
        fb.className = 'text-xs p-3 rounded border bg-red-900/30 border-red-700 text-red-200';
    } else if (type === 'success') {
        fb.className = 'text-xs p-3 rounded border bg-green-900/30 border-green-700 text-green-200';
    } else {
        fb.className = 'text-xs p-3 rounded border bg-blue-900/30 border-blue-700 text-blue-200';
    }

    fb.classList.remove('hidden');

    setTimeout(() => {
        fb.classList.add('hidden');
    }, 3000);
}

// ==============================
// IN-APP BROWSER & CAMERA PERMISSION HELPERS
// ==============================

function detectInAppBrowser() {
    const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    let appName = '';
    if (ua.includes('whatsapp')) appName = 'WhatsApp';
    else if (ua.includes('instagram')) appName = 'Instagram';
    else if (ua.includes('fbav') || ua.includes('fban') || ua.includes('messenger')) appName = 'Facebook';
    else if (ua.includes('telegram')) appName = 'Telegram';
    else if (ua.includes('twitter') || ua.includes('x/')) appName = 'X (Twitter)';
    else if (ua.includes('micromessenger')) appName = 'WeChat';
    else if (ua.includes('line/')) appName = 'Line';
    else if (ua.includes('snapchat')) appName = 'Snapchat';
    else if (isAndroid && (ua.includes('; wv') || (ua.includes('version/') && ua.includes('chrome') && !ua.includes('mobile safari')))) {
        appName = 'In-App Browser';
    } else if (isIOS && !ua.includes('safari') && ua.includes('applewebkit')) {
        appName = 'In-App Browser';
    }

    return {
        isInApp: Boolean(appName),
        appName: appName || 'In-App Browser',
        isIOS,
        isAndroid
    };
}

function copyGameUrl() {
    const url = window.location.href.split('#')[0];
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('✓ Link copied! Open in Chrome or Safari', 'success');
        }).catch(() => {
            fallbackCopyUrl(url);
        });
    } else {
        fallbackCopyUrl(url);
    }
}

function fallbackCopyUrl(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        document.execCommand('copy');
        showToast('✓ Link copied! Open in Chrome or Safari', 'success');
    } catch {
        prompt('Copy this link and open in Chrome or Safari:', text);
    }
    ta.remove();
}

function initInAppBrowserNotice() {
    const info = detectInAppBrowser();
    if (!info.isInApp) return;

    if (document.getElementById('inAppBrowserBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'inAppBrowserBanner';
    banner.className = 'w-full bg-gradient-to-r from-amber-950/95 via-yellow-950/95 to-amber-950/95 border-b-2 border-amber-500/50 px-2.5 py-1.5 flex items-center justify-between gap-2 z-[9990] text-amber-200 text-[10px] sm:text-xs shadow-lg shrink-0';
    banner.innerHTML = `
        <div class="flex items-center gap-1.5 min-w-0">
            <span class="material-symbols-rounded text-amber-400 text-sm sm:text-base shrink-0 animate-pulse">open_in_new</span>
            <span class="truncate leading-tight">
                <b>${escapeHTML(info.appName)}</b> detected: camera blocked. Tap <b>⋮ / ⋯</b> & select <b>Open in ${info.isIOS ? 'Safari' : 'Chrome'}</b>
            </span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
            <button type="button" onclick="copyGameUrl()" class="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/40 border border-amber-400/40 rounded text-[9px] uppercase font-bold text-amber-300 transition-colors">
                Copy Link
            </button>
            <button type="button" onclick="document.getElementById('inAppBrowserBanner')?.remove()" class="text-amber-400 hover:text-white p-0.5" title="Dismiss">
                <span class="material-symbols-rounded text-sm sm:text-base">close</span>
            </button>
        </div>
    `;

    const screen = document.getElementById('screen');
    if (screen) {
        screen.insertBefore(banner, screen.firstChild);
    } else {
        document.body.insertBefore(banner, document.body.firstChild);
    }
}

let activeCameraModal = null;

function closeInAppBrowserModal() {
    const modal = document.getElementById('inAppBrowserModal');
    if (modal) modal.remove();
    activeCameraModal = null;
}

function showInAppBrowserModal() {
    const screen = document.querySelector('.crt-screen') || document.body;
    closeInAppBrowserModal();
    closeCameraPermissionGuide();

    const info = detectInAppBrowser();

    const overlay = document.createElement('div');
    overlay.id = 'inAppBrowserModal';
    overlay.className = 'absolute inset-0 z-[140] glass-panel flex flex-col items-center justify-center p-3 sm:p-4 text-center overflow-y-auto';

    overlay.innerHTML = `
        <div class="bg-gray-900/95 border-2 border-amber-500/60 rounded-2xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm shadow-2xl backdrop-blur-md my-auto animate-fade-in">
            <div class="w-12 h-12 mx-auto rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-3">
                <span class="material-symbols-rounded text-amber-400 text-2xl sm:text-3xl">no_photography</span>
            </div>
            <h3 class="font-pixel text-amber-400 text-xs sm:text-sm mb-2 uppercase tracking-wider">
                CAMERA BLOCKED BY ${escapeHTML(info.appName.toUpperCase())}
            </h3>
            <p class="text-gray-300 text-[11px] sm:text-xs mb-3 leading-relaxed">
                ${escapeHTML(info.appName)}'s in-app browser does not support camera scanning. Please switch to a real browser:
            </p>

            <div class="bg-black/60 border border-amber-500/30 rounded-xl p-2.5 mb-3 text-left space-y-1.5 text-[10px] sm:text-[11px] text-gray-200 font-mono">
                <div class="flex items-start gap-2">
                    <span class="text-amber-400 font-bold">1.</span>
                    <span>Tap the <b class="text-white">${info.isIOS ? '⋯ or Share' : '⋮ (3 dots)'}</b> icon in the corner.</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="text-amber-400 font-bold">2.</span>
                    <span>Select <b class="text-amber-300">Open in ${info.isIOS ? 'Safari' : 'Chrome'}</b>.</span>
                </div>
            </div>

            <div class="space-y-2">
                <button type="button" onclick="copyGameUrl()" class="btn-pokedex w-full flex items-center justify-center gap-2 py-2.5 text-xs sm:text-sm">
                    <span class="material-symbols-rounded text-sm sm:text-base">content_copy</span>
                    COPY GAME LINK
                </button>
                <button type="button" onclick="closeInAppBrowserModal(); showManualEntry();" class="w-full py-2.5 text-[10px] sm:text-xs text-blue-400 hover:text-white border border-blue-400/40 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 transition-all uppercase font-mono font-bold flex items-center justify-center gap-1.5">
                    <span class="material-symbols-rounded text-sm">keyboard</span>
                    TYPE SIGNAL ID (NO CAMERA)
                </button>
                <button type="button" onclick="closeInAppBrowserModal()" class="w-full py-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors uppercase font-mono">
                    Close
                </button>
            </div>
        </div>
    `;

    screen.appendChild(overlay);
    activeCameraModal = overlay;
    playSound('error');
}

function closeCameraPermissionGuide() {
    const modal = document.getElementById('cameraPermissionGuideModal');
    if (modal) modal.remove();
    activeCameraModal = null;
}

function switchGuideTab(platform) {
    const tabAndroid = document.getElementById('guideTabAndroid');
    const tabIOS = document.getElementById('guideTabIOS');
    const contentAndroid = document.getElementById('guideContentAndroid');
    const contentIOS = document.getElementById('guideContentIOS');

    if (!tabAndroid || !tabIOS || !contentAndroid || !contentIOS) return;

    if (platform === 'ios') {
        tabIOS.className = 'flex-1 py-1.5 rounded-md bg-blue-600 text-white font-bold shadow text-[10px] transition-all';
        tabAndroid.className = 'flex-1 py-1.5 rounded-md text-gray-400 hover:text-white font-bold text-[10px] transition-all';
        contentIOS.classList.remove('hidden');
        contentAndroid.classList.add('hidden');
    } else {
        tabAndroid.className = 'flex-1 py-1.5 rounded-md bg-blue-600 text-white font-bold shadow text-[10px] transition-all';
        tabIOS.className = 'flex-1 py-1.5 rounded-md text-gray-400 hover:text-white font-bold text-[10px] transition-all';
        contentAndroid.classList.remove('hidden');
        contentIOS.classList.add('hidden');
    }
}

function showCameraPermissionGuide(error) {
    const screen = document.querySelector('.crt-screen') || document.body;
    closeCameraPermissionGuide();
    closeInAppBrowserModal();

    const info = detectInAppBrowser();
    const isIOS = info.isIOS;

    const overlay = document.createElement('div');
    overlay.id = 'cameraPermissionGuideModal';
    overlay.className = 'absolute inset-0 z-[140] glass-panel flex flex-col items-center justify-center p-3 sm:p-4 text-center overflow-y-auto';

    overlay.innerHTML = `
        <div class="bg-gray-900/95 border-2 border-red-500/50 rounded-2xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm shadow-2xl backdrop-blur-md my-auto animate-fade-in">
            <div class="w-12 h-12 mx-auto rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-2.5">
                <span class="material-symbols-rounded text-red-400 text-2xl sm:text-3xl">videocam_off</span>
            </div>
            <h3 class="font-pixel text-red-400 text-xs sm:text-sm mb-1 uppercase tracking-wider">
                CAMERA ACCESS BLOCKED
            </h3>
            <p class="text-gray-400 text-[10px] sm:text-xs mb-3">
                Permission was denied by your browser. Follow these steps to allow:
            </p>

            <!-- Platform Switch Tabs -->
            <div class="flex rounded-lg bg-black/60 p-1 mb-3 border border-slate-800 text-[10px]">
                <button type="button" id="guideTabAndroid" onclick="switchGuideTab('android')"
                    class="flex-1 py-1.5 rounded-md ${isIOS ? 'text-gray-400' : 'bg-blue-600 text-white font-bold shadow'} text-[10px] transition-all">
                    ANDROID (CHROME)
                </button>
                <button type="button" id="guideTabIOS" onclick="switchGuideTab('ios')"
                    class="flex-1 py-1.5 rounded-md ${isIOS ? 'bg-blue-600 text-white font-bold shadow' : 'text-gray-400'} text-[10px] transition-all">
                    IPHONE (SAFARI)
                </button>
            </div>

            <!-- Android Guide -->
            <div id="guideContentAndroid" class="${isIOS ? 'hidden' : ''} text-left bg-black/50 border border-slate-800 rounded-xl p-2.5 mb-3 text-[10px] sm:text-[11px] text-gray-300 font-mono space-y-1.5">
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">1.</span>
                    <span>Tap the <b class="text-white">🔒 Lock</b> or <b class="text-white">tune (settings)</b> icon beside the URL in the address bar.</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">2.</span>
                    <span>Tap <b class="text-white">Permissions</b> (or Site Settings).</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">3.</span>
                    <span>Toggle <b class="text-emerald-400">Camera</b> to <b class="text-emerald-400">ALLOW</b>.</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">4.</span>
                    <span>Tap <b class="text-yellow-300">Reload</b> to scan!</span>
                </div>
            </div>

            <!-- iOS Guide -->
            <div id="guideContentIOS" class="${isIOS ? '' : 'hidden'} text-left bg-black/50 border border-slate-800 rounded-xl p-2.5 mb-3 text-[10px] sm:text-[11px] text-gray-300 font-mono space-y-1.5">
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">1.</span>
                    <span>Tap <b class="text-white">aA</b> on the left of Safari's address bar.</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">2.</span>
                    <span>Tap <b class="text-white">Website Settings</b>.</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">3.</span>
                    <span>Set <b class="text-emerald-400">Camera</b> to <b class="text-emerald-400">Allow</b>.</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="text-blue-400 font-bold">4.</span>
                    <span>Tap <b class="text-yellow-300">Reload</b> to start scanning!</span>
                </div>
            </div>

            <div class="space-y-2">
                <button type="button" onclick="location.reload()" class="btn-pokedex w-full flex items-center justify-center gap-2 py-2.5 text-xs sm:text-sm">
                    <span class="material-symbols-rounded text-sm sm:text-base">refresh</span>
                    RELOAD PAGE
                </button>
                <button type="button" onclick="closeCameraPermissionGuide(); showManualEntry();" class="w-full py-2.5 text-[10px] sm:text-xs text-yellow-400 hover:text-white border border-yellow-500/40 rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 transition-all uppercase font-mono font-bold flex items-center justify-center gap-1.5">
                    <span class="material-symbols-rounded text-sm">keyboard</span>
                    SKIP CAMERA: TYPE SIGNAL ID
                </button>
                <button type="button" onclick="closeCameraPermissionGuide()" class="w-full py-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors uppercase font-mono">
                    Close
                </button>
            </div>
        </div>
    `;

    screen.appendChild(overlay);
    activeCameraModal = overlay;
    playSound('error');
}

// Global exposures
window.detectInAppBrowser = detectInAppBrowser;
window.copyGameUrl = copyGameUrl;
window.initInAppBrowserNotice = initInAppBrowserNotice;
window.showInAppBrowserModal = showInAppBrowserModal;
window.closeInAppBrowserModal = closeInAppBrowserModal;
window.showCameraPermissionGuide = showCameraPermissionGuide;
window.closeCameraPermissionGuide = closeCameraPermissionGuide;
window.switchGuideTab = switchGuideTab;

