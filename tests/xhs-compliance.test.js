const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('production entry uses only packaged local resources', () => {
    const html = read('index.html');
    const scripts = `${read('color-utils.js')}\n${read('app.js')}`;
    const resourceUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    const resourcePaths = resourceUrls.map((url) => url.split(/[?#]/, 1)[0]);

    assert.match(html, /^\uFEFF?<!DOCTYPE html>/i);
    assert.match(html, /<html\b[^>]*\blang="zh-CN"/i);
    assert.match(html, /<meta\b[^>]*\bcharset="UTF-8"/i);
    assert.match(html, /<meta\b[^>]*\bname="viewport"[^>]*\bcontent="[^"]*width=device-width[^"]*initial-scale=1\.0[^"]*viewport-fit=cover/i);
    assert.equal(/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'Inline scripts are forbidden.');
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'Inline event handlers are forbidden.');
    assert.equal(/<script\b[^>]*\btype=["']module["']/i.test(html), false, 'Module scripts are forbidden.');
    assert.equal(/<base\b/i.test(html), false, 'A base URL breaks packaged relative paths.');
    assert.equal(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["']/i.test(html), false, 'The container owns the CSP.');
    assert.equal(/\bjavascript:/i.test(html), false, 'javascript: URLs are forbidden.');
    assert.equal(resourceUrls.some((url) => /^(?:https?:)?\/\//i.test(url)), false, 'Remote resources are forbidden.');
    assert.equal(resourceUrls.some((url) => /^\//.test(url)), false, 'Absolute resource paths are forbidden.');
    assert.equal(/^\s*(?:import|export)\b/m.test(scripts), false, 'Production scripts must remain classic scripts.');
    assert.deepEqual(
        resourcePaths.filter((url) => url.endsWith('.css')),
        ['tailwind.css', 'styles.css']
    );
    assert.deepEqual(
        resourcePaths.filter((url) => url.endsWith('.js')),
        ['color-utils.js', 'app.js']
    );
    assert.equal(
        resourceUrls.filter((url) => /\.(?:css|js)(?:[?#]|$)/i.test(url))
            .every((url) => /[?&]v=/.test(url)),
        true,
        'Production CSS and JavaScript resources must be cache-versioned.'
    );
});

test('startup shell degrades safely in older WebViews', () => {
    const html = read('index.html');
    const app = read('app.js');
    const styles = read('styles.css');

    assert.match(html, /id="game-info-bar"\s+class="[^"]*\bhidden\b/);
    assert.match(styles, /\.hidden\s*{[^}]*display:\s*none\s*!important;/s);
    assert.match(styles, /\.landing-title\s*{[^}]*font-size:\s*4rem;[^}]*font-size:\s*clamp\(/s);
    assert.match(styles, /\.landing-palette-link\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*appearance:\s*none;/s);
    assert.equal(/\?\.|\?\?/.test(app), false, 'Production JavaScript must avoid ES2020 optional operators.');
    assert.equal(/\.replaceChildren\s*\(/.test(app), false, 'replaceChildren is unavailable in older WebViews.');
    assert.match(app, /document\.readyState === 'loading'/);
});

test('production code avoids forbidden container APIs', () => {
    const source = [read('index.html'), read('app.js'), read('color-utils.js'), read('styles.css')].join('\n');
    const forbiddenPatterns = [
        /\bfetch\s*\(/,
        /\bXMLHttpRequest\b/,
        /\bWebSocket\b/,
        /\bEventSource\b/,
        /\bRTCPeerConnection\b/,
        /\b(?:Shared|Service)?Worker\s*\(/,
        /\b(?:Accelerometer|Gyroscope|Magnetometer)\s*\(/,
        /\b(?:PaymentRequest|Notification|NDEFReader|SharedArrayBuffer|OffscreenCanvas)\b/,
        /\bWebAssembly\b/,
        /\beval\s*\(/,
        /\bnew\s+Function\b/,
        /\bdocument\.execCommand\s*\(\s*["'](?:copy|cut|paste)["']/,
        /<iframe\b/i,
        /<object\b/i,
        /\bwindow\.open\s*\(/,
        /\bwindow\.prompt\s*\(/,
        /\bnavigator\.(?:geolocation|clipboard|bluetooth|usb|hid|serial|getBattery|connection|credentials|locks)\b/,
        /\bnavigator\.mediaDevices\.(?:enumerateDevices|getDisplayMedia)\b/,
        /\bnavigator\.storage\.persist\s*\(/,
        /\bnavigator\.serviceWorker\.register\s*\(/,
        /\b(?:DeviceMotionEvent|DeviceOrientationEvent)\b/,
        /\b(?:requestFullscreen|webkitRequestFullscreen)\s*\(/,
        /\blocation\.(?:href\s*=|assign\s*\()/,
        /\btarget\s*=\s*["']_blank["']/i,
        /<a\b[^>]*\bdownload(?:\s|=|>)/i,
        /<form\b/i
    ];

    forbiddenPatterns.forEach((pattern) => {
        assert.equal(pattern.test(source), false, `Forbidden pattern found: ${pattern}`);
    });
});

test('safe areas support both the simulator and real devices', () => {
    const styles = read('styles.css');
    const safeAreaUses = [...styles.matchAll(/env\(safe-area-inset-(top|right|bottom|left),\s*0px\)/g)];

    assert.ok(safeAreaUses.length > 0, 'Expected safe-area handling in the production stylesheet.');
    safeAreaUses.forEach((match) => {
        const edge = match[1];
        const prefix = styles.slice(Math.max(0, match.index - 50), match.index);
        assert.match(
            prefix,
            new RegExp(`var\\(--safe-area-inset-${edge},\\s*$`),
            `safe-area-inset-${edge} must prefer the simulator variable before env().`
        );
    });
    assert.equal(
        /env\(safe-area-inset-(?:top|right|bottom|left)\)(?!\s*,)/.test(styles),
        false,
        'Safe-area env() calls must include a 0px fallback.'
    );
});

test('compiled Tailwind stylesheet is present and self-contained', () => {
    const tailwind = read('tailwind.css');

    assert.ok(tailwind.length > 10000, 'Compiled Tailwind output is unexpectedly small.');
    assert.equal(/@tailwind\b/.test(tailwind), false, 'Tailwind directives were not compiled.');
    assert.equal(/url\(\s*['"]?https?:\/\//i.test(tailwind), false, 'Compiled CSS loads a remote URL.');
    assert.equal(/@import\b/i.test(tailwind), false, 'Compiled CSS contains an import.');
});

test('container fallbacks avoid fragile native behavior', () => {
    const html = read('index.html');
    const app = read('app.js');
    const storageCalls = app.match(/\blocalStorage\.(?:getItem|setItem|removeItem)\s*\(/g) || [];

    assert.equal(/<dialog\b/i.test(html), false, 'Native dialog is not reliable in every target WebView.');
    assert.doesNotMatch(
        html,
        /id\s*=\s*["']score-info-(?:button|dialog)["']/,
        'Removed score explanation controls must not remain in the HTML.'
    );
    assert.doesNotMatch(
        app,
        /score-info|\b(?:scoreInfo\w*|\w*ScoreInfo\w*)\b/,
        'Removed score explanation functions and names must not remain in the app.'
    );
    assert.equal(/\bshowModal\s*\(/.test(app), false, 'Native dialog methods must not be used.');
    assert.equal(storageCalls.length, 3, 'Persistent storage must only be accessed inside its three safe wrappers.');
    assert.match(app, /function getStorageItem\s*\(/);
    assert.match(app, /function setStorageItem\s*\(/);
    assert.match(app, /function removeStorageItem\s*\(/);
    assert.equal(/paletteInspector\w*\.innerHTML\s*=/.test(app), false, 'Persisted color details must not use innerHTML.');
    assert.equal(/function showColorCodeTooltip\s*\(/.test(app), false, 'Color details should use the in-page inspector.');
    assert.equal(/(?:sound-toggle|icon-volume-(?:up|off))/.test(html), false, 'Audio controls must stay removed until audio is available.');
    assert.match(app, /function playSound\s*\(/, 'Short Web Audio feedback should remain available.');
});

test('theme cube stays local, semantic, and WebView-safe', () => {
    const html = read('index.html');
    const app = read('app.js');
    const styles = read('styles.css');
    const cubeFaces = [...html.matchAll(/<span class="theme-cube-face[^"]*">((?:<i><\/i>){4})<\/span>/g)];

    assert.match(html, /<button id="theme-cube-button"[^>]+aria-label="[^"]+"/);
    assert.equal(cubeFaces.length, 6, 'The hero cube must expose six faces with four color tiles each.');
    assert.match(app, /setStorageItem\(THEME_STORAGE_KEY,/);
    assert.match(styles, /transform-style:\s*preserve-3d/);
    assert.match(styles, /\.theme-cube-stage\s*{[^}]*display:\s*none;/s);
    assert.match(styles, /\.theme-cube-fallback\s*{[^}]*display:\s*block;/s);
    assert.match(styles, /@supports \(transform-style:\s*preserve-3d\)/);
    assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
    assert.equal(/\b(?:WebGL|THREE|canvas|getContext)\b/.test(`${html}\n${app}`), false);
});
