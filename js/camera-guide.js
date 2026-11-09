// ==============================
// CAMERA ACCESS GUIDANCE (in-Pokédex overlay)
// ==============================
// Shown when the QR scanner cannot use the camera (in-app browser, denied
// permission, missing camera API). Lives inside the #screen shell so the
// guidance appears as a popup over the Pokédex instead of a separate page.

const IN_APP_BROWSERS = [
    { test: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i, name: 'Facebook' },
    { test: /Instagram/i, name: 'Instagram' },
    { test: /Messenger/i, name: 'Messenger' },
    { test: /Line\//i, name: 'LINE' },
    { test: /WhatsApp/i, name: 'WhatsApp' },
    { test: /Twitter|TwitterAndroid/i, name: 'X (Twitter)' },
    { test: /LinkedInApp/i, name: 'LinkedIn' },
    { test: /Snapchat/i, name: 'Snapchat' },
    { test: /Pinterest/i, name: 'Pinterest' },
    { test: /musical_ly|BytedanceWebview|TikTok/i, name: 'TikTok' },
    { test: /MicroMessenger/i, name: 'WeChat' },
    { test: /GSA\//i, name: 'Google App' },
    { test: /KAKAOTALK/i, name: 'KakaoTalk' },
    { test: /Telegram/i, name: 'Telegram' },
    { test: /NAVER/i, name: 'Naver' },
    { test: /WebView/i, name: 'an in-app browser' }
];

function detectInAppBrowser() {
    const ua = navigator.userAgent || '';
    for (const browser of IN_APP_BROWSERS) {
        if (browser.test.test(ua)) return browser.name;
    }
    // Android WebView (no version token) is usually an in-app browser.
    if (/wv\)/.test(ua) && /Android/i.test(ua)) return 'an in-app browser';
    return null;
}

function isIOSDevice() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS 13+ reports as Macintosh but has touch support.
    return /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
}

function openCameraGuide(reason) {
    const overlay = document.getElementById('cameraGuideOverlay');
    if (!overlay) {
        // Partial missing: never strand the trainer without a path forward.
        if (typeof showToast === 'function') showToast('Camera unavailable. Use manual entry.', 'info');
        if (typeof showManualEntry === 'function') showManualEntry();
        return;
    }

    const inApp = detectInAppBrowser();
    const useInApp = !!inApp || reason === 'inapp';
    const card = document.getElementById('cameraGuideCard');
    const inappPanel = document.getElementById('cameraGuideInappPanel');
    const permissionPanel = document.getElementById('cameraGuidePermissionPanel');

    if (useInApp) {
        const name = inApp || 'an in-app browser';
        const nameEl = document.getElementById('cameraGuideInappName');
        const nameTextEl = document.getElementById('cameraGuideInappNameText');
        const statusEl = document.getElementById('cameraGuideInappStatus');
        const menuHintEl = document.getElementById('cameraGuideMenuHint');
        const openHintEl = document.getElementById('cameraGuideOpenHint');

        if (nameEl) nameEl.textContent = name;
        if (nameTextEl) nameTextEl.textContent = name;
        if (statusEl) statusEl.textContent = `${name} detected`;
        if (menuHintEl) menuHintEl.textContent = isIOSDevice() ? '••• (3 dots)' : '⋮ (3 dots)';
        if (openHintEl) openHintEl.textContent = isIOSDevice() ? 'Open in Safari' : 'Open in Chrome';

        if (inappPanel) inappPanel.classList.remove('hidden');
        if (permissionPanel) permissionPanel.classList.add('hidden');
        if (card) card.classList.remove('is-permission');
    } else {
        if (inappPanel) inappPanel.classList.add('hidden');
        if (permissionPanel) permissionPanel.classList.remove('hidden');
        if (card) card.classList.add('is-permission');
        switchGuideTab(isIOSDevice() ? 'ios' : 'android');
    }

    overlay.classList.remove('hidden');
    if (typeof playSound === 'function') playSound('click');
}

function closeCameraGuide() {
    const overlay = document.getElementById('cameraGuideOverlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    overlay.classList.add('hidden');
    if (typeof playSound === 'function') playSound('click');
}

function switchGuideTab(platform) {
    const isIOS = platform === 'ios';
    const androidTab = document.getElementById('cameraGuideTabAndroid');
    const iosTab = document.getElementById('cameraGuideTabIOS');
    const androidContent = document.getElementById('cameraGuideContentAndroid');
    const iosContent = document.getElementById('cameraGuideContentIOS');

    if (androidTab) androidTab.classList.toggle('is-active', !isIOS);
    if (iosTab) iosTab.classList.toggle('is-active', isIOS);
    if (androidContent) androidContent.classList.toggle('hidden', isIOS);
    if (iosContent) iosContent.classList.toggle('hidden', !isIOS);
}

async function copyGameUrl() {
    const url = window.location.href.split('#')[0];
    let copied = false;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(url);
            copied = true;
        }
    } catch (e) {
        copied = false;
    }

    if (!copied) {
        try {
            const field = document.createElement('textarea');
            field.value = url;
            field.setAttribute('readonly', '');
            field.style.position = 'fixed';
            field.style.opacity = '0';
            document.body.appendChild(field);
            field.select();
            field.setSelectionRange(0, field.value.length);
            copied = document.execCommand('copy');
            field.remove();
        } catch (e) {
            copied = false;
        }
    }

    const button = document.getElementById('cameraGuideCopyBtn');
    if (copied) {
        if (button) {
            const original = button.innerHTML;
            button.innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Link copied';
            setTimeout(() => { button.innerHTML = original; }, 2000);
        }
        if (typeof showToast === 'function') showToast('Game link copied', 'success');
    } else if (typeof showToast === 'function') {
        showToast('Copy failed — copy the address bar link manually', 'error');
    }
}

function reloadPage() {
    window.location.reload();
}

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const overlay = document.getElementById('cameraGuideOverlay');
    if (overlay && !overlay.classList.contains('hidden')) {
        closeCameraGuide();
    }
});
