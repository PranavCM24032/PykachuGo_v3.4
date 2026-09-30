// ==============================
// SOUND SYSTEM
// ==============================
let audioContext = null;
var isMuted = false;
let soundEnabled = true;

// ── Speech ────────────────────────────────────────────────────────────
// Announces the catch out loud in a heavy male anime-announcer style:
// "Gotcha!! ... You caught ... <NAME>!!" Uses the Web
// Speech API, so no audio files are needed. Silently no-ops on browsers
// without support, and respects the same mute/soundEnabled switches.
let catchVoice = null;
let catchVoiceChecked = false;

// TTS pitch/rate cannot turn a female voice into a male one, so the VOICE
// itself has to be right. Anything whose name advertises a female voice is
// thrown out entirely; the rest are ranked in tiers — an explicit "male"
// beats a known male voice name, which beats anything else. Android exposes
// eSpeak ids like "en-us-x-usa#male_1-local", Windows exposes
// "Microsoft David ...", Google exposes "Google UK English Male".
const CATCH_FEMALE_VOICE_NAMES = [
    'female', 'zira', 'susan', 'hazel', 'catherine', 'linda', 'heera',
    'victoria', 'samantha', 'karen', 'moira', 'fiona', 'tessa', 'stephanie',
    'alva', 'ayanda', 'agnes', 'allison', 'ava', 'helena', 'jennifer', 'kathy',
    'siri', 'cortana', 'sonia', 'aria', 'jenny', 'hoda', 'martha', 'nicky',
    'libby', 'sara', 'natasha', 'xiaoxiao', 'ting-ting', 'yuna', 'zhiyu',
    'google us english', 'samantha', 'joanna', 'amy', 'emma', 'michelle'
];
const CATCH_MALE_VOICE_NAMES = [
    'male', 'david', 'mark', 'guy', 'george', 'james', 'daniel', 'richard',
    'fred', 'liam', 'thomas', 'ravi', 'prabhat', 'hemant', 'madhur', 'rishi',
    'brian', 'andrew', 'eddie', 'matthew', 'steven', 'paul', 'peter', 'sean',
    'lee', 'aaron', 'charles', 'william', 'alex', 'oliver', 'ryan', 'tom',
    'chris', 'arthur', 'bruce', 'gordon', 'henry', 'roger', 'yannick', 'rishi'
];

// -10000 = vetoed (female), so a vetoed voice can never outrank anything.
const CATCH_FEMALE_VETO = -10000;

function scoreCatchVoice(v) {
    const name = (v.name || '').toLowerCase();
    if (CATCH_FEMALE_VOICE_NAMES.some((k) => name.includes(k))) return CATCH_FEMALE_VETO;

    let score = 0;
    if (name.includes('male')) score += 500;
    if (CATCH_MALE_VOICE_NAMES.some((k) => name.includes(k))) score += 300;
    if (/^en[-_]?/i.test(v.lang || '')) score += 20;
    if (/^en[-_]us/i.test(v.lang || '')) score += 8;
    else if (/^en[-_]gb/i.test(v.lang || '')) score += 4;
    if (v.localService) score += 2;
    if (name.includes('natural')) score += 1;
    return score;
}

// Picks one consistent announcer per browser. Deterministic: ties fall back to
// the order the OS reported, so the same device always speaks with the same
// voice. Returns null only when the platform has no voices at all.
function pickCatchVoice(voices) {
    if (!voices || !voices.length) return null;
    const english = voices.filter((v) => /^en/i.test(v.lang || ''));
    const pool = english.length ? english : voices;

    const ranked = pool
        .map((v, i) => ({ v, i, s: scoreCatchVoice(v) }))
        .filter((e) => e.s !== CATCH_FEMALE_VETO)
        .sort((a, b) => (b.s - a.s) || (a.i - b.i));

    // Every English voice on the device is female-labelled: still speak, using
    // the best remaining voice with a low pitch, rather than muting the line.
    return (ranked[0] && ranked[0].v) || pool[0] || null;
}

// Re-resolves the catch voice. Chrome populates getVoices() async, so this
// also runs on every catch and on voiceschanged — a voice list that only
// half-loaded earlier must not lock in a wrong voice for the whole session.
function refreshCatchVoice() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return;

    catchVoice = pickCatchVoice(voices);
    catchVoiceChecked = !!catchVoice;
    if (typeof console !== 'undefined' && console.info) {
        console.info('[pykachu] catch voice:', catchVoice ? `${catchVoice.name} / ${catchVoice.lang}` : 'none');
    }
}

// Celebratory 8-bit "caught!" jingle + a soft crowd-cheer swell, fired the
// instant the announcer line starts. Shaped by a 300Hz-3kHz bandpass so it
// reads as 90s CRT TV audio. The FILTERED part is the sfx — Web Speech output
// can't be routed through the Web Audio graph, so the retro colour lives here.
function playCatchChime() {
    if (!soundEnabled || isMuted || !audioContext) return;
    try {
        const now = audioContext.currentTime;
        const master = audioContext.createGain();
        master.gain.setValueAtTime(0.0001, now);
        master.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
        const tv = audioContext.createBiquadFilter();
        tv.type = 'bandpass';
        tv.frequency.value = 1500;
        tv.Q.value = 1.2;
        tv.connect(master);
        master.connect(audioContext.destination);
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
        notes.forEach((freq, i) => {
            const osc = audioContext.createOscillator();
            const g = audioContext.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            const t = now + i * 0.07;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
            osc.connect(g);
            g.connect(tv);
            osc.start(t);
            osc.stop(t + 0.26);
        });
        // Sparkle dust drifting in the air after the jingle — many tiny soft
        // plinks, small and airy rather than one loud burst, scattered over
        // the next second like fairy dust in the air.
        for (let i = 0; i < 20; i++) {
            const osc = audioContext.createOscillator();
            const g = audioContext.createGain();
            osc.type = i % 3 === 0 ? 'triangle' : 'sine';
            osc.frequency.value = 1200 + Math.random() * 3000;
            const t = now + 0.12 + Math.random() * 1.35;
            const peak = 0.03 + Math.random() * 0.04;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
            osc.connect(g);
            g.connect(tv);
            osc.start(t);
            osc.stop(t + 0.2);
        }
        // Crowd "whoosh" swell — filtered noise that reads as a tiny cheer.
        const nLen = 0.9;
        const noiseBuf = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * nLen), audioContext.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const crowd = audioContext.createBufferSource();
        crowd.buffer = noiseBuf;
        const cg = audioContext.createGain();
        cg.gain.setValueAtTime(0.0001, now + 0.05);
        cg.gain.exponentialRampToValueAtTime(0.05, now + 0.25);
        cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
        crowd.connect(cg);
        cg.connect(tv);
        crowd.start(now + 0.05);
    } catch (e) {
        console.warn('Catch chime failed:', e);
    }
}

let catchSpeakTimer = null;

// Chrome/iOS Safari only let speechSynthesis play after a direct user tap
// and can silently drop a speak() fired right after cancel(), so:
//  - the first tap anywhere primes the engine with a silent warm-up line,
//  - each catch waits a beat before speaking.
function unlockCatchVoice() {
    if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    if (window.__pykachuSpeechUnlocked) return;
    window.__pykachuSpeechUnlocked = true;
    try {
        const warm = new SpeechSynthesisUtterance(' ');
        warm.volume = 0;
        window.speechSynthesis.speak(warm);
    } catch (e) { }
}

function stopCatchVoice() {
    if (catchSpeakTimer) {
        clearTimeout(catchSpeakTimer);
        catchSpeakTimer = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (e) { }
    }
}

function speakCatch(pokemonName) {
    if (!soundEnabled || isMuted) return;
    if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;

    const name = String(pokemonName || '').trim();
    stopCatchVoice();

    // Retro chime + the announcer line land on the same tick.
    playCatchChime();

    // Stale cached puzzle data from before pokemonName existed must not
    // silence the celebration — fall back to a generic catch line.
    const line = name ? name.toUpperCase() : 'one';
    const speakNow = () => {
        try {
            const synth = window.speechSynthesis;
            // Always re-resolve right before speaking: Chrome often returns a
            // partial voice list on the first call, and a voice cached from
            // that half-list is exactly how a female announcer slips through.
            refreshCatchVoice();
            const utter = new SpeechSynthesisUtterance(`Gotcha!! ... You caught ... ${line}!!`);
            if (catchVoice) utter.voice = catchVoice;
            utter.lang = (catchVoice && catchVoice.lang) || 'en-US';
            utter.pitch = 0.7;
            utter.rate = 1.02;
            utter.volume = 1.0;
            synth.speak(utter);
        } catch (e) {
            console.warn('Catch announcement failed:', e);
        }
    };

    if (!catchVoiceChecked || !catchVoice) {
        refreshCatchVoice();
    }
    if (!window.__pykachuVoicesBound) {
        window.__pykachuVoicesBound = true;
        window.speechSynthesis.addEventListener('voiceschanged', refreshCatchVoice);
    }

    // A beat after cancel() stops Chrome/iOS from silently dropping the line.
    catchSpeakTimer = setTimeout(speakNow, 180);
}

function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Audio system initialized');

        const unlockAudio = () => {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }
            unlockCatchVoice();
        };

        document.addEventListener('pointerdown', unlockAudio, { passive: true });
        document.addEventListener('touchstart', unlockAudio, { passive: true });
    } catch (e) {
        console.warn('Web Audio API not supported:', e);
        soundEnabled = false;
    }
}

// Upgraded playSound to handle synth notes OR external files (cries/music)
// ── Final celebration sting ───────────────────────────────────────────
// The end-of-chain confetti blast gets a 10-second instrumental victory cue,
// fully synthesised so it costs no bytes and works offline:
//   0.00s  sharp confetti-cannon pop (noise crack + sub thump)
//   0.05s  crowd cheer swell, peaks ~0.6s, fades by 2.6s
//   0.15s  enthusiastic applause, dense then thinning out to 7.0s
//   0.20s  brass fanfare melody (detuned saws through a formant filter)
//   5.85s  timpani build into the final cadence
//   7.81s  chord + cymbal swell
//  10.00s  master fade to silence — seamless end, no audible cut
// Purely instrumental: no SpeechSynthesis, so nothing can read as voiceover.

const CELEBRATION_TOTAL_SECONDS = 10;
const celebrationNoiseBuffers = new Map();

function getCelebrationNoiseBuffer(ctx, seconds, tag) {
    const key = `${tag}:${seconds}`;
    if (celebrationNoiseBuffers.has(key)) return celebrationNoiseBuffers.get(key);
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    celebrationNoiseBuffers.set(key, buf);
    return buf;
}

// A single clap, pre-filtered and pre-shaped while filling the buffer
// (state-variable bandpass + fast decay). Baking the filter in means each
// applause grain only costs a BufferSource at play time, which keeps ~120 of
// them cheap enough for a mid-range phone.
function buildClapBuffer(ctx) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * 0.035));
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    // Chamberlin state-variable filter: f = 2*sin(pi*fc/sr), stable well below 1.
    const fc = 2100;
    const f = 2 * Math.sin((Math.PI * fc) / sr);
    const damp = 1.1;
    let low = 0, band = 0;
    for (let i = 0; i < len; i++) {
        const x = Math.random() * 2 - 1;
        const high = x - low - damp * band;
        band += f * high;
        low += f * band;
        const t = i / len;
        // 1ms attack, quick decay — a hand-clap, not a click
        const env = t < 0.03 ? t / 0.03 : Math.pow(1 - (t - 0.03) / 0.97, 2.6);
        d[i] = band * env;
    }
    return buf;
}

function getCelebrationClap(ctx) {
    const key = 'clap:2100:35ms';
    if (celebrationNoiseBuffers.has(key)) return celebrationNoiseBuffers.get(key);
    const buf = buildClapBuffer(ctx);
    celebrationNoiseBuffers.set(key, buf);
    return buf;
}

function scheduleFinalCelebrationSting(ctx, startTime, volume) {
    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume == null ? 1 : volume));
    master.connect(ctx.destination);

    // Everything is wrapped in one master fade so the cue can never click or
    // be cut off mid-note: full level until 9s, then a smooth 1s fade out.
    const t0 = startTime + 0.02;
    master.gain.setValueAtTime(1, t0);
    master.gain.setValueAtTime(1, t0 + 9);
    master.gain.linearRampToValueAtTime(0, t0 + CELEBRATION_TOTAL_SECONDS);

    // ── 1. Confetti cannon pop: bright crack over a short sub thump ──────
    const crack = ctx.createBufferSource();
    crack.buffer = getCelebrationNoiseBuffer(ctx, 0.3, 'crack');
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.value = 1800;
    const crackG = ctx.createGain();
    crackG.gain.setValueAtTime(0.0001, t0);
    crackG.gain.exponentialRampToValueAtTime(0.5, t0 + 0.004);
    crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    crack.connect(crackHp); crackHp.connect(crackG); crackG.connect(master);
    crack.start(t0); crack.stop(t0 + 0.2);

    const pop = ctx.createOscillator();
    const popG = ctx.createGain();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(190, t0);
    pop.frequency.exponentialRampToValueAtTime(52, t0 + 0.18);
    popG.gain.setValueAtTime(0.0001, t0);
    popG.gain.exponentialRampToValueAtTime(0.42, t0 + 0.006);
    popG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    pop.connect(popG); popG.connect(master);
    pop.start(t0); pop.stop(t0 + 0.24);

    // ── 2. Crowd cheer: three bandpass layers over looping noise ─────────
    const cheerG = ctx.createGain();
    cheerG.gain.setValueAtTime(0.0001, t0 + 0.05);
    cheerG.gain.exponentialRampToValueAtTime(0.3, t0 + 0.6);
    cheerG.gain.setValueAtTime(0.3, t0 + 1.3);
    cheerG.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6);
    cheerG.connect(master);

    // Slow wobble on the mid layer: a real crowd never holds a steady level.
    const cheerLfo = ctx.createOscillator();
    const cheerLfoG = ctx.createGain();
    cheerLfo.type = 'sine';
    cheerLfo.frequency.value = 5.5;
    cheerLfoG.gain.value = 0.09;
    cheerLfo.connect(cheerLfoG);
    cheerLfo.start(t0 + 0.05); cheerLfo.stop(t0 + 2.7);

    [[420, 1.0, 0.9], [1050, 0.85, 0.6], [2400, 1.4, 0.32]].forEach(([fc, q, lvl], i) => {
        const src = ctx.createBufferSource();
        src.buffer = getCelebrationNoiseBuffer(ctx, 3, 'crowd');
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fc;
        bp.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = lvl;
        src.connect(bp); bp.connect(g); g.connect(cheerG);
        if (i === 1) cheerLfoG.connect(g.gain);
        src.start(t0 + 0.05 + i * 0.013);
        src.stop(t0 + 2.7);
    });

    // ── 3. Applause: dense claps thinning out, no voice-like formants ─────
    const clapBuf = getCelebrationClap(ctx);
    const applauseG = ctx.createGain();
    applauseG.gain.value = 0.9;
    applauseG.connect(master);

    // Eight fixed levels keep the grains varied without a Gain node each.
    const clapBuses = [];
    for (let i = 0; i < 8; i++) {
        const bus = ctx.createGain();
        bus.gain.value = 0.22 + i * 0.11;
        bus.connect(applauseG);
        clapBuses.push(bus);
    }

    let grain = 0;
    let cursor = t0 + 0.15;
    const applauseEnd = t0 + 7;
    while (cursor < applauseEnd) {
        // Denser at the start, thinning out as the crowd settles
        const progress = (cursor - t0) / 7;
        cursor += 0.012 + progress * 0.075 + Math.random() * 0.03;
        const src = ctx.createBufferSource();
        src.buffer = clapBuf;
        src.playbackRate.value = 0.85 + Math.random() * 0.45;
        src.connect(clapBuses[grain % clapBuses.length]);
        src.start(cursor);
        grain++;
    }
    // Fade the applause bus so the tail doesn't cut off with the cue
    applauseG.gain.setValueAtTime(0.9, t0);
    applauseG.gain.setValueAtTime(0.9, applauseEnd - 0.4);
    applauseG.gain.linearRampToValueAtTime(0, applauseEnd + 0.3);

    // ── 4. Brass fanfare: detuned saws through a formant-ish lowpass ─────
    // [frequency, start seconds, duration seconds] — three phrases: a call,
    // an answer, then the final cadence into a held C-major chord.
    const fanfare = [
        [523.25, 0.20, 0.30], [523.25, 0.50, 0.16], [523.25, 0.66, 0.16],
        [783.99, 0.82, 0.42], [659.25, 1.24, 0.30], [783.99, 1.54, 0.30],
        [1046.50, 1.84, 1.30],
        [880.00, 3.30, 0.34], [783.99, 3.64, 0.30], [659.25, 3.94, 0.30],
        [587.33, 4.24, 0.46], [659.25, 4.70, 0.30], [783.99, 5.00, 0.70],
        [1046.50, 5.85, 0.34], [987.77, 6.19, 0.26], [1046.50, 6.45, 0.34],
        [783.99, 6.79, 0.30], [659.25, 7.09, 0.30], [783.99, 7.39, 0.42],
        [1046.50, 7.81, 1.70]
    ];

    const brassG = ctx.createGain();
    brassG.gain.value = 0.34;
    brassG.connect(master);

    const playBrassNote = (freq, at, dur, level) => {
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, at);
        lp.frequency.linearRampToValueAtTime(2400, at + 0.09);
        lp.frequency.linearRampToValueAtTime(1500, at + dur);
        lp.Q.value = 1.1;

        // Two slightly detuned saws: the beating is what makes it read as a
        // brass section rather than a synth blip.
        const a = ctx.createOscillator();
        const b = ctx.createOscillator();
        a.type = 'sawtooth'; b.type = 'sawtooth';
        a.frequency.value = freq;
        b.frequency.value = freq * 1.006;

        // Vibrato on longer notes — brass players never hold a dead note.
        let vib = null;
        let vibG = null;
        if (dur >= 0.6) {
            vib = ctx.createOscillator();
            vibG = ctx.createGain();
            vib.type = 'sine';
            vib.frequency.value = 5.2;
            vibG.gain.setValueAtTime(0, at);
            vibG.gain.linearRampToValueAtTime(freq * 0.006, at + Math.min(0.35, dur * 0.5));
            vib.connect(vibG);
            vibG.connect(a.frequency);
            vibG.connect(b.frequency);
            vib.start(at); vib.stop(at + dur + 0.05);
        }

        // Brass bite on the attack, smooth release at the end of the note.
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(level, at + 0.035);
        g.gain.exponentialRampToValueAtTime(level * 0.72, at + Math.min(0.22, dur * 0.6));
        g.gain.setValueAtTime(level * 0.72, at + dur - 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

        a.connect(lp); b.connect(lp); lp.connect(g); g.connect(brassG);
        a.start(at); b.start(at);
        a.stop(at + dur + 0.02); b.stop(at + dur + 0.02);
    };

    fanfare.forEach(([f, at, dur]) => playBrassNote(f, t0 + at, dur, 0.5));

    // Held root-position chord under the final cadence for a proper finish
    [[261.63, 0.26], [659.25, 0.3], [783.99, 0.28], [1046.50, 0.24]]
        .forEach(([f, lvl]) => playBrassNote(f, t0 + 7.81, 1.75, lvl));

    // ── 5. Timpani: one hit on the pop, a roll building the cadence ──────
    const timpani = (at, level) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, at);
        osc.frequency.exponentialRampToValueAtTime(58, at + 0.24);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(level, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
        osc.connect(g); g.connect(master);
        osc.start(at); osc.stop(at + 0.32);
    };
    timpani(t0, 0.34);
    for (let i = 0; i < 8; i++) timpani(t0 + 5.85 + i * 0.085, 0.12 + i * 0.028);
    timpani(t0 + 7.81, 0.5);

    // ── 6. Cymbal shimmer under the cadence, closed as the cue ends ──────
    const cym = ctx.createBufferSource();
    cym.buffer = getCelebrationNoiseBuffer(ctx, 2.5, 'cymbal');
    const cymHp = ctx.createBiquadFilter();
    cymHp.type = 'highpass';
    cymHp.frequency.value = 5200;
    const cymG = ctx.createGain();
    cymG.gain.setValueAtTime(0.0001, t0 + 7.75);
    cymG.gain.exponentialRampToValueAtTime(0.16, t0 + 7.85);
    cymG.gain.exponentialRampToValueAtTime(0.001, t0 + 9.6);
    cym.connect(cymHp); cymHp.connect(cymG); cymG.connect(master);
    cym.start(t0 + 7.75); cym.stop(t0 + 9.7);
}

function playSound(soundName, volume = 0.3) {
    if (!soundEnabled || isMuted || !audioContext) return;

    const safeSoundName = String(soundName || 'click');

    // Handle External URL / Pokemon Cries
    if (safeSoundName.startsWith('http') || safeSoundName.endsWith('.mp3') || safeSoundName.endsWith('.ogg')) {
        try {
            const audio = new Audio(soundName);
            audio.volume = volume;
            audio.play().catch((e) => console.warn('Cry audio failed to play:', e));
            return;
        } catch (e) {
            console.warn("External sound failed:", e);
            return;
        }
    }

    try {
        if (audioContext.state === 'suspended') audioContext.resume();

        const createOsc = (freq, type, startTime, duration, gain) => {
            const osc = audioContext.createOscillator();
            const g = audioContext.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, startTime);
            g.gain.setValueAtTime(gain, startTime);
            g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(g);
            g.connect(audioContext.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
            return { osc, g };
        };

        const now = audioContext.currentTime;

        switch (safeSoundName) {
            case 'click':
                createOsc(440, 'triangle', now, 0.1, 0.1);
                createOsc(880, 'sine', now, 0.05, 0.05);
                break;

            case 'success':
                createOsc(523.25, 'sine', now, 0.4, 0.1);
                createOsc(659.25, 'sine', now + 0.1, 0.4, 0.08);
                createOsc(783.99, 'sine', now + 0.2, 0.4, 0.05);
                createOsc(1046.50, 'sine', now + 0.3, 0.5, 0.1);
                break;

            case 'error':
                createOsc(110, 'square', now, 0.3, 0.15);
                createOsc(115, 'square', now, 0.3, 0.1);
                // Noise burst for error
                const noiseBuf = audioContext.createBuffer(1, audioContext.sampleRate * 0.2, audioContext.sampleRate);
                const noiseData = noiseBuf.getChannelData(0);
                for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
                const noiseSrc = audioContext.createBufferSource();
                noiseSrc.buffer = noiseBuf;
                const noiseGain = audioContext.createGain();
                noiseGain.gain.setValueAtTime(0.05, now);
                noiseGain.gain.linearRampToValueAtTime(0, now + 0.2);
                noiseSrc.connect(noiseGain); noiseGain.connect(audioContext.destination);
                noiseSrc.start(now);
                break;

            case 'victory':
                [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((f, i) => {
                    createOsc(f, 'sine', now + (i * 0.1), 0.6, 0.15 - (i * 0.02));
                });
                break;

            case 'scanStart':
                for (let i = 0; i < 5; i++) {
                    const osc = audioContext.createOscillator();
                    const g = audioContext.createGain();
                    osc.frequency.setValueAtTime(200 + (i * 100), now + (i * 0.1));
                    osc.frequency.exponentialRampToValueAtTime(800 + (i * 100), now + (i * 0.1) + 0.2);
                    g.gain.setValueAtTime(0.05, now + (i * 0.1));
                    g.gain.linearRampToValueAtTime(0, now + (i * 0.1) + 0.2);
                    osc.connect(g); g.connect(audioContext.destination);
                    osc.start(now + (i * 0.1)); osc.stop(now + (i * 0.1) + 0.2);
                }
                break;

            case 'penaltyReset':
                createOsc(80, 'square', now, 0.4, 0.2);
                createOsc(60, 'square', now + 0.1, 0.5, 0.15);
                break;

            case 'hintStart':
                for (let i = 0; i < 8; i++) {
                    createOsc(1000 + (Math.random() * 500), 'sine', now + (i * 0.05), 0.1, 0.03);
                }
                break;

            case 'hintReveal':
                createOsc(880, 'sine', now, 0.2, 0.1);
                createOsc(1760, 'sine', now + 0.1, 0.3, 0.05);
                break;

            case 'submit':
                createOsc(300, 'triangle', now, 0.1, 0.2);
                break;

            case 'powerUp':
                const oscP = audioContext.createOscillator();
                const gP = audioContext.createGain();
                oscP.frequency.setValueAtTime(100, now);
                oscP.frequency.exponentialRampToValueAtTime(1200, now + 1.2);
                gP.gain.setValueAtTime(0, now);
                gP.gain.linearRampToValueAtTime(0.2, now + 0.3);
                gP.gain.linearRampToValueAtTime(0, now + 1.2);
                oscP.connect(gP); gP.connect(audioContext.destination);
                oscP.start(now); oscP.stop(now + 1.2);
                break;

            case 'victoryLong':
                const notes = [523.25, 523.25, 523.25, 523.25, 415.30, 466.16, 523.25, 466.16, 523.25];
                notes.forEach((f, i) => {
                    createOsc(f, 'square', now + (i * 0.15), 0.1, 0.1);
                });
                break;

            case 'hologram':
                createOsc(880, 'sine', now, 0.05, 0.3);
                createOsc(1760, 'sine', now + 0.05, 0.05, 0.2);
                const oscH = audioContext.createOscillator();
                const gH = audioContext.createGain();
                oscH.type = 'sawtooth';
                oscH.frequency.setValueAtTime(440, now);
                oscH.frequency.exponentialRampToValueAtTime(880, now + 0.5);
                gH.gain.setValueAtTime(0.1, now);
                gH.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                oscH.connect(gH); gH.connect(audioContext.destination);
                oscH.start(now); oscH.stop(now + 0.5);
                break;

            case 'pokeballDrop': {
                // Gentle set-down, not a slam: a low lowpassed thump with a
                // breath of air. The old 1.45kHz metallic clink is gone — it
                // was the harsh part that made the ball feel violent.
                const tImpact = now;
                const thud = audioContext.createOscillator();
                const thudG = audioContext.createGain();
                const thudLp = audioContext.createBiquadFilter();
                thud.type = 'sine';
                thud.frequency.setValueAtTime(130, tImpact);
                thud.frequency.exponentialRampToValueAtTime(62, tImpact + 0.16);
                thudLp.type = 'lowpass';
                thudLp.frequency.value = 420;
                thudLp.Q.value = 0.6;
                thudG.gain.setValueAtTime(0.0001, tImpact);
                thudG.gain.exponentialRampToValueAtTime(0.16, tImpact + 0.02);
                thudG.gain.exponentialRampToValueAtTime(0.001, tImpact + 0.2);
                thud.connect(thudLp); thudLp.connect(thudG); thudG.connect(audioContext.destination);
                thud.start(tImpact); thud.stop(tImpact + 0.22);

                const airLen = 0.22;
                const airBuf = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * airLen), audioContext.sampleRate);
                const airData = airBuf.getChannelData(0);
                for (let i = 0; i < airData.length; i++) airData[i] = Math.random() * 2 - 1;
                const air = audioContext.createBufferSource();
                air.buffer = airBuf;
                const airBp = audioContext.createBiquadFilter();
                airBp.type = 'bandpass';
                airBp.frequency.setValueAtTime(700, tImpact);
                airBp.frequency.exponentialRampToValueAtTime(260, tImpact + 0.2);
                airBp.Q.value = 0.8;
                const airG = audioContext.createGain();
                airG.gain.setValueAtTime(0.0001, tImpact);
                airG.gain.exponentialRampToValueAtTime(0.05, tImpact + 0.015);
                airG.gain.exponentialRampToValueAtTime(0.001, tImpact + 0.21);
                air.connect(airBp); airBp.connect(airG); airG.connect(audioContext.destination);
                air.start(tImpact);
                break;
            }

            case 'pokeballOpen': {
                // OPEN SEQUENCE audio — synced 4-layer choreography, every
                // layer kept soft so the reveal reads calm, not explosive:
                //   L1 @0.00s spring latch click   (matches button press)
                //   L2 @0.15s pneumatic vent+pop    (matches shells splitting)
                //   L3 @0.35s rising hum+sizzle (matches the light escaping the ball)
                //   L4 @0.65s low thud + creature cry (matches materialization)

                // L1 — soft mechanical latch tick (sine, not a hard square clack)
                const click = audioContext.createOscillator();
                const clickG = audioContext.createGain();
                click.type = 'sine';
                click.frequency.setValueAtTime(760, now);
                click.frequency.exponentialRampToValueAtTime(320, now + 0.09);
                clickG.gain.setValueAtTime(0.0001, now);
                clickG.gain.exponentialRampToValueAtTime(0.12, now + 0.012);
                clickG.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
                click.connect(clickG); clickG.connect(audioContext.destination);
                click.start(now); click.stop(now + 0.1);

                // L2 — pressurized pneumatic air vent (pssh-pop)
                const t2 = now + 0.15;
                const nLen = 0.28;
                const noiseBuf = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * nLen), audioContext.sampleRate);
                const nd = noiseBuf.getChannelData(0);
                for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
                const noiseSrc = audioContext.createBufferSource();
                noiseSrc.buffer = noiseBuf;
                const bp = audioContext.createBiquadFilter();
                bp.type = 'bandpass';
                bp.frequency.setValueAtTime(2400, t2);
                bp.frequency.exponentialRampToValueAtTime(450, t2 + 0.27);
                bp.Q.value = 1.1;
                const nG = audioContext.createGain();
                nG.gain.setValueAtTime(0.0001, t2);
                nG.gain.exponentialRampToValueAtTime(0.16, t2 + 0.03);
                nG.gain.exponentialRampToValueAtTime(0.001, t2 + 0.29);
                noiseSrc.connect(bp); bp.connect(nG); nG.connect(audioContext.destination);
                noiseSrc.start(t2);

                // crisp low "pop" body under the vent
                const pop = audioContext.createOscillator();
                const popG = audioContext.createGain();
                pop.type = 'sine';
                pop.frequency.setValueAtTime(190, t2);
                pop.frequency.exponentialRampToValueAtTime(55, t2 + 0.12);
                popG.gain.setValueAtTime(0.0001, t2);
                popG.gain.exponentialRampToValueAtTime(0.2, t2 + 0.02);
                popG.gain.exponentialRampToValueAtTime(0.001, t2 + 0.2);
                pop.connect(popG); popG.connect(audioContext.destination);
                pop.start(t2); pop.stop(t2 + 0.22);

                // L3 at 0.35s — rising energy-beam hum (FM shimmer)
                const t3 = now + 0.35;
                const hum = audioContext.createOscillator();
                const humG = audioContext.createGain();
                hum.type = 'sine';
                hum.frequency.setValueAtTime(240, t3);
                hum.frequency.exponentialRampToValueAtTime(1150, t3 + 0.65);
                const lfo = audioContext.createOscillator();
                const lfoG = audioContext.createGain();
                lfo.frequency.setValueAtTime(19, t3);
                lfoG.gain.setValueAtTime(5, t3);
                lfoG.gain.exponentialRampToValueAtTime(95, t3 + 0.55);
                lfo.connect(lfoG); lfoG.connect(hum.frequency);
                lfo.start(t3); lfo.stop(t3 + 0.68);
                humG.gain.setValueAtTime(0.0001, t3);
                humG.gain.exponentialRampToValueAtTime(0.14, t3 + 0.14);
                humG.gain.exponentialRampToValueAtTime(0.001, t3 + 0.68);
                hum.connect(humG); humG.connect(audioContext.destination);
                hum.start(t3); hum.stop(t3 + 0.72);

                // high-frequency electrical sizzle riding the hum
                const snLen = 0.5;
                const sBuf = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * snLen), audioContext.sampleRate);
                const sd = sBuf.getChannelData(0);
                for (let i = 0; i < sd.length; i++) sd[i] = Math.random() * 2 - 1;
                const sSrc = audioContext.createBufferSource();
                sSrc.buffer = sBuf;
                const hp = audioContext.createBiquadFilter();
                hp.type = 'highpass';
                hp.frequency.setValueAtTime(7000, t3);
                const sG = audioContext.createGain();
                sG.gain.setValueAtTime(0.0001, t3);
                sG.gain.exponentialRampToValueAtTime(0.028, t3 + 0.05);
                sG.gain.exponentialRampToValueAtTime(0.001, t3 + 0.45);
                sSrc.connect(hp); hp.connect(sG); sG.connect(audioContext.destination);
                sSrc.start(t3);

                // shimmering chime arpeggio during the release
                [1320, 1760, 2200].forEach((f, k) => {
                    const ch = audioContext.createOscillator();
                    const chG = audioContext.createGain();
                    const t = t3 + 0.02 + k * 0.13;
                    ch.type = 'sine';
                    ch.frequency.setValueAtTime(f, t);
                    chG.gain.setValueAtTime(0.0001, t);
                    chG.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
                    chG.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
                    ch.connect(chG); chG.connect(audioContext.destination);
                    ch.start(t); ch.stop(t + 0.26);
                });

                // L4 at 0.65s — low-frequency impact thud
                const t4 = now + 0.65;
                const thud = audioContext.createOscillator();
                const thudG = audioContext.createGain();
                thud.type = 'sine';
                thud.frequency.setValueAtTime(120, t4);
                thud.frequency.exponentialRampToValueAtTime(38, t4 + 0.42);
                thudG.gain.setValueAtTime(0.0001, t4);
                thudG.gain.exponentialRampToValueAtTime(0.26, t4 + 0.05);
                thudG.gain.exponentialRampToValueAtTime(0.001, t4 + 0.5);
                thud.connect(thudG); thudG.connect(audioContext.destination);
                thud.start(t4); thud.stop(t4 + 0.55);

                // L4 — synthesized creature cry (digital roar, pitch-bends up)
                const cry = audioContext.createOscillator();
                const crySub = audioContext.createOscillator();
                const cryG = audioContext.createGain();
                cry.type = 'sawtooth';
                cry.frequency.setValueAtTime(180, t4);
                cry.frequency.exponentialRampToValueAtTime(520, t4 + 0.55);
                crySub.type = 'square';
                crySub.frequency.setValueAtTime(90, t4);
                crySub.frequency.exponentialRampToValueAtTime(260, t4 + 0.55);
                cryG.gain.setValueAtTime(0.0001, t4);
                cryG.gain.exponentialRampToValueAtTime(0.16, t4 + 0.06);
                cryG.gain.setValueAtTime(0.12, t4 + 0.3);
                cryG.gain.exponentialRampToValueAtTime(0.001, t4 + 0.8);
                const cryLFO = audioContext.createOscillator();
                const cryLfoG = audioContext.createGain();
                cryLFO.frequency.setValueAtTime(28, t4);
                cryLfoG.gain.setValueAtTime(14, t4);
                cryLFO.connect(cryLfoG); cryLfoG.connect(cry.frequency);
                cryLFO.start(t4); cryLFO.stop(t4 + 0.85);
                cry.connect(cryG); crySub.connect(cryG); cryG.connect(audioContext.destination);
                cry.start(t4); crySub.start(t4);
                cry.stop(t4 + 0.85); crySub.stop(t4 + 0.85);

                // L4 — high-pitched announcement drum-hit tuck
                const an = audioContext.createOscillator();
                const anG = audioContext.createGain();
                an.type = 'triangle';
                an.frequency.setValueAtTime(880, t4);
                an.frequency.exponentialRampToValueAtTime(1320, t4 + 0.25);
                anG.gain.setValueAtTime(0.0001, t4);
                anG.gain.exponentialRampToValueAtTime(0.05, t4 + 0.02);
                anG.gain.exponentialRampToValueAtTime(0.001, t4 + 0.3);
                an.connect(anG); anG.connect(audioContext.destination);
                an.start(t4); an.stop(t4 + 0.32);
                break;
            }

            case 'finalCelebration':
                scheduleFinalCelebrationSting(audioContext, now, volume);
                break;
        }

        // Add Haptic Feedback
        if ('vibrate' in navigator) {
            if (['success', 'victory', 'powerUp'].includes(safeSoundName)) navigator.vibrate(50);
            if (safeSoundName === 'error') navigator.vibrate([50, 50, 50]);
        }
    } catch (e) {
        console.warn('Sound error:', e);
    }
}
