// ==============================
// FIREWORKS - Point-Blast success-screen fireworks
// ==============================

// Minimal color palette: Gold, Cyan, White
const fwPalette = [
    { bg: '#fbbf24', glow: 'rgba(251, 191, 36, 0.8)' },   // Gold
    { bg: '#38bdf8', glow: 'rgba(56, 189, 248, 0.8)' },   // Cyan / Sky Blue
    { bg: '#ffffff', glow: 'rgba(255, 255, 255, 0.9)' }   // Pure White Glow
];

/**
 * Triggers a single Point-Blast firework centered at (xPos, yPos) inside the container.
 * @param {number} xPos - Center X in pixels (relative to container)
 * @param {number} yPos - Center Y in pixels (relative to container)
 */
function triggerPointBlast(xPos, yPos) {
    const container = document.getElementById('fireworks-container');
    if (!container) return;

    // White-hot core flash at the burst epicenter (flash -> grow -> fade)
    const core = document.createElement('div');
    core.className = 'fw-core';
    core.style.left = `${xPos}px`;
    core.style.top = `${yPos}px`;
    core.style.width = '26px';
    core.style.height = '26px';
    core.style.backgroundColor = '#ffffff';
    core.style.boxShadow = '0 0 18px 6px rgba(255, 255, 255, 0.85), 0 0 40px 16px rgba(56, 189, 248, 0.45)';
    container.appendChild(core);
    setTimeout(() => core.remove(), 420);

    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'fw-particle';

        // Random particle size (2px to 4px)
        const size = Math.random() * 2 + 2;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;

        // Random color from palette
        const color = fwPalette[Math.floor(Math.random() * fwPalette.length)];
        particle.style.backgroundColor = color.bg;
        particle.style.boxShadow = `0 0 6px ${color.glow}`;

        // Radial explosion vector (360 degrees burst)
        const angle = (Math.PI * 2 / particleCount) * i + (Math.random() * 0.2 - 0.1);
        const distance = 30 + Math.random() * 45;

        const dx = `${Math.cos(angle) * distance}px`;
        const dy = `${Math.sin(angle) * distance}px`;

        particle.style.left = `${xPos}px`;
        particle.style.top = `${yPos}px`;
        particle.style.setProperty('--dx', dx);
        particle.style.setProperty('--dy', dy);

        // Gravity drop on the tail (how far each spark falls before fading)
        particle.style.setProperty('--fall', `${12 + Math.random() * 26}px`);

        // Randomize duration slightly for natural dispersion
        particle.style.animationDuration = `${0.8 + Math.random() * 0.4}s`;

        container.appendChild(particle);

        // Cleanup DOM
        setTimeout(() => particle.remove(), 1400);
    }
}

/**
 * Launches a SINGLE big point-blast firework when the success (step 4) screen
 * becomes active, then grows a persistent star field behind the content.
 * Only fires while step 4 is the active step.
 */
function startPointBlastSequence() {
    const container = document.getElementById('fireworks-container');
    if (!container) return;

    const step4 = document.getElementById('step4');
    if (step4 && !step4.classList.contains('active')) return;

    const rect = container.getBoundingClientRect();

    // One big centered burst toward the upper third of the stage
    triggerPointBlast(rect.width * 0.5, rect.height * 0.28);

    // Grow the star field right after the burst peaks
    setTimeout(startSuccessStarField, 420);
}

// ==============================
// SUCCESS STAR FIELD
// ==============================

// Capped so the DOM stays light (no runaway node growth)
const fwStarFieldMax = 30;

const fwStarColors = [
    '#ffffff',
    '#fbbf24',
    '#38bdf8',
    '#93c5fd'
];

/**
 * Creates one twinkling success star at a fixed random spot.
 * Stars are static nodes animated only by transform + opacity (compositor thread),
 * so they cost almost nothing once the keyframe is running.
 */
function createSuccessStar() {
    const field = document.getElementById('successStarField');
    if (!field) return null;

    const star = document.createElement('div');
    star.className = 'success-star';

    const size = 2 + Math.random() * 2.5;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;

    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;

    star.style.backgroundColor =
        fwStarColors[Math.floor(Math.random() * fwStarColors.length)];

    // Natural twinkle: random duration + stagger
    star.style.animationDuration = `${2 + Math.random() * 3}s`;
    star.style.animationDelay = `${Math.random() * 2}s`;
    star.style.boxShadow = '0 0 6px rgba(255, 255, 255, 0.55)';

    field.appendChild(star);
    return star;
}

/**
 * Grows the star field gradually, capped, using a self-terminating timeout
 * chain (never a running interval). Re-entry clears the old field first.
 */
function startSuccessStarField() {
    const field = document.getElementById('successStarField');
    const step4 = document.getElementById('step4');

    if (!field) return insufficient;
    if (step4 && !step4.classList.contains('active')) return;

    // Clear any field left from a previous visit (keeps DOM small)
    field.replaceChildren();

    let count = 0;

    function growBatch() {
        if (step4 && !step4.classList.contains('active')) return;

        for (let i = 0; i < 3 && count < fwStarFieldMax; i++) {
            createSuccessStar();
            count++;
        }

        if (count < fwStarFieldMax) {
            setTimeout(growBatch, 360);
        }
    }

    growBatch();
}
