// ==============================
// GAME CONFIGURATION
// ==============================
const RUNTIME_CONFIG = window.PYKACHU_RUNTIME_CONFIG || {};

const FALLBACK_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxkayXUQtv1eQoTTxVj_U-3ONsnCIz_2VKY2yFUM51hnBI2k9rcWQlIO8Z0SN8VIQ74cA/exec';
const FALLBACK_SCRIPT_TOKEN = 'pykachugo-27';
const FALLBACK_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Owj4i-89RnXO-UipEVBvOcqYs2r5vdyG7vYRB8_F_X0/edit?gid=0#gid=0';

const GOOGLE_SCRIPT_URL = (RUNTIME_CONFIG.googleScriptUrl || FALLBACK_SCRIPT_URL).trim();
const GOOGLE_SCRIPT_TOKEN = (RUNTIME_CONFIG.googleScriptToken || FALLBACK_SCRIPT_TOKEN).trim();
const GOOGLE_SHEET_URL = (RUNTIME_CONFIG.googleSheetUrl || FALLBACK_SHEET_URL).trim();

if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_TOKEN) {
    console.warn('[Config] Google Sheets backend is NOT configured. Scoring and telemetry will be disabled.');
    console.warn('[Config] Expected googleScriptUrl/token in js/runtime-config.js (set repo Actions secrets, then redeploy).');
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
