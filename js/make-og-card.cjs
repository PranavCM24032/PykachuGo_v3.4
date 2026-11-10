#!/usr/bin/env node
/**
 * Renders html/og-card.html into assets/img/og-card.jpg (1200x630).
 *
 * The card is what WhatsApp, iMessage, Telegram, Slack, Discord, LinkedIn,
 * Facebook and most email clients show when the site link is shared. A real
 * browser is used because the design depends on the same pixel fonts and CRT
 * styling as the live app, which no plain image library can reproduce.
 *
 * Usage: npm run og:card
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'html', 'og-card.html');
const OUTPUT = path.join(ROOT, 'assets', 'img', 'og-card.jpg');
const WIDTH = 1200;
const HEIGHT = 630;
// WhatsApp converts anything above ~300 KB into a tiny thumbnail. JPEG keeps
// this gradient-heavy card well under that while staying visually crisp.
const JPEG_QUALITY = 88;

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const browser = CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!browser) {
  console.error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser binary.');
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) {
  console.error(`Card source not found: ${SOURCE}`);
  process.exit(1);
}

const tempPng = path.join(os.tmpdir(), `pykachu-og-${process.pid}.png`);
const fileUrl = 'file:///' + SOURCE.replace(/\\/g, '/').replace(/^\//, '');
const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=' + WIDTH + ',' + HEIGHT,
  // Give the Google Fonts request time to land before the shot.
  '--virtual-time-budget=8000',
  '--screenshot=' + tempPng,
  fileUrl,
];

const shot = spawnSync(browser, args, { stdio: 'inherit' });
if (shot.status !== 0 || !fs.existsSync(tempPng)) {
  console.error(`Screenshot failed (exit ${shot.status}).`);
  process.exit(shot.status || 1);
}

const psQuote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
let convert;

if (process.platform === 'win32') {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$src = [System.Drawing.Image]::FromFile(${psQuote(tempPng)})`,
    "$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    '$p = New-Object System.Drawing.Imaging.EncoderParameters(1)',
    `$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, ${JPEG_QUALITY}L)`,
    `$src.Save(${psQuote(OUTPUT)}, $enc, $p)`,
    '$src.Dispose()',
  ].join('; ');
  convert = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'inherit',
  });
} else if (spawnSync('which', ['magick']).status === 0) {
  convert = spawnSync('magick', [tempPng, '-quality', String(JPEG_QUALITY), OUTPUT], { stdio: 'inherit' });
} else if (process.platform === 'darwin' && spawnSync('which', ['sips']).status === 0) {
  convert = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_QUALITY), tempPng, '--out', OUTPUT], { stdio: 'inherit' });
} else {
  console.error('No JPEG converter found (install ImageMagick, or run on Windows/macOS).');
  fs.rmSync(tempPng, { force: true });
  process.exit(1);
}

fs.rmSync(tempPng, { force: true });

if (convert.status !== 0 || !fs.existsSync(OUTPUT)) {
  console.error(`JPEG conversion failed (exit ${convert.status}).`);
  process.exit(convert.status || 1);
}

const kb = Math.round(fs.statSync(OUTPUT).size / 1024);
console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${WIDTH}x${HEIGHT}, ${kb} KB)`);
if (kb > 300) {
  console.warn('Heads-up: WhatsApp downgrades images above ~300 KB to a thumbnail.');
}
