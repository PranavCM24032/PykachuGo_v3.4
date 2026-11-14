// ==============================
// GAME CONFIGURATION
// ==============================
const RUNTIME_CONFIG = window.PYKACHU_RUNTIME_CONFIG || {};

const GOOGLE_SCRIPT_URL = (RUNTIME_CONFIG.googleScriptUrl || '').trim();
const GOOGLE_SCRIPT_TOKEN = (RUNTIME_CONFIG.googleScriptToken || '').trim();
const GOOGLE_SHEET_URL = (RUNTIME_CONFIG.googleSheetUrl || '').trim();

if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_TOKEN) {
    console.error('[Config] Google Sheets backend is NOT configured. Set GOOGLE_SCRIPT_URL/GOOGLE_SCRIPT_TOKEN in runtime config or environment variables.');
    console.error('[Config] No fallback credentials are shipped in the repo.');
}

const CONFIG = {
    HINT_SETTINGS: {
        defaultPenalty: 60,
        hintRequestTimeout: 30,
        tabSwitchResetsPenalty: true
    },
    FEATURES: {
        hintSystem: true
    },
    STORAGE_KEYS: {
        hintState: 'pykachuHintState',
        gameState: 'pykachuGameState',
        teamInfo: 'pykachuTeam',
        scoreState: 'pykachuScoreState',
        gameEpoch: 'pykachuGameEpoch',
        puzzleNotebook: 'pykachuPuzzleNotebook'
    }
};
