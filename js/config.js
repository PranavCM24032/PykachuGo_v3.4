// ==============================
// GAME CONFIGURATION
// ==============================
const RUNTIME_CONFIG = window.PYKACHU_RUNTIME_CONFIG || {};
const GOOGLE_SCRIPT_URL = RUNTIME_CONFIG.googleScriptUrl || '';
const GOOGLE_SCRIPT_TOKEN = RUNTIME_CONFIG.googleScriptToken || '';

if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_TOKEN) {
    console.warn('[Config] Google Sheets backend is NOT configured (empty googleScriptUrl/token). Scoring and telemetry will be disabled.');
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
