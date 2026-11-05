// ==============================
// 0. ASSET PRELOADER (FOR SPEED)
// ==============================
function isLowBandwidthConnection() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return Boolean(connection && (
        connection.saveData ||
        ['slow-2g', '2g'].includes(connection.effectiveType) ||
        (Number(connection.downlink) > 0 && Number(connection.downlink) < 1)
    ));
}

const AssetPreloader = {
    cached: new Set(),
    preloadImage(url, priority) {
        if (!url || this.cached.has(url)) return;
        this.cached.add(url);
        const img = new Image();
        img.decoding = 'async';
        if (priority) img.fetchPriority = 'high';
        img.src = url;
        // Decode off the main thread now so the reveal shows the sprite on its
        // first frame instead of decoding (and visibly popping in) mid-animation.
        if (typeof img.decode === 'function') {
            img.decode().catch(() => { });
        }
    },
    // Warm only selected artwork on normal connections; data-saver users fetch
    // the caught sprite only when it is needed.
    prioritizePokemon(pokemonId) {
        if (!pokemonId || isLowBandwidthConnection()) return;
        this.preloadImage(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`, true);
    },
    preload() {
        if (isLowBandwidthConnection()) return;
        console.log("🚀 [Assets] Fast-tracking local UI sprites...");

        const scheduleTask = window.requestIdleCallback || (cb => setTimeout(cb, 50));

        scheduleTask(() => {
            ['assets/img/oak.png', 'assets/img/poketropy.png'].forEach(url => {
                this.preloadImage(url);
            });
        });
    }
};

async function loadPuzzles() {
    try {
        const response = await fetch('data/puzzle.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        PUZZLES = await response.json();
        console.log(`Loaded ${PUZZLES.length} puzzles from puzzle.json`);

        // Speed up UI by pre-caching all sprites
        AssetPreloader.preload();

        // Validate puzzles have required fields
        PUZZLES.forEach((puzzle, index) => {
            if (!puzzle.id || (!puzzle.questionPython && !puzzle.questionCpp) || !puzzle.answer) {
                console.error(`Puzzle ${index + 1} is missing required fields`);
            }
        });

        return true;
    } catch (error) {
        console.error('FATAL: Could not load puzzle data:', error);
        showToast('Cannot load puzzle data. Please refresh or contact administrator.', 'error');
        return false;
    }
}
async function loadTeams() {
    try {
        const response = await fetch('data/teams.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        TEAMS = await response.json();
        console.log(`Loaded ${TEAMS.length} teams from teams.json`);
        // Validate that we have teams
        if (TEAMS.length === 0) {
            throw new Error('No teams found in teams.json');
        }
        return true;
    } catch (error) {
        console.error('FATAL: Could not load team data:', error);
        showToast('Cannot load team data. Please refresh or contact administrator.', 'error');
        return false;
    }
}

async function loadMemes() {
    try {
        const response = await fetch('data/meme.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        MEMES = await response.json();
        console.log(`Loaded ${MEMES.length} memes from meme.json`);
        return true;
    } catch (error) {
        console.warn('Could not load meme data:', error);
        MEMES = [];
        return false;
    }
}
