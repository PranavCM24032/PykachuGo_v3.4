// ==============================
// SOUND SYSTEM
// ==============================
let audioContext = null;
let isMuted = false;
let soundEnabled = true;

function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Audio system initialized');

        const unlockAudio = () => {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }
        };

        document.addEventListener('pointerdown', unlockAudio, { passive: true, once: true });
        document.addEventListener('touchstart', unlockAudio, { passive: true, once: true });
    } catch (e) {
        console.warn('Web Audio API not supported:', e);
        soundEnabled = false;
    }
}

// Upgraded playSound to handle synth notes OR external files (cries/music)
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

            case 'pokeballOpen': {
                // OPEN SEQUENCE audio — synced 4-layer choreography:
                //   L1 @0.00s spring latch click   (matches button press)
                //   L2 @0.15s pneumatic vent+pop    (matches shells splitting)
                //   L3 @0.35s rising beam hum+sizzle (matches plasma outpour)
                //   L4 @0.65s low thud + creature cry (matches materialization)

                // L1 — sharp metallic latch click (spring release)
                const click = audioContext.createOscillator();
                const clickG = audioContext.createGain();
                click.type = 'square';
                click.frequency.setValueAtTime(1150, now);
                click.frequency.exponentialRampToValueAtTime(280, now + 0.07);
                clickG.gain.setValueAtTime(0.28, now);
                clickG.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
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
                nG.gain.exponentialRampToValueAtTime(0.4, t2 + 0.02);
                nG.gain.exponentialRampToValueAtTime(0.001, t2 + 0.29);
                noiseSrc.connect(bp); bp.connect(nG); nG.connect(audioContext.destination);
                noiseSrc.start(t2);

                // crisp low "pop" body under the vent
                const pop = audioContext.createOscillator();
                const popG = audioContext.createGain();
                pop.type = 'sine';
                pop.frequency.setValueAtTime(190, t2);
                pop.frequency.exponentialRampToValueAtTime(55, t2 + 0.12);
                popG.gain.setValueAtTime(0.55, t2);
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
                humG.gain.exponentialRampToValueAtTime(0.24, t3 + 0.14);
                humG.gain.exponentialRampToValueAtTime(0.001, t3 + 0.68);
                hum.connect(humG); humG.connect(audioContext.destination);
                hum.start(t3); hum.stop(t3 + 0.72);

                // high-frequency electrical sizzle riding the beam
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
                sG.gain.exponentialRampToValueAtTime(0.06, t3 + 0.05);
                sG.gain.exponentialRampToValueAtTime(0.001, t3 + 0.45);
                sSrc.connect(hp); hp.connect(sG); sG.connect(audioContext.destination);
                sSrc.start(t3);

                // shimmering chime arpeggio during the beam
                [1320, 1760, 2200].forEach((f, k) => {
                    const ch = audioContext.createOscillator();
                    const chG = audioContext.createGain();
                    const t = t3 + 0.02 + k * 0.13;
                    ch.type = 'sine';
                    ch.frequency.setValueAtTime(f, t);
                    chG.gain.setValueAtTime(0.0001, t);
                    chG.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
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
                thudG.gain.exponentialRampToValueAtTime(0.5, t4 + 0.03);
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
                anG.gain.exponentialRampToValueAtTime(0.08, t4 + 0.02);
                anG.gain.exponentialRampToValueAtTime(0.001, t4 + 0.3);
                an.connect(anG); anG.connect(audioContext.destination);
                an.start(t4); an.stop(t4 + 0.32);
                break;
            }
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
