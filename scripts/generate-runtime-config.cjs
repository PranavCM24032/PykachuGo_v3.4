const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const outputPath = path.join(root, 'js', 'runtime-config.js');
const vercelDefaults = {
    googleScriptUrl: 'https://script.google.com/macros/s/AKfycbwcnuefUGx93H9_s_ZxLzMvH9D2ho72EvD5bnxwfD1FYTOFYuL8OkfFJgm36_kMiGV9/exec',
    googleSheetUrl: 'https://docs.google.com/spreadsheets/d/1sXcAgdp9dDJ9ygx2xkBSdC3HyRlC-5TxDQ_y-Gyrg30/edit?gid=2141514144#gid=2141514144'
};

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
    googleScriptUrl: env.GOOGLE_SCRIPT_URL || (process.env.VERCEL ? vercelDefaults.googleScriptUrl : ''),
    googleScriptToken: env.GOOGLE_SCRIPT_TOKEN || '',
    googleSheetUrl: env.GOOGLE_SHEET_URL || (process.env.VERCEL ? vercelDefaults.googleSheetUrl : '')
};

fs.writeFileSync(
    outputPath,
    `// Generated from .env. Do not commit this file.\nwindow.PYKACHU_RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig, null, 4)};\n`
);

if (!runtimeConfig.googleScriptUrl || !runtimeConfig.googleScriptToken) {
    const message = process.env.VERCEL
        ? 'Runtime config is missing GOOGLE_SCRIPT_TOKEN. Add it to the Vercel project environment variables and redeploy.'
        : 'Runtime config created without Google Sheets settings. Copy .env.example to .env and fill both values.';
    if (process.env.VERCEL) {
        console.error(message);
        process.exitCode = 1;
    } else {
        console.warn(message);
    }
}
