// ==============================
// 0. ASSET PRELOADER (FOR SPEED)
// ==============================
const AssetPreloader = {
    cached: new Set(),
    preloadImage(url) {
        if (!url || this.cached.has(url)) return;
        this.cached.add(url);
        const img = new Image();
        img.src = url;
    },
    preload(puzzles) {
        console.log("🚀 [Assets] Fast-tracking Pokemon, Badge & UI sprites...");

        const scheduleTask = window.requestIdleCallback || (cb => setTimeout(cb, 50));

        scheduleTask(() => {
            // Preload critical UI assets & watermarks
            ['assets/img/poketropy.png', 'assets/img/brock.png', 'assets/img/jenny.png'].forEach(url => {
                this.preloadImage(url);
            });

            // Preload puzzle-specific sprites asynchronously
            puzzles.forEach(p => {
                if (p.pokemonId) {
                    this.preloadImage(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.pokemonId}.png`);
                    fetch(`https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${p.pokemonId}.ogg`, { mode: 'no-cors' }).catch(() => { });
                }
                if (p.badgeId) {
                    this.preloadImage(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/badges/${p.badgeId}.png`);
                }
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
        AssetPreloader.preload(PUZZLES);

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
