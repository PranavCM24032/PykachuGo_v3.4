const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const outputPath = path.join(root, 'js', 'runtime-config.js');

function readEnv(filePath) {
    if (!fs.existsSync(filePath)) return {};

    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .reduce((values, rawLine) => {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) return values;
            const separator = line.indexOf('=');
            if (separator < 1) return values;
            const key = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
            values[key] = value;
            return values;
        }, {});
}

const env = { ...readEnv(envPath) };
['GOOGLE_SCRIPT_URL', 'GOOGLE_SCRIPT_TOKEN', 'GOOGLE_SHEET_URL'].forEach((key) => {
    if (process.env[key]) env[key] = process.env[key];
});

const runtimeConfig = {
    googleScriptUrl: (env.GOOGLE_SCRIPT_URL || '').trim(),
    googleScriptToken: (env.GOOGLE_SCRIPT_TOKEN || '').trim(),
    googleSheetUrl: (env.GOOGLE_SHEET_URL || '').trim()
};

fs.writeFileSync(
    outputPath,
    `// Generated from environment. Do not commit this file.\nwindow.PYKACHU_RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig, null, 4)};\n`
);

if (!runtimeConfig.googleScriptUrl || !runtimeConfig.googleScriptToken) {
    const message = process.env.VERCEL
        ? '[Build] Warning: Runtime config generated without GOOGLE_SCRIPT_URL or GOOGLE_SCRIPT_TOKEN. Add them in Vercel Project Settings > Environment Variables for backend connectivity.'
        : '[Build] Warning: Runtime config created without Google Sheets settings. Provide them via environment variables or .env for backend scoring.';
    console.warn(message);
} else {
    console.log('[Build] Runtime config generated successfully.');
}
