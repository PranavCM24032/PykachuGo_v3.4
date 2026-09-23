// ==============================
// UTILITY FUNCTIONS
// ==============================
function escapeHTML(value) {
    const element = document.createElement('div');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
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
            <span class="text-[8px] leading-tight break-words">${message}</span>
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

function showConfirmDialog(opts) {
    const screen = document.querySelector('.crt-screen');
    if (!screen) return Promise.resolve(false);

    opts = opts || {};

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'absolute inset-0 z-[90] glass-panel flex flex-col items-center justify-center p-4 confirm-dialog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const primaryBtn = opts.primaryClass || 'bg-yellow-600 text-black hover:bg-yellow-700';

        overlay.innerHTML = `
            <div class="bg-gray-900/90 border-2 ${opts.accentClass || 'border-yellow-600/50'} rounded-xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm text-center">
                <span class="material-symbols-rounded ${opts.iconClass || 'text-yellow-500'} text-3xl sm:text-4xl">${opts.icon || 'lightbulb'}</span>
                <h3 class="font-pixel ${opts.titleClass || 'text-yellow-500'} text-sm sm:text-base my-3">${escapeHTML(opts.title || 'Confirm')}</h3>
                <p class="text-gray-400 text-xs sm:text-sm mb-4 leading-relaxed">${opts.message || ''}</p>
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

        function close(result) {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
            resolve(result);
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

        screen.appendChild(overlay);
    });
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
