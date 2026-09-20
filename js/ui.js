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
