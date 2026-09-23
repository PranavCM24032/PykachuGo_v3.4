(function () {
    'use strict';

    const enhanced = new Map();

    function normalizeText(str) {
        return (str || '').replace(/\s+/g, ' ').trim();
    }

    function makeIcon(img) {
        if (!img) return null;
        const clone = img.cloneNode(true);
        clone.removeAttribute('class');
        clone.style.width = '1em';
        clone.style.height = '1em';
        clone.style.minWidth = '1em';
        clone.style.objectFit = 'contain';
        clone.style.display = 'inline-block';
        clone.style.pointerEvents = 'none';
        clone.style.userSelect = 'none';
        return clone;
    }

    function optionContent(opt) {
        const img = opt.querySelector('img');
        return {
            img: makeIcon(img),
            text: normalizeText(opt.textContent)
        };
    }

    function selectedContent(select) {
        const opts = select.selectedOptions;
        return opts && opts.length ? optionContent(opts[0]) : { img: null, text: '' };
    }

    function build(select) {
        if (!select || select.dataset.customSelectBuilt) return;
        select.dataset.customSelectBuilt = '1';

        const container = select.parentElement;
        const oldIcon = container.querySelector('.material-symbols-rounded');
        if (oldIcon) oldIcon.style.display = 'none';
        select.style.display = 'none';

        const wrap = document.createElement('div');
        wrap.className = 'relative w-full custom-select';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full bg-black/40 border border-slate-800 rounded-lg pl-2 pr-2 sm:pl-3 sm:pr-3 py-1.5 sm:py-2 text-white text-left flex items-center justify-between gap-2 hover:border-blue-500/50 focus:border-blue-500 focus:outline-none transition-all cursor-pointer text-[11px] sm:text-xs';

        const btnLabel = document.createElement('span');
        btnLabel.className = 'flex items-center gap-1.5 sm:gap-2 min-w-0';
        const btnText = document.createElement('span');
        btnText.className = 'truncate';
        btnLabel.appendChild(btnText);

        const chevron = document.createElement('span');
        chevron.className = 'material-symbols-rounded text-gray-500 text-sm sm:text-base shrink-0 pointer-events-none';
        chevron.textContent = 'expand_more';

        btn.appendChild(btnLabel);
        btn.appendChild(chevron);
        wrap.appendChild(btn);

        const menu = document.createElement('div');
        menu.className = 'hidden z-50 w-full overflow-y-auto bg-[#0a0f1d] border border-slate-800 rounded-lg shadow-2xl custom-select-menu';
        document.body.appendChild(menu);

        container.appendChild(wrap);
        container.classList.add('custom-select-host');

        // Build options, preserving optgroup grouping
        let groupLabel = null;
        Array.from(select.children).forEach((groupOrOpt) => {
            const group = groupOrOpt.tagName === 'OPTGROUP' ? groupOrOpt : null;

            if (group) {
                const label = document.createElement('div');
                label.className = 'px-2 sm:px-3 pt-1.5 pb-0.5 text-[9px] sm:text-[10px] uppercase tracking-widest font-bold pointer-events-none select-none';
                if ((group.label || '').toUpperCase().includes('LEVEL 2')) {
                    label.classList.add('text-yellow-500');
                } else if ((group.label || '').toUpperCase().includes('LEVEL 3')) {
                    label.classList.add('text-red-500');
                } else {
                    label.classList.add('text-blue-400');
                }
                const groupLabelText = normalizeText(group.label);
                if (groupLabelText) {
                    label.textContent = groupLabelText.replace(/:\s*$/, '');
                    menu.appendChild(label);
                }
                groupLabel = label;
                Array.from(group.children).forEach((opt) => menu.appendChild(makeItem(select, opt)));
                return;
            }

            if (groupOrOpt.tagName === 'OPTION') {
                if (groupLabel === null) {
                    groupLabel = document.createElement('div');
                    menu.appendChild(groupLabel);
                }
                menu.appendChild(makeItem(select, groupOrOpt));
            }
        });

        function refresh() {
            const { img, text } = selectedContent(select);
            btnText.textContent = text;
            const existing = btnLabel.querySelector('img');
            if (existing) existing.remove();
            if (img) {
                btnLabel.insertBefore(img, btnText);
            }
            chevron.textContent = 'expand_more';
        }

        function close() {
            menu.classList.add('hidden');
            chevron.textContent = 'expand_more';
            btn.setAttribute('aria-expanded', 'false');
        }

        function open() {
            const rect = btn.getBoundingClientRect();
            const maxH = 256;

            // Measure real height first (off-screen, hidden visually) so the
            // open direction and max-height are accurate.
            menu.style.position = 'fixed';
            menu.style.left = '-99999px';
            menu.style.top = '0';
            menu.style.bottom = 'auto';
            menu.style.maxHeight = 'none';
            menu.style.visibility = 'hidden';
            menu.classList.remove('hidden');

            const menuRaw = menu.scrollHeight || 256;

            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            const openUp = spaceBelow < Math.min(maxH, menuRaw) + 8;

            const cap = openUp
                ? Math.max(96, Math.min(maxH, spaceAbove - 8))
                : Math.max(96, Math.min(maxH, spaceBelow - 8));

            menu.style.width = rect.width + 'px';
            menu.style.left = rect.left + 'px';
            menu.style.visibility = '';
            menu.style.zIndex = '99999';
            if (openUp) {
                menu.style.top = 'auto';
                menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
            } else {
                menu.style.top = (rect.bottom + 6) + 'px';
                menu.style.bottom = 'auto';
            }
            menu.style.maxHeight = cap + 'px';
            menu.classList.remove('hidden');
            chevron.textContent = 'expand_less';
            btn.setAttribute('aria-expanded', 'true');
        }

        function toggle() {
            if (menu.classList.contains('hidden')) {
                open();
            } else {
                close();
            }
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
            if (typeof playSound === 'function') playSound('click');
        });

        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                close();
                btn.focus();
            }
        });

        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target) && !menu.contains(e.target)) close();
        });

        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);

        select.addEventListener('change', () => {
            refresh();
            if (typeof playSound === 'function') playSound('click');
        });

        Object.defineProperty(wrap, 'refresh', { value: refresh, writable: true });
        enhanced.set(select, { wrap, refresh });

        refresh();
    }

    function makeItem(select, opt) {
        const { img, text } = optionContent(opt);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'w-full text-left px-2 sm:px-3 py-1.5 sm:py-2 text-gray-300 hover:bg-blue-500/10 hover:text-white flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer text-[11px] sm:text-xs';
        if (img) item.appendChild(img);
        const span = document.createElement('span');
        span.className = 'truncate';
        span.textContent = text;
        item.appendChild(span);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closeAll();
        });
        return item;
    }

    function closeAll() {
        document.querySelectorAll('.custom-select-menu').forEach((m) => m.classList.add('hidden'));
        document.querySelectorAll('.custom-select button').forEach((b) => {
            const chevron = b.querySelector('.material-symbols-rounded');
            if (chevron) chevron.textContent = 'expand_more';
            b.setAttribute('aria-expanded', 'false');
        });
    }

    window.enhanceSelect = function (id) {
        const sel = document.getElementById(id);
        if (sel) build(sel);
        return sel;
    };

window.refreshSelectDisplay = function (el, attempts) {
        attempts = attempts || 0;
        const entry = enhanced.get(el);
        if (entry) {
            entry.refresh();
        } else if (attempts < 10) {
            setTimeout(function () { window.refreshSelectDisplay(el, attempts + 1); }, 50);
        }
    };

    function init() {
        ['codeLanguage', 'missionLevel', 'typeFilter'].forEach(enhanceSelect);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();