// ==============================
// STEP 2: QR SCANNER
// ==============================

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') return resolve();
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            return;
        }
        const tag = document.createElement('script');
        tag.src = src;
        tag.async = true;
        tag.onload = () => {
            tag.dataset.loaded = 'true';
            resolve();
        };
        tag.onerror = () => {
            tag.remove();
            reject(new Error(`Failed to load ${src}`));
        };
        document.head.appendChild(tag);
    });
}

async function getCameraPermissionState() {
    try {
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return 'unknown';
        const status = await navigator.permissions.query({ name: 'camera' });
        return status.state || 'unknown';
    } catch {
        return 'unknown';
    }
}

async function requestCameraStream() {
    // Phones vary wildly in what they accept. Try the preferred rear-camera
    // setup first, then progressively simpler constraints so an unsupported
    // resolution or frame rate does not sink the whole scan.
    const attempts = [
        {
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        },
        { video: { facingMode: { ideal: 'environment' } } },
        { video: true }
    ];

    let lastError = null;
    for (const constraints of attempts) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
            lastError = error;
            if (['NotAllowedError', 'SecurityError'].includes(error.name)) throw error;
        }
    }
    throw lastError || new Error('Camera could not start');
}

function cameraErrorMessage(error) {
    if (!window.isSecureContext) return 'Camera needs HTTPS. Use manual code entry.';
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        return 'This browser cannot access the camera. Use manual code entry.';
    }

    switch (error && error.name) {
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'No camera found. Use manual code entry.';
        case 'NotReadableError':
        case 'TrackStartError':
            return 'Camera is busy in another app. Close it and retry, or use manual entry.';
        case 'NotAllowedError':
        case 'PermissionDeniedError':
        case 'SecurityError':
            return 'Camera blocked. Allow camera for this site, then retry or use manual entry.';
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
            return 'Camera settings are unsupported. Retry or use manual entry.';
        case 'AbortError':
            return 'Camera stopped before it started. Retry or use manual entry.';
        default:
            return 'Camera could not start. Use manual code entry.';
    }
}

async function startQRScanner() {
    // Re-entrancy guard. Two fast taps put two getUserMedia() promises in
    // flight; the loser resolved later and OVERWROTE videoStream (leaking the
    // first camera track) and overwrote qrScanInterval (orphaning a 300ms
    // drawImage/getImageData loop that ran for the life of the page).
    if (videoStream || qrScannerActive || scannerStarting) return;
    scannerStarting = true;
    const gen = scanGeneration;
    let stream = null;

    try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            const error = new Error('Camera API unavailable');
            error.name = window.isSecureContext ? 'NotSupportedError' : 'SecurityError';
            throw error;
        }

        const permissionState = await getCameraPermissionState();
        if (permissionState === 'denied') {
            const error = new Error('Camera permission denied');
            error.name = 'NotAllowedError';
            throw error;
        }

        stream = await requestCameraStream();

        // Back/cancel landed while the permission prompt was open. The promise
        // still resolved afterwards and used to boot a scanner nobody asked
        // for — camera light on, scan loop running. Drop the tracks instead.
        if (gen !== scanGeneration) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }

        videoStream = stream;

        playSound('scanStart');

        const container = document.getElementById('qrScannerContainer');
        const video = document.getElementById('qrVideo');
        if (!container || !video) {
            // Bail safely rather than throwing with the camera already open.
            stopQRScanner();
            return;
        }
        container.classList.remove('hidden');
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.srcObject = stream;
        try {
            await video.play();
        } catch (playError) {
            // Some mobile browsers reject the initial play() while the stream
            // is still warming up. The loadeddata wait below still recovers.
            console.warn('[Scanner] Video play deferred:', playError);
        }

        if (gen !== scanGeneration) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        if (video.readyState < video.HAVE_CURRENT_DATA) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Camera stream did not produce video frames'));
                }, 10000);
                const onLoadedData = () => {
                    cleanup();
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    reject(video.error || new Error('Camera video could not be played'));
                };
                const cleanup = () => {
                    clearTimeout(timeout);
                    video.removeEventListener('loadeddata', onLoadedData);
                    video.removeEventListener('error', onError);
                };
                video.addEventListener('loadeddata', onLoadedData, { once: true });
                video.addEventListener('error', onError, { once: true });
            });
        }

        if (gen !== scanGeneration) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }

        try {
            const track = stream.getVideoTracks()[0];
            if (track) setupZoomControl(track);
        } catch (error) {
            console.warn('[Scanner] Zoom setup safely skipped:', error);
        }

        qrScannerActive = true;
        startQRCodeDetection();

    } catch (error) {
        if (gen !== scanGeneration) {
            stream?.getTracks().forEach((track) => track.stop());
            return;
        }
        console.error('Camera error:', error);
        // Never leave a live camera running on the failure path.
        stopQRScanner();

        // Camera blocked (in-app browser, denied permission, no camera API):
        // show the guidance popup inside the Pokédex.
        const errorName = error && error.name;
        if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError', 'NotSupportedError'].includes(errorName)
            && typeof openCameraGuide === 'function') {
            openCameraGuide(errorName === 'NotSupportedError' ? 'inapp' : 'permission');
        } else {
            showToast(cameraErrorMessage(error), 'error');
            showManualEntry();
        }
    } finally {
        scannerStarting = false;
    }
}

let initialPinchDistance = null;
let initialPinchZoom = null;

function setupZoomControl(track) {
    const zoomContainer = document.getElementById('zoomControlContainer');
    const zoomSlider = document.getElementById('qrZoomSlider');
    const scannerOverlay = document.getElementById('qrScannerContainer');

    if (!zoomContainer || !zoomSlider || !track || !scannerOverlay) return;

    // iOS Guard: iOS Safari / WebKit does not support getCapabilities on MediaStreamTrack
    if (typeof track.getCapabilities !== 'function') {
        console.log('[Scanner] getCapabilities not supported on this platform (iOS Safari)');
        return;
    }

    try {
        const capabilities = track.getCapabilities();
        if (!capabilities || !capabilities.zoom) return;

        zoomContainer.classList.remove('hidden');

        // Set slider range based on hardware capabilities
        zoomSlider.min = capabilities.zoom.min;
        zoomSlider.max = capabilities.zoom.max;
        zoomSlider.step = capabilities.zoom.step || 0.1;

        // Get current zoom value
        const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
        zoomSlider.value = settings.zoom || capabilities.zoom.min;

        // Function to apply zoom
        const applyZoom = async (value) => {
            try {
                const zoomValue = Math.min(Math.max(value, capabilities.zoom.min), capabilities.zoom.max);
                await track.applyConstraints({
                    advanced: [{ zoom: zoomValue }]
                });
                zoomSlider.value = zoomValue;
            } catch (err) {
                console.error('Error applying zoom:', err);
            }
        };

        // Slider listener
        zoomSlider.oninput = (e) => applyZoom(parseFloat(e.target.value));

        // PINCH TO ZOOM LOGIC
        scannerOverlay.ontouchstart = (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                initialPinchDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                const currentSettings = typeof track.getSettings === 'function' ? track.getSettings() : {};
                initialPinchZoom = currentSettings.zoom || 1;
            }
        };

        scannerOverlay.ontouchmove = (e) => {
            if (e.touches.length === 2 && initialPinchDistance !== null) {
                e.preventDefault();
                const currentDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );

                // Sensitivity factor: how much the zoom changes per pixel of pinch
                // We map the distance ratio to the zoom range
                const zoomDelta = (currentDistance - initialPinchDistance) / 100;
                applyZoom(initialPinchZoom + zoomDelta);
            }
        };

        scannerOverlay.ontouchend = () => {
            initialPinchDistance = null;
            initialPinchZoom = null;
        };

    } catch (err) {
        console.warn('[Scanner] setupZoomControl error:', err);
    }
}

function stopQRScanner() {
    qrScannerActive = false;
    // Invalidates any OCR worker still initialising (see startQRCodeDetection).
    scanGeneration++;

    if (qrScanInterval) {
        clearInterval(qrScanInterval);
        qrScanInterval = null;
    }

    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    const video = document.getElementById('qrVideo');
    if (video) video.srcObject = null;

    const scannerOverlay = document.getElementById('qrScannerContainer');
    if (scannerOverlay) {
        scannerOverlay.ontouchstart = null;
        scannerOverlay.ontouchmove = null;
        scannerOverlay.ontouchend = null;
    }

    // Cleanup OCR worker
    if (window.cleanupOCR) {
        window.cleanupOCR();
    }

    document.getElementById('qrScannerContainer')?.classList.add('hidden');
    document.getElementById('zoomControlContainer')?.classList.add('hidden');
}

function startQRCodeDetection() {
    const video = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrCanvas');
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

    let ocrWorker = null;
    let lastOCRTime = 0;
    const OCR_INTERVAL = 2000;

    // Fixed internal resolution for consistent performance
    const SCAN_WIDTH = 640;
    const SCAN_HEIGHT = 480;
    canvas.width = SCAN_WIDTH;
    canvas.height = SCAN_HEIGHT;

    // Lazy-load heavy scanning libs only when the scanner actually opens
    let libsReady = false;
    const gen = scanGeneration;
    loadScript('assets/vendor/jsQR-1.4.0.js').then(() => {
        // Scanner was closed while the CDN scripts were downloading.
        if (gen !== scanGeneration) return;
        libsReady = true;
    }).catch(err => {
        if (gen !== scanGeneration) return;
        console.warn('[Scanner] QR decoder failed to load:', err);
        showToast('QR scanner is unavailable. Use manual code entry.', 'error');
        stopQRScanner();
        showManualEntry();
    });

    // OCR is an optional text-code fallback, not a prerequisite for QR scanning.
    // Avoid its large script/WASM downloads when data saver or a slow link is detected.
    if (!isLowBandwidthConnection()) {
        loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js')
            .then(() => {
                if (gen !== scanGeneration) return null;
                return Tesseract.createWorker();
            })
            .then(worker => {
                if (!worker) return;
                // createWorker() is async: closing the scanner before this resolves
                // used to make cleanupOCR() a no-op and leak the worker.
                if (gen !== scanGeneration) {
                    worker.terminate();
                    return null;
                }
                return worker.loadLanguage('eng')
                    .then(() => worker.initialize('eng'))
                    .then(() => {
                        if (gen !== scanGeneration) {
                            worker.terminate();
                            return;
                        }
                        ocrWorker = worker;
                        console.log('[Scanner] AI OCR online');
                    })
                    .catch(error => {
                        worker.terminate();
                        throw error;
                    });
            })
            .catch(err => console.warn('[Scanner] Optional OCR failed to load:', err));
    }

    qrScanInterval = setInterval(() => {
        if (!qrScannerActive || video.readyState !== video.HAVE_ENOUGH_DATA) return;

        try {
            // Re-sync aspect ratio only if video stream changes significantly
            if (video.videoWidth > 0 && Math.abs(canvas.width - SCAN_WIDTH) > 10) {
                // Optimization: stay at fixed scan resolution for speed
            }

            context.drawImage(video, 0, 0, SCAN_WIDTH, SCAN_HEIGHT);
            const imageData = context.getImageData(0, 0, SCAN_WIDTH, SCAN_HEIGHT);

            // 1. QR Code Look-up
            if (libsReady && typeof jsQR === 'function') {
                const code = jsQR(imageData.data, SCAN_WIDTH, SCAN_HEIGHT);
                if (code && code.data) {
                    handleQRScanResult(code.data);
                    return;
                }
            }

            // 2. Throttled AI OCR (Google Lens style fallback)
            const now = Date.now();
            if (ocrWorker && (now - lastOCRTime) > OCR_INTERVAL) {
                lastOCRTime = now;
                canvas.toBlob(blob => {
                    if (!blob || !qrScannerActive) return;
                    ocrWorker.recognize(blob).then(({ data: { text } }) => {
                        if (!qrScannerActive) return;
                        const rawUpper = text.toUpperCase();
                        const compact = rawUpper.replace(/\s+/g, '');
                        const matchedPuzzle = PUZZLES.find(p => {
                            const linkId = (p.linkid || '').toUpperCase().replace(/\s+/g, '');
                            if (!linkId) return false;
                            // Exact token only: an exact match, or the ID delimited
                            // by non-alphanumerics. Prevents substring false positives
                            // (e.g. "M01" inside unrelated text) from unlocking.
                            if (compact === linkId) return true;
                            const esc = linkId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            return new RegExp(`(^|[^A-Z0-9])${esc}($|[^A-Z0-9])`).test(rawUpper);
                        });
                        if (matchedPuzzle) handleQRScanResult(matchedPuzzle.linkid);
                    }).catch(err => console.warn('[Scanner] OCR skip:', err));
                }, 'image/jpeg', 0.8);
            }
        } catch (error) {
            console.error('[Scanner] Critical Error:', error);
        }
    }, 300);

    window.cleanupOCR = () => {
        if (ocrWorker) ocrWorker.terminate();
        ocrWorker = null;
    };
}

// QR Processing State
let processingQR = false;

async function handleQRScanResult(qrData) {
    if (processingQR) return;
    processingQR = true;

    console.log('QR Code detected:', qrData);

    let linkId = qrData;
    let memeId = null;
    try {
        if (qrData.includes('linkid=') || qrData.includes('memeid=')) {
            try {
                const url = new URL(qrData);
                linkId = url.searchParams.get('linkid') || qrData;
                memeId = url.searchParams.get('memeid');
            } catch (e) {
                const linkMatch = qrData.match(/linkid=([^&]*)/i);
                if (linkMatch && linkMatch[1]) {
                    linkId = linkMatch[1];
                }
                const memeMatch = qrData.match(/memeid=([^&]*)/i);
                if (memeMatch && memeMatch[1]) {
                    memeId = memeMatch[1];
                }
            }
        }

        // Fallback: full URL with the ID in the path (e.g. https://host/XG01 or https://host/Pikachu_v3/M01)
        if (!memeId && (linkId === qrData) && /^https?:\/\//i.test(qrData)) {
            const url = new URL(qrData);
            const pathSegs = url.pathname.split('/').filter(Boolean);
            const lastSeg = pathSegs[pathSegs.length - 1];
            if (lastSeg) linkId = lastSeg;
        }
    } catch (e) {
        console.warn('QR parse error:', e);
    }

    if (!memeId) {
        memeId = linkId;
    }

    const matchedMeme = MEMES.find(m => standardizeString(m.memeid) === standardizeString(memeId));

    if (matchedMeme) {
        showToast('🎬 Meme Unlocked!', 'success');
        setTimeout(() => {
            stopQRScanner();
            showMemePlayer(matchedMeme);
            processingQR = false;
        }, 1000);
        return;
    }

    const normalizedInput = standardizeString(linkId);
    urlLockedPuzzle = PUZZLES.find(p => standardizeString(p.linkid) === normalizedInput);

    // Allow direct start-code entry. Codes live in data/puzzle.json.
    if (!urlLockedPuzzle) {
        urlLockedPuzzle = PUZZLES.find(p => isStartingPuzzle(p) && standardizeString(p.startCode) === normalizedInput) || null;
    }

    if (urlLockedPuzzle) {
        // Chain gate: only the NEXT puzzle in the sequence can be scanned.
        // Trying to jump ahead (e.g. puzzle 1 -> puzzle 4) is rejected here.
        if (!isPuzzleAllowed(urlLockedPuzzle)) {
            submitToGoogleSheets('QR_BLOCKED', {
                linkId: linkId,
                puzzleId: urlLockedPuzzle.id,
                puzzleLevel: urlLockedPuzzle.level,
                requiredPuzzle: currentPuzzle ? currentPuzzle.linkid : 'XG01 (start)',
                currentProgress: currentPuzzle ? currentPuzzle.id : 0
            });
            const msg = puzzleGateMessage(urlLockedPuzzle);
            urlLockedPuzzle = null;
            showToast(msg, 'error');
            playSound('error');
            setTimeout(() => {
                processingQR = false;
            }, 2500);
            return;
        }

        notepadBump('scan', urlLockedPuzzle);

        showToast('✓ Signal Acquired - Redirecting...', 'success');
        setTimeout(() => {
            stopQRScanner();
            if (isStartingPuzzle(urlLockedPuzzle)) {
                // Starting puzzle (XG01) — ask for the start key
                showStep('startcode');
            } else {
                // Non-start puzzle — unlock directly, no previous answer asked
                const via = currentPuzzle ? `Puzzle ${currentPuzzle.id}` : 'DIRECT';
                activatePuzzle(urlLockedPuzzle, via);
                showStep(3);
            }
            processingQR = false;
        }, 1500);
    } else {
        console.warn('QR code not recognized:', qrData);
        showToast('❌ Invalid Signal - Access Denied', 'error');

        setTimeout(() => {
            processingQR = false;
        }, 2500);
    }
}
