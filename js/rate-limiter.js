// ==============================
// SLIDING WINDOW RATE LIMITER
// Limits outbound API calls to N per
// rolling window, spacing them evenly.
// ==============================

class SlidingWindowRateLimiter {
    /**
     * @param {Object}               opts
     * @param {number}               opts.limit          Max calls per window.
     * @param {number}               opts.windowMs       Window length in ms.
     * @param {number}               [opts.minIntervalMs] Min spacing between calls.
     *                                                   Defaults to windowMs / limit.
     * @param {string|null}          [opts.persistKey]   localStorage key to persist
     *                                                   timestamps across page loads.
     */
    constructor({ limit = 30, windowMs = 60000, minIntervalMs, persistKey = null } = {}) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.minIntervalMs = (minIntervalMs === undefined) ? Math.floor(windowMs / limit) : minIntervalMs;
        this.persistKey = persistKey || null;

        this.timestamps = this._loadTimestamps();
        this._queue = [];
        this._pumping = false;
        this._lastGrant = 0;
        this._prune();
    }

    // ----------------------------
    // Persistence helpers
    // ----------------------------

    _loadTimestamps() {
        if (!this.persistKey) return [];
        try {
            const saved = JSON.parse(localStorage.getItem(this.persistKey) || '[]');
            if (!Array.isArray(saved)) return [];
            return saved.map(Number).filter(n => Number.isFinite(n));
        } catch (e) {
            return [];
        }
    }

    _saveTimestamps() {
        if (!this.persistKey) return;
        try {
            localStorage.setItem(this.persistKey, JSON.stringify(this.timestamps.slice(-this.limit)));
        } catch (e) {
            console.warn('[RateLimiter] Could not persist timestamps:', e);
        }
    }

    // ----------------------------
    // Core sliding window logic
    // ----------------------------

    _prune(now = Date.now()) {
        const cutoff = now - this.windowMs;
        this.timestamps = this.timestamps.filter(t => t > cutoff && t <= now);
        return now;
    }

    /**
     * Resolves with a timestamp token once a slot is free.
     * Serializes callers and spaces them out evenly.
     * @returns {Promise<number>}
     */
    acquire() {
        return new Promise((resolve) => {
            this._queue.push(resolve);
            this._pump();
        });
    }

    /**
     * Non-blocking: returns a timestamp token immediately if a slot is free,
     * otherwise null. For use where we cannot wait (e.g. beforeunload).
     * @returns {number|null}
     */
    tryAcquire() {
        const now = this._prune();
        if (this.timestamps.length >= this.limit) return null;
        const grantAt = Math.max(now, this._lastGrant + this.minIntervalMs);
        this.timestamps.push(grantAt);
        this._lastGrant = grantAt;
        this._saveTimestamps();
        return grantAt;
    }

    _pump() {
        if (this._pumping || this._queue.length === 0) return;
        this._pumping = true;

        const scheduleGrant = () => {
            if (this._queue.length === 0) {
                this._pumping = false;
                return;
            }
            const now = this._prune();

            if (this.timestamps.length >= this.limit) {
                const releasedAt = this.timestamps[0] + this.windowMs + 1;
                setTimeout(scheduleGrant, Math.max(0, releasedAt - Date.now()));
                return;
            }

            const grantAt = Math.max(now, this._lastGrant + this.minIntervalMs);
            const wait = Math.max(0, grantAt - Date.now());
            setTimeout(() => this._grantNext(grantAt), wait);
        };

        scheduleGrant();
    }

    _grantNext(grantAt) {
        this.timestamps.push(grantAt);
        this._lastGrant = grantAt;
        this._saveTimestamps();

        const resolve = this._queue.shift();
        resolve(grantAt);

        this._pumping = false;
        this._pump();
    }
}