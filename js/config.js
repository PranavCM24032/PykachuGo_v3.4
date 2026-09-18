// ==============================
// GAME CONFIGURATION
// ==============================
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz3RewVeLAubnJF7UDk8dLyTMfmJ9l8Gkq9WrZZ2suMVv2mH7QAWba2XNIBgH4Wd4k/exec';
const GOOGLE_SCRIPT_TOKEN = 'pyk2026@secGX42';

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
        gameEpoch: 'pykachuGameEpoch'
    }
};
