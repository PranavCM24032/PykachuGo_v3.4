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
