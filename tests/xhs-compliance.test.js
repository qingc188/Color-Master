const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('production entry uses only packaged local resources', () => {
    const html = read('index.html');
    const resourceUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    const resourcePaths = resourceUrls.map((url) => url.split(/[?#]/, 1)[0]);

    assert.equal(/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'Inline scripts are forbidden.');
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'Inline event handlers are forbidden.');
    assert.equal(resourceUrls.some((url) => /^(?:https?:)?\/\//i.test(url)), false, 'Remote resources are forbidden.');
    assert.deepEqual(
        resourcePaths.filter((url) => url.endsWith('.css')),
        ['tailwind.css', 'styles.css']
    );
    assert.deepEqual(
        resourcePaths.filter((url) => url.endsWith('.js')),
        ['color-utils.js', 'app.js']
    );
});

test('production code avoids forbidden container APIs', () => {
    const source = [read('index.html'), read('app.js'), read('color-utils.js'), read('styles.css')].join('\n');
    const forbiddenPatterns = [
        /\bfetch\s*\(/,
        /\bXMLHttpRequest\b/,
        /\bWebSocket\b/,
        /\bEventSource\b/,
        /\b(?:Shared|Service)?Worker\s*\(/,
        /\bWebAssembly\b/,
        /\beval\s*\(/,
        /\bnew\s+Function\b/,
        /<iframe\b/i,
        /<object\b/i,
        /\bwindow\.open\s*\(/,
        /\brequestFullscreen\s*\(/
    ];

    forbiddenPatterns.forEach((pattern) => {
        assert.equal(pattern.test(source), false, `Forbidden pattern found: ${pattern}`);
    });
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
    assert.match(html, /id="score-info-dialog"[^>]+role="dialog"[^>]+aria-modal="true"/);
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
