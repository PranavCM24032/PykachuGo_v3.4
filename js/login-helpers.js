(function () {
    const LOGIN_STORAGE_KEY = 'pykachuLogin';
    const LEGACY_LOGIN_STORAGE_KEY = 'pykachuTeam';
    const globalScope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});

    function normalizeLoginState(raw = {}) {
        const name = (raw.name || '').toString().trim();
        const securityKey = (raw.securityKey || '').toString().trim();
        const missionLevel = (raw.missionLevel || '').toString().trim();
        const language = (raw.language || 'PYTHON').toString().trim();

        if (!name && !securityKey && !missionLevel && !language) {
            return null;
        }

        return {
            name,
            securityKey,
            missionLevel,
            language
        };
    }

    function readStoredLoginState(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        if (!storage) return null;

        try {
            const direct = storage.getItem(LOGIN_STORAGE_KEY);
            if (direct) {
                const parsed = JSON.parse(direct);
                const normalized = normalizeLoginState(parsed);
                if (normalized) return normalized;
            }
        } catch (e) {
            console.warn('Login state parse failed:', e);
        }

        try {
            const legacy = storage.getItem(LEGACY_LOGIN_STORAGE_KEY);
            if (!legacy) return null;
            const parsed = JSON.parse(legacy);
            const normalized = normalizeLoginState(parsed);
            if (normalized) return normalized;
        } catch (e) {
            console.warn('Legacy login state parse failed:', e);
        }

        return null;
    }

    function saveLoginState(loginState, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        if (!storage) return null;
        const normalized = normalizeLoginState(loginState);
        if (!normalized) return null;

        storage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(normalized));
        storage.setItem(LEGACY_LOGIN_STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    function applyStoredLoginState(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        const saved = readStoredLoginState(storage);
        if (!saved) return null;

        const teamNameInput = typeof document !== 'undefined' ? document.getElementById('teamName') : null;
        if (teamNameInput && !teamNameInput.value) {
            teamNameInput.value = saved.name || '';
        }

        const securityKeyInput = typeof document !== 'undefined' ? document.getElementById('teamSecurityKey') : null;
        if (securityKeyInput && !securityKeyInput.value) {
            securityKeyInput.value = saved.securityKey || '';
        }

        const codeLanguage = typeof document !== 'undefined' ? document.getElementById('codeLanguage') : null;
        if (codeLanguage && saved.language) {
            codeLanguage.value = saved.language;
        }

        const missionLevel = typeof document !== 'undefined' ? document.getElementById('missionLevel') : null;
        if (missionLevel && saved.missionLevel) {
            missionLevel.value = saved.missionLevel;
        }

        return saved;
    }

    globalScope.readStoredLoginState = readStoredLoginState;
    globalScope.saveLoginState = saveLoginState;
    globalScope.applyStoredLoginState = applyStoredLoginState;
})();
