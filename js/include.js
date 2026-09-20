(async function () {
    const includes = Array.from(document.querySelectorAll('[data-include]'));

    if (includes.length > 0) {
        // Fetch all remaining partials in parallel if any are present
        const results = await Promise.all(
            includes.map(async (el) => {
                const url = el.getAttribute('data-include');
                try {
                    const response = await fetch(url);
                    return response.ok ? await response.text() : '';
                } catch (e) {
                    console.error('Include failed:', url, e);
                    return '';
                }
            })
        );

        includes.forEach((el, i) => {
            if (results[i]) el.insertAdjacentHTML('afterend', results[i]);
            el.remove();
        });
    }

    // Signal to all scripts that the DOM partials are ready
    window._includesReady = true;
    document.dispatchEvent(new Event('includes:ready'));
})();