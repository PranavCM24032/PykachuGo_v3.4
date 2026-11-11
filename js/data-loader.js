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

const POKEMON_SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

// Reveal art: the official artwork from the PokeAPI sprite repo. The bundled
// Pikachu is the final resort if the CDN path fails.
function pokemonSpriteUrls(pokemonId) {
    return [
        `${POKEMON_SPRITE_BASE}/other/official-artwork/${pokemonId}.png`,
        'assets/img/pikachu.png'
    ];
}

function applyPokemonSprite(img, pokemonId) {
    if (!img || !pokemonId) return;
    const urls = pokemonSpriteUrls(pokemonId);
    const token = String(pokemonId);
    let next = 1;
    // Guard against a late error from a previous puzzle overwriting the new
    // primary source after the next solve has already started.
    img.dataset.pokemonSprite = token;
    img.onerror = () => {
        if (img.dataset.pokemonSprite !== token) return;
        if (next < urls.length) {
            img.src = urls[next++];
        } else {
            img.onerror = null;
        }
    };
    img.src = urls[0];
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
        this.preloadImage(pokemonSpriteUrls(pokemonId)[0], true);
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

        // Validate puzzles have the fields the local validator reads.
        PUZZLES.forEach((puzzle, index) => {
            if (!puzzle.id || (!puzzle.questionPython && !puzzle.questionCpp)) {
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

async function loadConfig() {
    try {
        const response = await fetch('data/config.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const cfg = await response.json();
        if (!cfg || !Array.isArray(cfg.languages) || cfg.languages.length === 0 ||
            !Array.isArray(cfg.missionGroups) ||
            !cfg.missionGroups.some(group => Array.isArray(group.missions) && group.missions.length > 0)) {
            throw new Error('config.json is missing language or mission options');
        }
        window.GAME_CONFIG = cfg;
        console.log('Loaded game config from config.json');
        populateMissionSelect(cfg);
        populateLanguageSelect(cfg);
        return true;
    } catch (error) {
        console.error('Could not load config.json:', error);
        return false;
    }
}

/**
 * Populates #missionLevel <select> from config.json missionGroups.
 * Also rebuilds the custom-select overlay if already enhanced.
 */
function populateMissionSelect(cfg) {
    const sel = document.getElementById('missionLevel');
    if (!sel || !Array.isArray(cfg.missionGroups)) return;

    sel.innerHTML = '';
    cfg.missionGroups.forEach(group => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;
        optgroup.className = 'bg-[#0a0f1d]';

        (group.missions || []).forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.className = 'bg-[#050810] text-gray-300';
            if (m.icon) {
                const img = document.createElement('img');
                img.src = m.icon;
                img.alt = m.label.split(' ')[0];
                img.className = 'inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 align-middle';
                opt.appendChild(img);
            }
            opt.appendChild(document.createTextNode(' ' + m.label));
            optgroup.appendChild(opt);
        });
        sel.appendChild(optgroup);
    });

    // Rebuild the custom-select UI on top of the refreshed <select>
    if (typeof window.rebuildSelect === 'function') window.rebuildSelect('missionLevel');
}

/**
 * Populates #codeLanguage <select> from config.json languages.
 */
function populateLanguageSelect(cfg) {
    const sel = document.getElementById('codeLanguage');
    if (!sel || !Array.isArray(cfg.languages)) return;

    sel.innerHTML = '';
    cfg.languages.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang.value;
        opt.className = 'bg-[#050810] text-gray-300';
        if (lang.icon) {
            const img = document.createElement('img');
            img.src = lang.icon;
            img.alt = lang.label;
            img.className = 'inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 align-middle';
            opt.appendChild(img);
        }
        opt.appendChild(document.createTextNode(' ' + lang.label));
        sel.appendChild(opt);
    });

    if (typeof window.rebuildSelect === 'function') window.rebuildSelect('codeLanguage');
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
