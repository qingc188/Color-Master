const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

const EDGE_PATHS = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForJson(url, timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return response.json();
        } catch {
            // Edge may need a moment to expose the debugging endpoint.
        }
        await delay(100);
    }
    throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
    constructor(socketUrl) {
        this.nextId = 1;
        this.pending = new Map();
        this.exceptions = [];
        this.remoteRequests = [];
        this.ready = new Promise((resolve, reject) => {
            this.socket = new WebSocket(socketUrl);
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject);
            this.socket.addEventListener('message', (event) => {
                const message = JSON.parse(event.data);
                if (message.method === 'Runtime.exceptionThrown') {
                    this.exceptions.push(message.params.exceptionDetails);
                }
                if (message.method === 'Network.requestWillBeSent'
                    && /^https?:/i.test(message.params.request.url)) {
                    this.remoteRequests.push(message.params.request.url);
                }
                if (!message.id) return;
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            });
        });
    }

    async send(method, params = {}) {
        await this.ready;
        const id = this.nextId++;
        const response = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        this.socket.send(JSON.stringify({ id, method, params }));
        return response;
    }

    close() {
        this.socket.close();
    }
}

async function evaluate(client, expression) {
    const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    });
    if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description
            || result.exceptionDetails.text
            || 'Browser evaluation failed.';
        throw new Error(detail);
    }
    return result.result.value;
}

async function waitFor(client, predicate, timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await evaluate(client, `Boolean(${predicate})`)) return;
        await delay(100);
    }
    throw new Error(`Timed out waiting for ${predicate}`);
}

async function navigate(client, url) {
    await client.send('Page.navigate', { url: `${url}?test=${Date.now()}` });
    await waitFor(client, 'document.readyState === "complete"');
    await waitFor(client, 'typeof gameState !== "undefined" && document.querySelector("#enter-game-button")');
}

async function openRecallControl(client, appUrl, difficulty) {
    await navigate(client, appUrl);
    await evaluate(client, `document.querySelector('#enter-game-button').click()`);
    await waitFor(client, `!document.querySelector('#mode-selection-screen').classList.contains('hidden')`);
    await evaluate(client, `document.querySelector('#color-recall-mode').click()`);
    await waitFor(client, `!document.querySelector('#recall-difficulty-screen').classList.contains('hidden')`);
    await evaluate(client, `document.querySelector('[data-recall-difficulty="${difficulty}"]').click()`);
    await waitFor(client, `!document.querySelector('#start-screen').classList.contains('hidden')`);
    await evaluate(client, `
        document.querySelector('#start-button').click();
        stopActiveCountdown();
        showRecallSection(elements.recallControlSection);
        requestAnimationFrame(updateHSLPointerPosition);
    `);
    await waitFor(client, `!document.querySelector('#recall-control-section').classList.contains('hidden')`);
    await waitFor(client, `document.activeElement.id === 'recall-control-title'`);
}

async function openObservation(client, appUrl, mode) {
    const isRecall = mode === 'recall';
    const modeSelector = isRecall ? '#color-recall-mode' : '#color-match-mode';
    const difficultyScreen = isRecall ? '#recall-difficulty-screen' : '#match-difficulty-screen';
    const difficultySelector = isRecall
        ? '[data-recall-difficulty="basic"]'
        : '[data-match-difficulty="basic"]';
    const observationSelector = isRecall ? '#recall-target-section' : '#target-color-screen';

    await navigate(client, appUrl);
    await evaluate(client, `document.querySelector('#enter-game-button').click()`);
    await waitFor(client, `!document.querySelector('#mode-selection-screen').classList.contains('hidden')`);
    await evaluate(client, `document.querySelector('${modeSelector}').click()`);
    await waitFor(client, `!document.querySelector('${difficultyScreen}').classList.contains('hidden')`);
    await evaluate(client, `document.querySelector('${difficultySelector}').click()`);
    await waitFor(client, `!document.querySelector('#start-screen').classList.contains('hidden')`);
    await evaluate(client, `document.querySelector('#start-button').click(); stopActiveCountdown();`);
    await waitFor(client, `!document.querySelector('${observationSelector}').classList.contains('hidden')`);
}

async function captureScreenshot(client, name) {
    const captureDirectory = process.env.UI_CAPTURE_DIR;
    const captureFilter = process.env.UI_CAPTURE_FILTER;
    if (!captureDirectory || (captureFilter && !name.includes(captureFilter))) return;
    await delay(600);
    const screenshot = await client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true
    });
    fs.writeFileSync(path.join(captureDirectory, name), Buffer.from(screenshot.data, 'base64'));
}

async function collectFinalZoomReport(client) {
    return evaluate(client, `({
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.visualViewport?.height || window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        score: elements.finalPrimaryValue.textContent,
        average: elements.finalStatOneValue.textContent,
        restartLabel: elements.restartButton.textContent,
        changeDifficultyVisible: !elements.resultChangeDifficulty.classList.contains('hidden'),
        scorePanelFits: document.querySelector('.final-summary').scrollWidth
            <= document.querySelector('.final-summary').clientWidth,
        statsFit: Array.from(document.querySelectorAll('.final-stats > div')).every((stat) => (
            stat.scrollWidth <= stat.clientWidth
        )),
        recapVisible: !elements.sessionRecap.classList.contains('hidden'),
        footerHidden: elements.siteFooter.classList.contains('hidden'),
        brandHidden: elements.brandHeader.classList.contains('hidden'),
        shellParts: Array.from(elements.resultScreen.querySelectorAll('[data-final-part]'))
            .map((part) => part.dataset.finalPart),
        overflowElements: Array.from(document.querySelectorAll('body *')).flatMap((element) => {
            const rect = element.getBoundingClientRect();
            if (rect.width && (rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5)) {
                return [{
                    tag: element.tagName,
                    id: element.id,
                    className: String(element.className),
                    left: rect.left,
                    right: rect.right,
                    width: rect.width
                }];
            }
            return [];
        })
    })`);
}

async function run() {
    if (typeof WebSocket === 'undefined') {
        throw new Error('Browser regression requires Node.js 22 or newer.');
    }
    const stylesSource = fs.readFileSync(path.resolve(__dirname, '..', 'styles.css'), 'utf8');
    const titleFontBlocksFallback = /@font-face\s*\{(?=[^}]*font-family:\s*"Yise QingKe Title")(?=[^}]*font-display:\s*block;)[^}]*\}/s
        .test(stylesSource);
    if (!titleFontBlocksFallback) {
        throw new Error('Title font must block fallback rendering during its preload window.');
    }
    const edgePath = EDGE_PATHS.find((candidate) => fs.existsSync(candidate));
    if (!edgePath) {
        throw new Error('Microsoft Edge was not found. Set BROWSER_PATH to a Chromium executable.');
    }

    const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'color-memory-regression-'));
    const debuggingPort = await findFreePort();
    const browser = spawn(edgePath, [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${profilePath}`,
        'about:blank'
    ], { stdio: 'ignore' });
    let client;

    try {
        const tabs = await waitForJson(`http://127.0.0.1:${debuggingPort}/json/list`);
        const tab = tabs.find((item) => item.type === 'page');
        if (!tab) throw new Error('No debuggable Edge page was created.');
        client = new CdpClient(tab.webSocketDebuggerUrl);
        await client.send('Runtime.enable');
        await client.send('Page.enable');
        await client.send('Network.enable');
        await client.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });

        const appUrl = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
        const blockedInitScript = await client.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `(() => {
                const nativeAddEventListener = window.addEventListener;
                window.addEventListener = function addEventListener(type, listener, options) {
                    if (type === 'DOMContentLoaded' && listener && listener.name === 'initGame') return;
                    return nativeAddEventListener.call(this, type, listener, options);
                };
            })();`
        });
        await navigate(client, appUrl);
        const startupFailClosedReport = await evaluate(client, `(() => {
            const palette = elements.colorHistoryEntry;
            const paletteStyle = getComputedStyle(palette);
            return {
                gameInfoHidden: elements.gameInfoBar.classList.contains('hidden'),
                gameInfoDisplay: getComputedStyle(elements.gameInfoBar).display,
                visibleMainScreens: mainScreens.filter((screen) => !screen.classList.contains('hidden')).length,
                landingVisible: !elements.landingScreen.classList.contains('hidden'),
                paletteAppearance: paletteStyle.appearance,
                paletteBackground: paletteStyle.backgroundColor,
                paletteBorderStyle: paletteStyle.borderStyle
            };
        })()`);
        if (!startupFailClosedReport.gameInfoHidden
            || startupFailClosedReport.gameInfoDisplay !== 'none'
            || startupFailClosedReport.visibleMainScreens !== 1
            || !startupFailClosedReport.landingVisible
            || startupFailClosedReport.paletteAppearance !== 'none'
            || startupFailClosedReport.paletteBackground !== 'rgba(0, 0, 0, 0)'
            || startupFailClosedReport.paletteBorderStyle !== 'none') {
            throw new Error(`Startup fail-closed layout failed: ${JSON.stringify(startupFailClosedReport)}`);
        }
        await client.send('Page.removeScriptToEvaluateOnNewDocument', {
            identifier: blockedInitScript.identifier
        });
        await navigate(client, appUrl);
        await evaluate(client, `
            localStorage.setItem('colorMemoryBestRecallScore_advanced', '99');
            localStorage.setItem('colorMemoryBestRecallScore_advanced_oklab_v2', '88');
            localStorage.setItem('colorMemoryBestRecallScore_advanced_oklab_v3', '77');
        `);
        await navigate(client, appUrl);
        const legacyIsolationReport = await evaluate(client, `({
            loadedV4Best: gameState.recallBestScores.advanced,
            storedV3: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v3'),
            storedV2: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v2'),
            legacyValue: localStorage.getItem('colorMemoryBestRecallScore_advanced')
        })`);
        if (legacyIsolationReport.loadedV4Best !== 0
            || legacyIsolationReport.storedV3 !== '77'
            || legacyIsolationReport.storedV2 !== '88'
            || legacyIsolationReport.legacyValue !== '99') {
            throw new Error(`Legacy score isolation failed: ${JSON.stringify(legacyIsolationReport)}`);
        }

        const blockedStorageScript = await client.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `Object.defineProperty(window, 'localStorage', {
                configurable: true,
                get() { throw new DOMException('Storage blocked', 'SecurityError'); }
            });`
        });
        await navigate(client, appUrl);
        const startupStorageFailureReport = await evaluate(client, `({
            appLoaded: Boolean(elements.enterGameButton && gameState.colorHistory),
            storageAvailable,
            statusVisible: !elements.storageStatus.classList.contains('hidden')
        })`);
        if (!startupStorageFailureReport.appLoaded
            || startupStorageFailureReport.storageAvailable
            || !startupStorageFailureReport.statusVisible) {
            throw new Error(`Startup storage fallback failed: ${JSON.stringify(startupStorageFailureReport)}`);
        }
        await evaluate(client, `elements.themeCubeButton.click()`);
        await waitFor(client, `document.documentElement.dataset.theme === 'amethyst'`);
        await waitFor(client, `!elements.themeCubeButton.hasAttribute('aria-busy')`);
        const blockedStorageThemeReport = await evaluate(client, `({
            theme: document.documentElement.dataset.theme,
            storageAvailable,
            statusVisible: !elements.storageStatus.classList.contains('hidden')
        })`);
        if (blockedStorageThemeReport.theme !== 'amethyst'
            || blockedStorageThemeReport.storageAvailable
            || !blockedStorageThemeReport.statusVisible) {
            throw new Error(`Blocked-storage theme fallback failed: ${JSON.stringify(blockedStorageThemeReport)}`);
        }
        await client.send('Page.removeScriptToEvaluateOnNewDocument', {
            identifier: blockedStorageScript.identifier
        });
        await navigate(client, appUrl);

        const storageFailureReport = await evaluate(client, `(async () => {
            const prototype = Storage.prototype;
            const originalGetItem = prototype.getItem;
            const originalSetItem = prototype.setItem;
            const originalRemoveItem = prototype.removeItem;
            let readResult;
            let writeResult;
            let removeResult;
            try {
                prototype.getItem = () => { throw new Error('read blocked'); };
                storageAvailable = true;
                readResult = getStorageItem('blocked');
                prototype.getItem = originalGetItem;

                prototype.setItem = () => { throw new Error('write blocked'); };
                storageAvailable = true;
                writeResult = setStorageItem('blocked', 'value');
                gameState.colorHistory = [];
                storageAvailable = true;
                addToColorHistory('rgb(94, 200, 194)');
                prototype.setItem = originalSetItem;

                prototype.removeItem = () => { throw new Error('remove blocked'); };
                storageAvailable = true;
                removeResult = removeStorageItem('blocked');
            } finally {
                prototype.getItem = originalGetItem;
                prototype.setItem = originalSetItem;
                prototype.removeItem = originalRemoveItem;
            }
            return {
                readResult,
                writeResult,
                removeResult,
                inMemoryColors: gameState.colorHistory.length,
                statusVisible: !elements.storageStatus.classList.contains('hidden'),
                statusText: elements.storageStatus.textContent.replace(/\\s+/g, ' ').trim()
            };
        })()`);
        if (storageFailureReport.readResult !== null
            || storageFailureReport.writeResult !== false
            || storageFailureReport.removeResult !== false
            || storageFailureReport.inMemoryColors !== 1
            || !storageFailureReport.statusVisible
            || !storageFailureReport.statusText.includes('本局仍可正常游戏')) {
            throw new Error(`Storage fallback failed: ${JSON.stringify(storageFailureReport)}`);
        }
        await navigate(client, appUrl);

        const audioFailureReport = await evaluate(client, `(async () => {
            const originalAudioContext = window.AudioContext;
            const originalWebkitAudioContext = window.webkitAudioContext;
            const results = {};
            try {
                window.webkitAudioContext = undefined;
                window.AudioContext = class { constructor() { throw new Error('construction blocked'); } };
                audioContext = undefined;
                playSound('correct');
                results.constructionSafe = audioContext === undefined;

                window.AudioContext = class {
                    constructor() { this.state = 'suspended'; }
                    resume() { return Promise.reject(new Error('resume blocked')); }
                };
                audioContext = undefined;
                playSound('correct');
                await new Promise((resolve) => setTimeout(resolve, 0));
                results.resumeSafe = audioContext === undefined;

                window.AudioContext = class {
                    constructor() { this.state = 'running'; this.currentTime = 0; }
                    createOscillator() { throw new Error('playback blocked'); }
                };
                audioContext = undefined;
                playSound('correct');
                results.playbackSafe = audioContext === undefined;
            } finally {
                window.AudioContext = originalAudioContext;
                window.webkitAudioContext = originalWebkitAudioContext;
                audioContext = undefined;
            }
            return results;
        })()`);
        if (!audioFailureReport.constructionSafe
            || !audioFailureReport.resumeSafe
            || !audioFailureReport.playbackSafe) {
            throw new Error(`Audio fallback failed: ${JSON.stringify(audioFailureReport)}`);
        }

        await evaluate(client, `document.fonts.ready`);
        const homepageReport = await evaluate(client, `(() => {
            const fontPreload = document.querySelector(
                'link[rel="preload"][as="font"][type="font/woff2"][href$="zcool-qingke-huangyou-yise.woff2"]'
            );
            const firstStylesheet = document.querySelector('link[rel="stylesheet"]');
            return {
                secondaryGuideRemoved: !document.querySelector('.landing-secondary')
                    && !document.querySelector('#game-guide'),
                supportingContentRemoved: !document.querySelector('#supporting-content'),
                paletteEntryTag: elements.colorHistoryEntry.tagName,
                paletteCount: elements.landingHistoryCount.textContent,
                titleFontFamily: getComputedStyle(document.querySelector('.landing-title')).fontFamily,
                titleFontWeight: getComputedStyle(document.querySelector('.landing-title')).fontWeight,
                titleFontLoaded: document.fonts.check('400 64px "Yise QingKe Title"', '忆色'),
                titleFontPreloaded: Boolean(fontPreload),
                titleFontPreloadBeforeStyles: Boolean(fontPreload
                    && firstStylesheet
                    && (fontPreload.compareDocumentPosition(firstStylesheet) & Node.DOCUMENT_POSITION_FOLLOWING)),
                audioControlsRemoved: !document.querySelector('#sound-toggle')
                    && !document.querySelector('#icon-volume-up')
                    && !document.querySelector('#icon-volume-off')
            };
        })()`);
        homepageReport.titleFontBlocksFallback = titleFontBlocksFallback;
        if (!homepageReport.secondaryGuideRemoved
            || !homepageReport.supportingContentRemoved
            || homepageReport.paletteEntryTag !== 'BUTTON'
            || homepageReport.paletteCount !== '0'
            || !homepageReport.titleFontFamily.includes('Yise QingKe Title')
            || homepageReport.titleFontWeight !== '400'
            || !homepageReport.titleFontLoaded
            || !homepageReport.titleFontPreloaded
            || !homepageReport.titleFontPreloadBeforeStyles
            || !homepageReport.titleFontBlocksFallback
            || !homepageReport.audioControlsRemoved) {
            throw new Error(`Homepage simplification failed: ${JSON.stringify(homepageReport)}`);
        }
        const desktopShellReport = await evaluate(client, `(() => {
            const footer = document.querySelector('.site-footer');
            const main = document.querySelector('.app-container > main');
            const screens = [
                elements.landingScreen,
                elements.modeSelectionScreen,
                elements.matchDifficultyScreen,
                elements.startScreen
            ];
            const measurements = screens.map((screen) => {
                showScreen(screen);
                const screenRect = screen.getBoundingClientRect();
                const mainRect = main.getBoundingClientRect();
                const footerRect = footer.getBoundingClientRect();
                const isDifficultyScreen = screen === elements.matchDifficultyScreen;
                const gameInfoRect = elements.gameInfoBar.getBoundingClientRect();
                const layoutTop = isDifficultyScreen ? Math.min(gameInfoRect.top, screenRect.top) : screenRect.top;
                const layoutBottom = isDifficultyScreen ? Math.max(gameInfoRect.bottom, screenRect.bottom) : screenRect.bottom;
                return {
                    screen: screen.id,
                    layoutCenter: (layoutTop + layoutBottom) / 2,
                    mainCenter: (mainRect.top + mainRect.bottom) / 2,
                    statsGap: isDifficultyScreen ? screenRect.top - gameInfoRect.bottom : null,
                    footerTop: footerRect.top,
                    footerBottom: footerRect.bottom
                };
            });
            const measureScoreboard = (panel) => {
                const barStyle = getComputedStyle(elements.gameInfoBar);
                const panelStyle = getComputedStyle(panel);
                const cell = panel.children[0];
                const cellStyle = getComputedStyle(cell);
                const separator = getComputedStyle(panel.children[1], '::before');
                return {
                    height: elements.gameInfoBar.getBoundingClientRect().height,
                    barPaddingTop: barStyle.paddingTop,
                    barPaddingBottom: barStyle.paddingBottom,
                    gap: panelStyle.columnGap,
                    cellPaddingTop: cellStyle.paddingTop,
                    cellPaddingBottom: cellStyle.paddingBottom,
                    labelFontSize: getComputedStyle(cell.children[0]).fontSize,
                    labelLineHeight: getComputedStyle(cell.children[0]).lineHeight,
                    valueFontSize: getComputedStyle(cell.children[1]).fontSize,
                    valueLineHeight: getComputedStyle(cell.children[1]).lineHeight,
                    separatorWidth: separator.width,
                    separatorHeight: separator.height,
                    separatorContent: separator.content
                };
            };
            showScreen(elements.matchDifficultyScreen);
            const overviewScoreboard = measureScoreboard(elements.modeBestOverview);
            const desktopDifficultyTypography = {
                heading: getComputedStyle(elements.matchDifficultyScreen.querySelector(':scope > h2')).fontSize,
                cardHeading: getComputedStyle(document.querySelector('[data-match-difficulty="basic"] h3')).fontSize,
                cardBody: getComputedStyle(document.querySelector('[data-match-difficulty="basic"] > p')).fontSize
            };
            showScreen(elements.targetColorScreen);
            const gameScoreboard = measureScoreboard(elements.gameStatsPanel);
            showScreen(elements.matchDifficultyScreen);
            const overviewSeparator = getComputedStyle(elements.modeBestOverview.children[1], '::before');
            showScreen(elements.landingScreen);
            const backButtonHeights = Array.from(document.querySelectorAll('.back-button'))
                .map((button) => parseFloat(getComputedStyle(button).minHeight));
            return {
                viewportHeight: window.innerHeight,
                footerPosition: getComputedStyle(footer).position,
                measurements,
                scoreboards: { overviewScoreboard, gameScoreboard },
                desktopDifficultyTypography,
                overviewSeparator: {
                    width: overviewSeparator.width,
                    height: overviewSeparator.height,
                    content: overviewSeparator.content
                },
                backButtonHeights
            };
        })()`);
        const desktopFooterTops = desktopShellReport.measurements.map(({ footerTop }) => footerTop);
        const desktopScoreboardsMatch = JSON.stringify(desktopShellReport.scoreboards.overviewScoreboard)
            === JSON.stringify(desktopShellReport.scoreboards.gameScoreboard);
        if (desktopShellReport.footerPosition !== 'static'
            || desktopShellReport.measurements.some(({ footerBottom }) => (
                footerBottom > desktopShellReport.viewportHeight + 1
            ))
            || Math.max(...desktopFooterTops) - Math.min(...desktopFooterTops) > 1
            || desktopShellReport.measurements.some(({ layoutCenter, mainCenter }) => (
                Math.abs(layoutCenter - mainCenter) > 1
            ))
            || desktopShellReport.measurements.some(({ statsGap }) => statsGap !== null && statsGap < 16)
            || desktopShellReport.overviewSeparator.width !== '1px'
            || desktopShellReport.overviewSeparator.height !== '20px'
            || desktopShellReport.overviewSeparator.content === 'none'
            || !desktopScoreboardsMatch
            || desktopShellReport.scoreboards.gameScoreboard.height > 70
            || desktopShellReport.scoreboards.gameScoreboard.barPaddingTop !== '4px'
            || desktopShellReport.scoreboards.gameScoreboard.cellPaddingTop !== '4px'
            || desktopShellReport.desktopDifficultyTypography.heading !== '30px'
            || desktopShellReport.desktopDifficultyTypography.cardHeading !== '20px'
            || desktopShellReport.desktopDifficultyTypography.cardBody !== '16px'
            || desktopShellReport.backButtonHeights.some((height) => height !== 36)) {
            throw new Error(`Desktop shell layout failed: ${JSON.stringify(desktopShellReport)}`);
        }
        await evaluate(client, `showScreen(elements.matchDifficultyScreen)`);
        await captureScreenshot(client, 'difficulty-desktop.png');
        await evaluate(client, `elements.localRecordHint.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }))`);
        await captureScreenshot(client, 'difficulty-hint-desktop.png');
        await evaluate(client, `elements.localRecordHint.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', bubbles: true }))`);
        await evaluate(client, `showScreen(elements.landingScreen)`);
        await captureScreenshot(client, 'landing-desktop.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });
        const mobileScoreboardReport = await evaluate(client, `(() => {
            const measureScoreboard = (panel) => {
                const barStyle = getComputedStyle(elements.gameInfoBar);
                const cell = panel.children[0];
                const cellStyle = getComputedStyle(cell);
                const separator = getComputedStyle(panel.children[1], '::before');
                return {
                    height: elements.gameInfoBar.getBoundingClientRect().height,
                    barPaddingTop: barStyle.paddingTop,
                    barPaddingBottom: barStyle.paddingBottom,
                    gap: getComputedStyle(panel).columnGap,
                    cellPaddingTop: cellStyle.paddingTop,
                    cellPaddingBottom: cellStyle.paddingBottom,
                    labelFontSize: getComputedStyle(cell.children[0]).fontSize,
                    labelLineHeight: getComputedStyle(cell.children[0]).lineHeight,
                    valueFontSize: getComputedStyle(cell.children[1]).fontSize,
                    valueLineHeight: getComputedStyle(cell.children[1]).lineHeight,
                    separatorWidth: separator.width,
                    separatorHeight: separator.height,
                    separatorContent: separator.content
                };
            };
            showScreen(elements.matchDifficultyScreen);
            const overviewScoreboard = measureScoreboard(elements.modeBestOverview);
            showScreen(elements.targetColorScreen);
            const gameScoreboard = measureScoreboard(elements.gameStatsPanel);
            showScreen(elements.landingScreen);
            return { overviewScoreboard, gameScoreboard };
        })()`);
        if (mobileScoreboardReport.gameScoreboard.height > 48
            || mobileScoreboardReport.gameScoreboard.barPaddingTop !== '2px'
            || mobileScoreboardReport.gameScoreboard.labelFontSize !== '11px'
            || mobileScoreboardReport.gameScoreboard.valueFontSize !== '16px'
            || mobileScoreboardReport.overviewScoreboard.height > 46
            || mobileScoreboardReport.overviewScoreboard.labelFontSize !== '10.25px'
            || mobileScoreboardReport.overviewScoreboard.valueFontSize !== '15px') {
            throw new Error(`Mobile scoreboard consistency failed: ${JSON.stringify(mobileScoreboardReport)}`);
        }
        const homepageMobileReport = await evaluate(client, `(() => {
            const primary = elements.enterGameButton.getBoundingClientRect();
            const paletteEntry = elements.colorHistoryEntry.getBoundingClientRect();
            const brandName = document.querySelector('.brand-name');
            const brandTitle = brandName.querySelector(':scope > span');
            const footer = document.querySelector('.site-footer');
            const landing = elements.landingScreen;
            const landingStyle = getComputedStyle(landing);
            const actions = document.querySelector('.landing-actions').getBoundingClientRect();
            const english = document.querySelector('.landing-english');
            const paletteIndicator = document.querySelector('.theme-palette-indicator');
            const footerText = footer.querySelector('p');
            const footerSpectrum = footer.querySelector('.site-footer-spectrum');
            const footerRect = footer.getBoundingClientRect();
            const footerTextLineTops = Array.from(footerText.children)
                .map((child) => child.getBoundingClientRect().top);
            const landingContentWidth = landing.clientWidth
                - parseFloat(landingStyle.paddingLeft)
                - parseFloat(landingStyle.paddingRight);
            showScreen(elements.matchDifficultyScreen);
            const brandSuffix = brandName.querySelector('small').getBoundingClientRect();
            const brandTitleRect = brandTitle.getBoundingClientRect();
            const brandTextBottomOffset = Math.abs(brandSuffix.bottom - brandTitleRect.bottom);
            const brandTextGap = brandSuffix.left - brandTitleRect.right;
            showScreen(elements.landingScreen);
            return {
                viewportWidth: document.documentElement.clientWidth,
                viewportHeight: window.visualViewport?.height || window.innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
                primaryBottom: primary.bottom,
                paletteBottom: paletteEntry.bottom,
                brandNameColor: getComputedStyle(brandName).color,
                brandSuffixColor: getComputedStyle(brandName.querySelector('small')).color,
                brandTitleFontFamily: getComputedStyle(brandTitle).fontFamily,
                brandTitleFontWeight: getComputedStyle(brandTitle).fontWeight,
                brandTextBottomOffset,
                brandTextGap,
                textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
                footerPosition: getComputedStyle(footer).position,
                footerDirection: getComputedStyle(footer).flexDirection,
                footerAfterMain: footer.offsetTop >= document.querySelector('.app-container > main').offsetTop
                    + document.querySelector('.app-container > main').offsetHeight,
                footerTextOnOneLine: Math.max(...footerTextLineTops) - Math.min(...footerTextLineTops) <= 1,
                footerTextFits: footerText.scrollWidth <= footerText.clientWidth + 1,
                footerSpectrumCenterOffset: Math.abs(
                    footerSpectrum.getBoundingClientRect().left
                        + footerSpectrum.getBoundingClientRect().width / 2
                        - (footerRect.left + footerRect.width / 2)
                ),
                paletteToEnglishGap: english.getBoundingClientRect().top
                    - paletteIndicator.getBoundingClientRect().bottom,
                englishFontSize: parseFloat(getComputedStyle(english).fontSize),
                actionWidthRatio: actions.width / landingContentWidth,
                backButtonHeights: Array.from(document.querySelectorAll('.back-button'))
                    .map((button) => parseFloat(getComputedStyle(button).minHeight)),
                backButtonRadii: Array.from(document.querySelectorAll('.back-button'))
                    .map((button) => getComputedStyle(button).borderRadius),
                backButtonHitHeights: Array.from(document.querySelectorAll('.back-button'))
                    .map((button) => {
                        const style = getComputedStyle(button);
                        const targetStyle = getComputedStyle(button, '::after');
                        return parseFloat(style.minHeight) + 2 * Math.abs(parseFloat(targetStyle.top));
                    })
            };
        })()`);
        if (homepageMobileReport.scrollWidth > homepageMobileReport.viewportWidth
            || homepageMobileReport.primaryBottom > homepageMobileReport.viewportHeight + 1
            || homepageMobileReport.paletteBottom > homepageMobileReport.viewportHeight + 1
            || homepageMobileReport.brandNameColor !== homepageMobileReport.brandSuffixColor
            || !homepageMobileReport.brandTitleFontFamily.includes('Yise QingKe Title')
            || homepageMobileReport.brandTitleFontWeight !== '400'
            || homepageMobileReport.brandTextBottomOffset > 1
            || homepageMobileReport.brandTextGap < 6
            || homepageMobileReport.brandTextGap > 8
            || homepageMobileReport.textSizeAdjust !== '100%'
            || homepageMobileReport.footerPosition !== 'static'
            || homepageMobileReport.footerDirection !== 'column'
            || !homepageMobileReport.footerAfterMain
            || !homepageMobileReport.footerTextOnOneLine
            || !homepageMobileReport.footerTextFits
            || homepageMobileReport.footerSpectrumCenterOffset > 1
            || homepageMobileReport.paletteToEnglishGap < 20
            || Math.abs(homepageMobileReport.englishFontSize - 10.88) > 0.1
            || Math.abs(homepageMobileReport.actionWidthRatio - 0.70) > 0.01
            || homepageMobileReport.backButtonHeights.some((height) => height !== 38)
            || homepageMobileReport.backButtonRadii.some((radius) => radius !== '8px')
            || homepageMobileReport.backButtonHitHeights.some((height) => height < 40)) {
            throw new Error(`Mobile homepage layout failed: ${JSON.stringify(homepageMobileReport)}`);
        }
        await captureScreenshot(client, 'landing-mobile.png');
        await evaluate(client, `document.documentElement.style.fontSize = '125%'`);
        await delay(100);
        const embeddedTextScaleReport = await evaluate(client, `(() => {
            document.documentElement.style.setProperty('--safe-area-inset-top', '44px');
            document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
            const footer = document.querySelector('.site-footer');
            const footerText = footer.querySelector('p');
            const lineTops = Array.from(footerText.children)
                .map((child) => child.getBoundingClientRect().top);
            const modeCard = document.querySelector('#color-match-mode');
            showScreen(elements.modeSelectionScreen);
            const modeCardRect = modeCard.getBoundingClientRect();
            const modeCardContentFits = Array.from(modeCard.children).every((child) => {
                const rect = child.getBoundingClientRect();
                return rect.left >= modeCardRect.left - 1
                    && rect.right <= modeCardRect.right + 1
                    && rect.top >= modeCardRect.top - 1
                    && rect.bottom <= modeCardRect.bottom + 1;
            });
            const modeTypography = {
                headingFontSize: getComputedStyle(elements.modeSelectionScreen.querySelector('h2')).fontSize,
                eyebrowFontSize: getComputedStyle(elements.modeSelectionScreen.querySelector('.screen-eyebrow')).fontSize,
                cardHeadingFontSize: getComputedStyle(modeCard.querySelector('h3')).fontSize,
                cardBodyFontSize: getComputedStyle(modeCard.querySelector(':scope > p:not(.mode-card-code)')).fontSize,
                cardListFontSize: getComputedStyle(modeCard.querySelector('ul')).fontSize
            };
            showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall');
            const difficultyRect = elements.recallDifficultyScreen.getBoundingClientRect();
            const difficultyCards = Array.from(elements.recallDifficultyScreen.querySelectorAll('[data-recall-difficulty]'));
            const difficultyCardHeights = difficultyCards.map((card) => card.getBoundingClientRect().height);
            const difficultyCardContentFits = difficultyCards.every((card) => {
                const cardRect = card.getBoundingClientRect();
                return Array.from(card.children).every((child) => {
                    const rect = child.getBoundingClientRect();
                    return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1;
                });
            });
            const difficultyReport = {
                bottom: difficultyRect.bottom,
                height: difficultyRect.height,
                headingFontSize: getComputedStyle(elements.recallDifficultyScreen.querySelector(':scope > h2')).fontSize,
                bodyFontSize: getComputedStyle(elements.recallDifficultyScreen.querySelector(':scope > p')).fontSize,
                cardHeadingFontSize: getComputedStyle(difficultyCards[0].querySelector('h3')).fontSize,
                cardBodyFontSize: getComputedStyle(difficultyCards[0].querySelector(':scope > p')).fontSize,
                cardListFontSize: getComputedStyle(difficultyCards[0].querySelector('ul')).fontSize,
                cardListColumns: getComputedStyle(difficultyCards[0].querySelector('ul')).gridTemplateColumns,
                cardHeights: difficultyCardHeights,
                cardContentFits: difficultyCardContentFits
            };
            selectRecallDifficulty('basic');
            const preparationRect = elements.startScreen.getBoundingClientRect();
            const startButtonRect = elements.startButton.getBoundingClientRect();
            const preparationReport = {
                bottom: preparationRect.bottom,
                height: preparationRect.height,
                headingFontSize: getComputedStyle(elements.startScreen.querySelector(':scope > h2')).fontSize,
                contextFontSize: getComputedStyle(elements.startScreen.querySelector('.preparation-context')).fontSize,
                rulesFontSize: getComputedStyle(document.getElementById('game-rules')).fontSize,
                rulesHeadingFontSize: getComputedStyle(document.querySelector('#game-rules > h3')).fontSize,
                startButtonFontSize: getComputedStyle(elements.startButton).fontSize,
                startButtonHeight: startButtonRect.height,
                contentFits: Array.from(elements.startScreen.children).every((child) => {
                    const rect = child.getBoundingClientRect();
                    return rect.left >= preparationRect.left - 1 && rect.right <= preparationRect.right + 1;
                }),
                bodyClassApplied: document.body.classList.contains('is-preparation-screen')
            };
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            return {
                viewportWidth: document.documentElement.clientWidth,
                viewportHeight,
                scrollWidth: document.documentElement.scrollWidth,
                footerTextOnOneLine: Math.max(...lineTops) - Math.min(...lineTops) <= 1,
                footerTextFits: footerText.scrollWidth <= footerText.clientWidth + 1,
                modeCardContentFits,
                modeTypography,
                difficultyReport,
                preparationReport
            };
        })()`);
        if (embeddedTextScaleReport.scrollWidth > embeddedTextScaleReport.viewportWidth
            || !embeddedTextScaleReport.footerTextOnOneLine
            || !embeddedTextScaleReport.footerTextFits
            || !embeddedTextScaleReport.modeCardContentFits
            || embeddedTextScaleReport.modeTypography.headingFontSize !== '22.5px'
            || embeddedTextScaleReport.modeTypography.eyebrowFontSize !== '10.25px'
            || embeddedTextScaleReport.modeTypography.cardHeadingFontSize !== '20.25px'
            || embeddedTextScaleReport.modeTypography.cardBodyFontSize !== '12.25px'
            || embeddedTextScaleReport.modeTypography.cardListFontSize !== '11.75px'
            || embeddedTextScaleReport.difficultyReport.bottom > embeddedTextScaleReport.viewportHeight + 1
            || embeddedTextScaleReport.difficultyReport.headingFontSize !== '22.5px'
            || embeddedTextScaleReport.difficultyReport.bodyFontSize !== '13.2px'
            || embeddedTextScaleReport.difficultyReport.cardHeadingFontSize !== '17px'
            || embeddedTextScaleReport.difficultyReport.cardBodyFontSize !== '12.25px'
            || embeddedTextScaleReport.difficultyReport.cardListFontSize !== '11.75px'
            || embeddedTextScaleReport.difficultyReport.cardHeights.some((height) => height > 150)
            || !embeddedTextScaleReport.difficultyReport.cardContentFits
            || embeddedTextScaleReport.preparationReport.bottom > embeddedTextScaleReport.viewportHeight + 1
            || embeddedTextScaleReport.preparationReport.headingFontSize !== '23.5px'
            || embeddedTextScaleReport.preparationReport.contextFontSize !== '11.75px'
            || embeddedTextScaleReport.preparationReport.rulesFontSize !== '12.75px'
            || embeddedTextScaleReport.preparationReport.rulesHeadingFontSize !== '17px'
            || embeddedTextScaleReport.preparationReport.startButtonFontSize !== '15px'
            || embeddedTextScaleReport.preparationReport.startButtonHeight < 44
            || !embeddedTextScaleReport.preparationReport.contentFits
            || !embeddedTextScaleReport.preparationReport.bodyClassApplied) {
            throw new Error(`Embedded WebView text scaling failed: ${JSON.stringify(embeddedTextScaleReport)}`);
        }
        await evaluate(client, `showScreen(elements.modeSelectionScreen)`);
        await captureScreenshot(client, 'mode-selection-webview-mobile.png');
        await evaluate(client, `selectRecallDifficulty('basic')`);
        await captureScreenshot(client, 'preparation-webview-mobile.png');
        await evaluate(client, `showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall')`);
        await captureScreenshot(client, 'difficulty-webview-mobile.png');
        await evaluate(client, `(() => {
            document.documentElement.style.fontSize = '';
            document.documentElement.style.removeProperty('--safe-area-inset-top');
            document.documentElement.style.removeProperty('--safe-area-inset-bottom');
            showScreen(elements.landingScreen);
        })()`);
        await evaluate(client, `showScreen(elements.matchDifficultyScreen)`);
        await captureScreenshot(client, 'difficulty-mobile.png');
        const mobileHintOpened = await evaluate(client, `(() => {
            elements.localRecordHint.dispatchEvent(new PointerEvent('click', {
                pointerType: 'touch',
                bubbles: true
            }));
            return {
                expanded: elements.localRecordHint.getAttribute('aria-expanded'),
                visible: elements.localRecordNote.classList.contains('is-visible'),
                visibility: getComputedStyle(elements.localRecordNote).visibility
            };
        })()`);
        await captureScreenshot(client, 'difficulty-hint-mobile.png');
        const mobileHintClosed = await evaluate(client, `(() => {
            elements.localRecordHint.dispatchEvent(new PointerEvent('click', {
                pointerType: 'touch',
                bubbles: true
            }));
            return {
                expanded: elements.localRecordHint.getAttribute('aria-expanded'),
                visible: elements.localRecordNote.classList.contains('is-visible'),
                visibility: getComputedStyle(elements.localRecordNote).visibility
            };
        })()`);
        if (mobileHintOpened.expanded !== 'true'
            || !mobileHintOpened.visible
            || mobileHintOpened.visibility !== 'visible'
            || mobileHintClosed.expanded !== 'false'
            || mobileHintClosed.visible
            || mobileHintClosed.visibility !== 'hidden') {
            throw new Error(`Mobile local record toggle failed: ${JSON.stringify({
                opened: mobileHintOpened,
                closed: mobileHintClosed
            })}`);
        }
        await evaluate(client, `showScreen(elements.landingScreen)`);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 360,
            height: 800,
            deviceScaleFactor: 2,
            mobile: true
        });
        const narrowLandingReport = await evaluate(client, `(() => {
            const landing = elements.landingScreen.getBoundingClientRect();
            const content = [
                document.querySelector('.landing-orbit'),
                document.querySelector('.landing-copy'),
                document.querySelector('.landing-actions')
            ].map((element) => element.getBoundingClientRect());
            const contentTop = Math.min(...content.map((rect) => rect.top));
            const contentBottom = Math.max(...content.map((rect) => rect.bottom));
            return {
                narrowRule: matchMedia('(max-width: 360px)').matches,
                alignContent: getComputedStyle(elements.landingScreen).alignContent,
                spaceAbove: contentTop - landing.top,
                spaceBelow: landing.bottom - contentBottom,
                primaryBottom: elements.enterGameButton.getBoundingClientRect().bottom,
                paletteBottom: elements.colorHistoryEntry.getBoundingClientRect().bottom,
                viewportHeight: window.visualViewport?.height || window.innerHeight
            };
        })()`);
        if (!narrowLandingReport.narrowRule
            || Math.abs(narrowLandingReport.spaceAbove - narrowLandingReport.spaceBelow) > 1
            || narrowLandingReport.primaryBottom > narrowLandingReport.viewportHeight + 1
            || narrowLandingReport.paletteBottom > narrowLandingReport.viewportHeight + 1) {
            throw new Error(`Narrow landing alignment failed: ${JSON.stringify(narrowLandingReport)}`);
        }
        await evaluate(client, `(() => {
            document.documentElement.style.fontSize = '125%';
            document.documentElement.style.setProperty('--safe-area-inset-top', '44px');
            document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
            showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall');
        })()`);
        const narrowEmbeddedReport = await evaluate(client, `(() => {
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            const difficultyBottom = elements.recallDifficultyScreen.getBoundingClientRect().bottom;
            selectRecallDifficulty('basic');
            return {
                viewportWidth: document.documentElement.clientWidth,
                viewportHeight,
                scrollWidth: document.documentElement.scrollWidth,
                difficultyBottom,
                preparationBottom: elements.startScreen.getBoundingClientRect().bottom,
                brandSuffixHidden: getComputedStyle(document.querySelector('.brand-name small')).display === 'none'
            };
        })()`);
        if (narrowEmbeddedReport.scrollWidth > narrowEmbeddedReport.viewportWidth
            || narrowEmbeddedReport.difficultyBottom > narrowEmbeddedReport.viewportHeight + 1
            || narrowEmbeddedReport.preparationBottom > narrowEmbeddedReport.viewportHeight + 1
            || !narrowEmbeddedReport.brandSuffixHidden) {
            throw new Error(`Narrow embedded layout failed: ${JSON.stringify(narrowEmbeddedReport)}`);
        }
        await captureScreenshot(client, 'preparation-webview-360.png');
        await evaluate(client, `showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall')`);
        await captureScreenshot(client, 'difficulty-webview-360.png');
        await evaluate(client, `(() => {
            document.documentElement.style.fontSize = '';
            document.documentElement.style.removeProperty('--safe-area-inset-top');
            document.documentElement.style.removeProperty('--safe-area-inset-bottom');
            showScreen(elements.landingScreen);
        })()`);
        await captureScreenshot(client, 'landing-mobile-360.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 320,
            height: 667,
            deviceScaleFactor: 2,
            mobile: true
        });
        await evaluate(client, `document.documentElement.style.fontSize = '200%'`);
        await delay(100);
        const landingZoomReport = await evaluate(client, `(() => {
            const cube = elements.themeCubeButton.getBoundingClientRect();
            const primary = elements.enterGameButton.getBoundingClientRect();
            return {
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                cubeLeft: cube.left,
                cubeRight: cube.right,
                primaryLeft: primary.left,
                primaryRight: primary.right
            };
        })()`);
        if (landingZoomReport.scrollWidth > landingZoomReport.viewportWidth
            || landingZoomReport.cubeLeft < 0
            || landingZoomReport.cubeRight > landingZoomReport.viewportWidth + 1
            || landingZoomReport.primaryLeft < 0
            || landingZoomReport.primaryRight > landingZoomReport.viewportWidth + 1) {
            throw new Error(`Landing text scaling failed: ${JSON.stringify(landingZoomReport)}`);
        }
        await evaluate(client, `document.documentElement.style.fontSize = ''`);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });

        const themeStructureReport = await evaluate(client, `(() => {
            const button = elements.themeCubeButton;
            const initialTheme = document.documentElement.dataset.theme;
            button.focus();
            return {
                buttonTag: button.tagName,
                focused: document.activeElement.id,
                initialTheme,
                faces: document.querySelectorAll('.theme-cube-face').length,
                tiles: document.querySelectorAll('.theme-cube-face i').length,
                transformStyle: getComputedStyle(document.querySelector('.theme-cube-stage')).transformStyle,
                transitionProperty: getComputedStyle(elements.themeCube).transitionProperty,
                transitionDuration: getComputedStyle(elements.themeCube).transitionDuration,
                progressTracks: [elements.progressBar, elements.recallProgressBar]
                    .map((bar) => getComputedStyle(bar.parentElement).backgroundColor),
                progressFills: [elements.progressBar, elements.recallProgressBar]
                    .map((bar) => getComputedStyle(bar).backgroundColor)
            };
        })()`);
        if (themeStructureReport.buttonTag !== 'BUTTON'
            || themeStructureReport.focused !== 'theme-cube-button'
            || themeStructureReport.initialTheme !== 'cyan'
            || themeStructureReport.faces !== 6
            || themeStructureReport.tiles !== 24
            || themeStructureReport.transformStyle !== 'preserve-3d'
            || themeStructureReport.transitionProperty !== 'transform'
            || themeStructureReport.transitionDuration !== '0.52s'
            || themeStructureReport.progressTracks.join('|') !== 'rgb(18, 49, 58)|rgb(18, 49, 58)'
            || themeStructureReport.progressFills.join('|') !== 'rgb(94, 200, 194)|rgb(94, 200, 194)') {
            throw new Error(`Theme cube structure failed: ${JSON.stringify(themeStructureReport)}`);
        }
        await client.send('Input.dispatchKeyEvent', {
            type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
        });
        const keyboardThemeStartReport = await evaluate(client, `({
            theme: document.documentElement.dataset.theme,
            busyDuringTurn: elements.themeCubeButton.getAttribute('aria-busy')
        })`);
        if (keyboardThemeStartReport.theme !== 'cyan'
            || keyboardThemeStartReport.busyDuringTurn !== 'true') {
            throw new Error(`Theme cube keyboard activation failed: ${JSON.stringify(keyboardThemeStartReport)}`);
        }
        const rapidThemeInputReport = await evaluate(client, `(() => {
            elements.themeCubeButton.click();
            return {
                theme: document.documentElement.dataset.theme,
                turn: elements.themeCube.style.getPropertyValue('--cube-turn'),
                busy: elements.themeCubeButton.getAttribute('aria-busy')
            };
        })()`);
        if (rapidThemeInputReport.theme !== 'cyan'
            || rapidThemeInputReport.turn !== '120deg'
            || rapidThemeInputReport.busy !== 'true') {
            throw new Error(`Rapid theme input guard failed: ${JSON.stringify(rapidThemeInputReport)}`);
        }
        await waitFor(client, `document.documentElement.dataset.theme === 'amethyst'`);
        await waitFor(client, `!elements.themeCubeButton.hasAttribute('aria-busy')`);
        const amethystThemeReport = await evaluate(client, `({
            theme: document.documentElement.dataset.theme,
            stored: localStorage.getItem(THEME_STORAGE_KEY),
            label: elements.themeCubeButton.getAttribute('aria-label'),
            activeDots: document.querySelectorAll('[data-theme-dot].is-active').length,
            activeDot: document.querySelector('[data-theme-dot].is-active')?.dataset.themeDot,
            turn: elements.themeCube.style.getPropertyValue('--cube-turn'),
            titlePrimary: getComputedStyle(document.querySelector('.landing-title span:first-child')).color,
            titleSecondary: getComputedStyle(document.querySelector('.landing-title span:last-child')).color,
            themeColor: elements.themeColorMeta.getAttribute('content'),
            yellow: getComputedStyle(document.documentElement).getPropertyValue('--coral').trim(),
            yellowBright: getComputedStyle(document.documentElement).getPropertyValue('--coral-bright').trim(),
            yellowSoft: getComputedStyle(document.documentElement).getPropertyValue('--coral-soft').trim(),
            cubePrimary: ['--cube-primary-1', '--cube-primary-2', '--cube-primary-3', '--cube-primary-4']
                .map((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim()),
            cubeSecondary: ['--cube-secondary-1', '--cube-secondary-2', '--cube-secondary-3', '--cube-secondary-4']
                .map((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim()),
            cubeTopGold: getComputedStyle(document.documentElement).getPropertyValue('--cube-neutral-3').trim(),
            visualTopFace: Array.from(document.querySelectorAll('.theme-cube-face--right i'))
                .map((tile) => getComputedStyle(tile).backgroundColor),
            visualLeftFace: Array.from(document.querySelectorAll('.theme-cube-face--front i'))
                .map((tile) => getComputedStyle(tile).backgroundColor),
            visualRightFace: Array.from(document.querySelectorAll('.theme-cube-face--top i'))
                .map((tile) => getComputedStyle(tile).backgroundColor),
            progressTrack: getComputedStyle(elements.progressBar.parentElement).backgroundColor,
            progressFill: getComputedStyle(elements.progressBar).backgroundColor
        })`);
        if (amethystThemeReport.theme !== 'amethyst'
            || amethystThemeReport.stored !== 'amethyst'
            || !amethystThemeReport.label.includes('当前紫金')
            || amethystThemeReport.activeDots !== 1
            || amethystThemeReport.activeDot !== 'amethyst'
            || amethystThemeReport.turn !== '120deg'
            || amethystThemeReport.titlePrimary !== 'rgb(143, 121, 232)'
            || amethystThemeReport.titleSecondary !== 'rgb(245, 232, 90)'
            || amethystThemeReport.themeColor !== '#100B25'
            || amethystThemeReport.yellow !== '#f5e85a'
            || amethystThemeReport.yellowBright !== '#fff3a3'
            || amethystThemeReport.yellowSoft !== 'rgba(245, 232, 90, 0.14)'
            || amethystThemeReport.cubePrimary.join('|') !== '#8e7dde|#7760dc|#6146c2|#3b258d'
            || amethystThemeReport.cubeSecondary.join('|') !== '#ffed75|#f5e85a|#f5e133|#e6d116'
            || amethystThemeReport.cubeTopGold !== '#f0ebb9'
            || amethystThemeReport.visualTopFace.join('|') !== 'rgb(142, 125, 222)|rgb(255, 254, 250)|rgb(240, 235, 185)|rgb(246, 243, 213)'
            || amethystThemeReport.visualLeftFace.join('|') !== 'rgb(97, 70, 194)|rgb(209, 200, 246)|rgb(59, 37, 141)|rgb(119, 96, 220)'
            || amethystThemeReport.visualRightFace.join('|') !== 'rgb(245, 232, 90)|rgb(230, 209, 22)|rgb(255, 237, 117)|rgb(245, 225, 51)'
            || amethystThemeReport.progressTrack !== 'rgb(45, 34, 91)'
            || amethystThemeReport.progressFill !== 'rgb(143, 121, 232)') {
            throw new Error(`Amethyst theme failed: ${JSON.stringify(amethystThemeReport)}`);
        }
        await captureScreenshot(client, 'landing-amethyst-desktop.png');

        await evaluate(client, `elements.themeCubeButton.click()`);
        await waitFor(client, `document.documentElement.dataset.theme === 'ivory'`);
        await waitFor(client, `!elements.themeCubeButton.hasAttribute('aria-busy')`);
        await navigate(client, appUrl);
        const ivoryThemeReport = await evaluate(client, `({
            theme: document.documentElement.dataset.theme,
            stored: localStorage.getItem(THEME_STORAGE_KEY),
            label: elements.themeCubeButton.getAttribute('aria-label'),
            activeDot: document.querySelector('[data-theme-dot].is-active')?.dataset.themeDot,
            bodyColor: getComputedStyle(document.body).color,
            colorScheme: getComputedStyle(document.documentElement).colorScheme,
            titlePrimary: getComputedStyle(document.querySelector('.landing-title span:first-child')).color,
            titleSecondary: getComputedStyle(document.querySelector('.landing-title span:last-child')).color,
            themeColor: elements.themeColorMeta.getAttribute('content'),
            sampleSurround: getComputedStyle(document.documentElement).getPropertyValue('--sample-surround').trim(),
            subtle: getComputedStyle(document.documentElement).getPropertyValue('--subtle').trim(),
            rgbLabels: ['.text-red-300', '.text-green-300', '.text-blue-300']
                .map((selector) => getComputedStyle(document.querySelector(selector)).color),
            storageDetail: getComputedStyle(elements.storageStatus.querySelector('span')).color,
            progressTrack: getComputedStyle(elements.progressBar.parentElement).backgroundColor,
            progressFill: getComputedStyle(elements.progressBar).backgroundColor
        })`);
        if (ivoryThemeReport.theme !== 'ivory'
            || ivoryThemeReport.stored !== 'ivory'
            || !ivoryThemeReport.label.includes('当前蓝粉')
            || ivoryThemeReport.activeDot !== 'ivory'
            || ivoryThemeReport.bodyColor !== 'rgb(245, 240, 242)'
            || ivoryThemeReport.colorScheme !== 'dark'
            || ivoryThemeReport.titlePrimary !== 'rgb(153, 183, 232)'
            || ivoryThemeReport.titleSecondary !== 'rgb(243, 161, 176)'
            || ivoryThemeReport.themeColor !== '#151B2C'
            || ivoryThemeReport.sampleSurround !== '#10191d'
            || ivoryThemeReport.subtle !== '#9499ad'
            || ivoryThemeReport.rgbLabels.join('|') !== 'rgb(252, 165, 165)|rgb(134, 239, 172)|rgb(147, 197, 253)'
            || ivoryThemeReport.storageDetail !== 'rgb(200, 208, 207)'
            || ivoryThemeReport.progressTrack !== 'rgb(43, 56, 82)'
            || ivoryThemeReport.progressFill !== 'rgb(153, 183, 232)') {
            throw new Error(`Ivory theme persistence failed: ${JSON.stringify(ivoryThemeReport)}`);
        }
        await captureScreenshot(client, 'landing-ivory-desktop.png');
        await evaluate(client, `elements.enterGameButton.click()`);
        await waitFor(client, `!elements.modeSelectionScreen.classList.contains('hidden')`);
        await captureScreenshot(client, 'mode-selection-ivory-desktop.png');
        await evaluate(client, `showScreen(elements.landingScreen)`);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });
        await captureScreenshot(client, 'landing-ivory-mobile.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });

        await client.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
        });
        const reducedThemeReport = await evaluate(client, `(() => {
            applyTheme('cyan', { persist: true });
            cubeRotationDegrees = 0;
            setCubeRotationWithoutMotion(0);
            elements.themeCubeButton.click();
            return {
                reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
                theme: document.documentElement.dataset.theme,
                busy: elements.themeCubeButton.hasAttribute('aria-busy'),
                stored: localStorage.getItem(THEME_STORAGE_KEY),
                transitionDuration: parseFloat(getComputedStyle(elements.themeCube).transitionDuration)
            };
        })()`);
        if (!reducedThemeReport.reduce
            || reducedThemeReport.theme !== 'amethyst'
            || reducedThemeReport.busy
            || reducedThemeReport.stored !== 'amethyst'
            || reducedThemeReport.transitionDuration >= 0.001) {
            throw new Error(`Reduced-motion theme switch failed: ${JSON.stringify(reducedThemeReport)}`);
        }
        await client.send('Emulation.setEmulatedMedia', { features: [] });
        await evaluate(client, `(() => {
            applyTheme('cyan', { persist: true });
            cubeRotationDegrees = 0;
            setCubeRotationWithoutMotion(0);
        })()`);

        for (const themeId of ['amethyst', 'ivory', 'cyan']) {
            await evaluate(client, `elements.themeCubeButton.click()`);
            await waitFor(client, `document.documentElement.dataset.theme === '${themeId}'`);
            await waitFor(client, `!elements.themeCubeButton.hasAttribute('aria-busy')`);
        }
        const themeResetReport = await evaluate(client, `({
            theme: document.documentElement.dataset.theme,
            turn: elements.themeCube.style.getPropertyValue('--cube-turn'),
            resetting: elements.themeCube.classList.contains('is-resetting')
        })`);
        if (themeResetReport.theme !== 'cyan'
            || themeResetReport.turn !== '0deg'
            || themeResetReport.resetting) {
            throw new Error(`Theme cube full-cycle reset failed: ${JSON.stringify(themeResetReport)}`);
        }

        await evaluate(client, `elements.themeCubeButton.focus()`);
        await client.send('Input.dispatchKeyEvent', {
            type: 'rawKeyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'char', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32
        });
        const spaceThemeStartReport = await evaluate(client, `({
            theme: document.documentElement.dataset.theme,
            busyDuringTurn: elements.themeCubeButton.getAttribute('aria-busy')
        })`);
        if (spaceThemeStartReport.theme !== 'cyan'
            || spaceThemeStartReport.busyDuringTurn !== 'true') {
            throw new Error(`Theme cube Space activation failed: ${JSON.stringify(spaceThemeStartReport)}`);
        }
        await waitFor(client, `document.documentElement.dataset.theme === 'amethyst'`);
        await waitFor(client, `!elements.themeCubeButton.hasAttribute('aria-busy')`);
        await evaluate(client, `(() => {
            applyTheme('cyan', { persist: true });
            cubeRotationDegrees = 0;
            setCubeRotationWithoutMotion(0);
        })()`);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        const cubeTouchPoint = await evaluate(client, `(() => {
            const rect = elements.themeCubeButton.getBoundingClientRect();
            return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
        })()`);
        await client.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: cubeTouchPoint.x, y: cubeTouchPoint.y }]
        });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const touchThemeStartReport = await evaluate(client, `({
            theme: document.documentElement.dataset.theme,
            busyDuringTurn: elements.themeCubeButton.getAttribute('aria-busy')
        })`);
        if (touchThemeStartReport.theme !== 'cyan'
            || touchThemeStartReport.busyDuringTurn !== 'true') {
            throw new Error(`Theme cube touch activation failed: ${JSON.stringify(touchThemeStartReport)}`);
        }
        await waitFor(client, `document.documentElement.dataset.theme === 'amethyst'`);
        await waitFor(client, `!elements.themeCubeButton.hasAttribute('aria-busy')`);
        await evaluate(client, `(() => {
            applyTheme('cyan', { persist: true });
            cubeRotationDegrees = 0;
            setCubeRotationWithoutMotion(0);
        })()`);
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });

        await evaluate(client, `elements.colorHistoryEntry.click()`);
        await waitFor(client, `!elements.colorHistoryScreen.classList.contains('hidden')`);
        await waitFor(client, `document.activeElement.id === 'color-history-title'`);
        const emptyPaletteReport = await evaluate(client, `({
            summary: elements.colorHistorySummary.textContent,
            emptyVisible: !elements.colorHistoryEmpty.classList.contains('hidden'),
            collectionHidden: elements.colorHistoryCollection.classList.contains('hidden'),
            clearDisabled: elements.clearHistoryBtn.disabled,
            statsHidden: elements.gameInfoBar.classList.contains('hidden')
        })`);
        if (emptyPaletteReport.summary !== '0 / 100'
            || !emptyPaletteReport.emptyVisible
            || !emptyPaletteReport.collectionHidden
            || !emptyPaletteReport.clearDisabled
            || !emptyPaletteReport.statsHidden) {
            throw new Error(`Empty palette screen failed: ${JSON.stringify(emptyPaletteReport)}`);
        }

        const filledPaletteReport = await evaluate(client, `(() => {
            gameState.colorHistory = [];
            localStorage.removeItem(COLOR_HISTORY_STORAGE_KEY);
            addToColorHistory('rgb(94, 200, 194)');
            addToColorHistory('rgb(94, 200, 194)');
            addToColorHistory('rgb(243, 111, 99)');
            return {
                summary: elements.colorHistorySummary.textContent,
                landingCount: elements.landingHistoryCount.textContent,
                swatches: elements.colorHistory.querySelectorAll('.history-color').length,
                emptySlots: elements.colorHistory.querySelectorAll('.palette-slot-empty').length,
                totalSlots: elements.colorHistory.children.length,
                stored: JSON.parse(localStorage.getItem(COLOR_HISTORY_STORAGE_KEY) || '[]').length,
                emptyHidden: elements.colorHistoryEmpty.classList.contains('hidden'),
                collectionVisible: !elements.colorHistoryCollection.classList.contains('hidden'),
                clearDisabled: elements.clearHistoryBtn.disabled,
                selectedHex: elements.paletteInspectorHex.textContent,
                firstHex: elements.colorHistory.querySelector('.history-color').dataset.historyHex
            };
        })()`);
        if (filledPaletteReport.summary !== '2 / 100'
            || filledPaletteReport.landingCount !== '2'
            || filledPaletteReport.swatches !== 2
            || filledPaletteReport.emptySlots !== 8
            || filledPaletteReport.totalSlots !== 10
            || filledPaletteReport.stored !== 2
            || !filledPaletteReport.emptyHidden
            || !filledPaletteReport.collectionVisible
            || filledPaletteReport.clearDisabled
            || filledPaletteReport.selectedHex !== '#F36F63'
            || filledPaletteReport.firstHex !== '#F36F63') {
            throw new Error(`Filled palette screen failed: ${JSON.stringify(filledPaletteReport)}`);
        }

        await navigate(client, appUrl);
        await waitFor(client, `elements.landingHistoryCount.textContent === '2'`);
        await evaluate(client, `elements.colorHistoryEntry.click()`);
        await waitFor(client, `document.activeElement.id === 'color-history-title'`);
        const hydratedPaletteReport = await evaluate(client, `({
            inMemory: gameState.colorHistory.length,
            summary: elements.colorHistorySummary.textContent,
            swatches: elements.colorHistory.querySelectorAll('.history-color').length,
            slots: elements.colorHistory.children.length,
            selectedHex: elements.paletteInspectorHex.textContent
        })`);
        if (hydratedPaletteReport.inMemory !== 2
            || hydratedPaletteReport.summary !== '2 / 100'
            || hydratedPaletteReport.swatches !== 2
            || hydratedPaletteReport.slots !== 10
            || hydratedPaletteReport.selectedHex !== '#F36F63') {
            throw new Error(`Palette reload hydration failed: ${JSON.stringify(hydratedPaletteReport)}`);
        }
        await captureScreenshot(client, 'palette-desktop.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });
        await captureScreenshot(client, 'palette-mobile.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 320,
            height: 667,
            deviceScaleFactor: 2,
            mobile: true
        });
        await evaluate(client, `document.documentElement.style.fontSize = '200%'`);
        await delay(100);
        const paletteZoomReport = await evaluate(client, `(() => {
            const header = document.querySelector('.palette-archive-header');
            const tray = document.querySelector('.palette-tray');
            const swatch = elements.colorHistory.querySelector('.history-color');
            return {
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                headerClientWidth: header.clientWidth,
                headerScrollWidth: header.scrollWidth,
                trayClientWidth: tray.clientWidth,
                trayScrollWidth: tray.scrollWidth,
                swatchWidth: swatch.getBoundingClientRect().width
            };
        })()`);
        if (paletteZoomReport.scrollWidth > paletteZoomReport.viewportWidth
            || paletteZoomReport.headerScrollWidth > paletteZoomReport.headerClientWidth
            || paletteZoomReport.trayScrollWidth > paletteZoomReport.trayClientWidth
            || paletteZoomReport.swatchWidth < 44) {
            throw new Error(`Palette text scaling failed: ${JSON.stringify(paletteZoomReport)}`);
        }
        await evaluate(client, `document.documentElement.style.fontSize = ''`);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });
        await evaluate(client, `elements.colorHistory.querySelector('.history-color').click()`);
        const paletteInspectorReport = await evaluate(client, `({
            selectedHex: elements.paletteInspectorHex.textContent,
            selectedRgb: elements.paletteInspectorRgb.textContent,
            selectedHsl: elements.paletteInspectorHsl.textContent,
            selectedContext: elements.paletteInspectorContext.textContent,
            selectedButtons: elements.colorHistory.querySelectorAll('.history-color.is-selected').length,
            pressedButtons: elements.colorHistory.querySelectorAll('.history-color[aria-pressed="true"]').length,
            inspectorLive: document.querySelector('.palette-inspector').getAttribute('aria-live')
        })`);
        if (paletteInspectorReport.selectedHex !== '#F36F63'
            || !paletteInspectorReport.selectedRgb.includes('243, 111, 99')
            || !paletteInspectorReport.selectedHsl.startsWith('hsl(')
            || paletteInspectorReport.selectedContext !== '自由浏览'
            || paletteInspectorReport.selectedButtons !== 1
            || paletteInspectorReport.pressedButtons !== 1
            || paletteInspectorReport.inspectorLive !== 'polite') {
            throw new Error(`Palette inspector accessibility failed: ${JSON.stringify(paletteInspectorReport)}`);
        }
        const inspectorInjectionReport = await evaluate(client, `(() => {
            updateColorHistoryInspector({
                color: 'rgb(94, 200, 194)',
                context: '<img id="tooltip-injection" src=x>',
                hex: '<script>window.tooltipInjected = true<\\/script>',
                rgbText: 'rgb(94, 200, 194)',
                hslText: 'hsl(177, 48%, 58%)'
            });
            return {
                injectedNode: Boolean(document.querySelector('#tooltip-injection')),
                scriptNode: Boolean(document.querySelector('.palette-inspector script')),
                text: document.querySelector('.palette-inspector').textContent
            };
        })()`);
        if (inspectorInjectionReport.injectedNode
            || inspectorInjectionReport.scriptNode
            || !inspectorInjectionReport.text.includes('<img id="tooltip-injection" src=x>')) {
            throw new Error(`Palette inspector injection protection failed: ${JSON.stringify(inspectorInjectionReport)}`);
        }
        const paletteCapReport = await evaluate(client, `(() => {
            gameState.colorHistory = [];
            localStorage.removeItem(COLOR_HISTORY_STORAGE_KEY);
            for (let value = 1; value <= 102; value++) {
                addToColorHistory('rgb(' + value + ', 0, 0)');
            }
            const stored = JSON.parse(localStorage.getItem(COLOR_HISTORY_STORAGE_KEY) || '[]');
            return {
                inMemory: gameState.colorHistory.length,
                stored: stored.length,
                first: gameState.colorHistory[0].hex,
                last: gameState.colorHistory[gameState.colorHistory.length - 1].hex,
                totalSlots: elements.colorHistory.children.length,
                emptySlots: elements.colorHistory.querySelectorAll('.palette-slot-empty').length,
                footerAfterContent: document.querySelector('.site-footer').getBoundingClientRect().top
                    >= elements.colorHistoryScreen.getBoundingClientRect().bottom
            };
        })()`);
        if (paletteCapReport.inMemory !== 100
            || paletteCapReport.stored !== 100
            || paletteCapReport.first !== '#030000'
            || paletteCapReport.last !== '#660000'
            || paletteCapReport.totalSlots !== 100
            || paletteCapReport.emptySlots !== 0
            || !paletteCapReport.footerAfterContent) {
            throw new Error(`Palette history cap failed: ${JSON.stringify(paletteCapReport)}`);
        }
        await evaluate(client, `elements.clearHistoryBtn.click()`);
        const clearConfirmationReport = await evaluate(client, `({
            stillStored: gameState.colorHistory.length,
            buttonText: elements.clearHistoryBtn.textContent,
            cancelVisible: !elements.clearHistoryCancel.classList.contains('hidden')
        })`);
        if (clearConfirmationReport.stillStored !== 100
            || clearConfirmationReport.buttonText !== '确认清空'
            || !clearConfirmationReport.cancelVisible) {
            throw new Error(`Palette clear confirmation failed: ${JSON.stringify(clearConfirmationReport)}`);
        }
        await evaluate(client, `elements.clearHistoryCancel.click()`);
        const clearCancelReport = await evaluate(client, `({
            stillStored: gameState.colorHistory.length,
            buttonText: elements.clearHistoryBtn.textContent,
            cancelHidden: elements.clearHistoryCancel.classList.contains('hidden'),
            focused: document.activeElement.id
        })`);
        if (clearCancelReport.stillStored !== 100
            || clearCancelReport.buttonText !== '清空全部色卡'
            || !clearCancelReport.cancelHidden
            || clearCancelReport.focused !== 'clear-history-btn') {
            throw new Error(`Palette clear cancellation failed: ${JSON.stringify(clearCancelReport)}`);
        }
        await evaluate(client, `elements.clearHistoryBtn.click()`);
        await evaluate(client, `elements.clearHistoryBtn.click()`);
        await waitFor(client, `elements.colorHistorySummary.textContent === '0 / 100'`);
        await waitFor(client, `document.activeElement.id === 'color-history-title'`);
        const clearedPaletteReport = await evaluate(client, `({
            stored: localStorage.getItem(COLOR_HISTORY_STORAGE_KEY),
            emptyVisible: !elements.colorHistoryEmpty.classList.contains('hidden'),
            collectionHidden: elements.colorHistoryCollection.classList.contains('hidden'),
            clearDisabled: elements.clearHistoryBtn.disabled,
            renderedSlots: elements.colorHistory.children.length,
            cancelHidden: elements.clearHistoryCancel.classList.contains('hidden')
        })`);
        if (clearedPaletteReport.stored !== null
            || !clearedPaletteReport.emptyVisible
            || !clearedPaletteReport.collectionHidden
            || !clearedPaletteReport.clearDisabled
            || clearedPaletteReport.renderedSlots !== 0
            || !clearedPaletteReport.cancelHidden) {
            throw new Error(`Palette clearing failed: ${JSON.stringify(clearedPaletteReport)}`);
        }
        await evaluate(client, `document.querySelector('#color-history-screen [data-back-target="landing"]').click()`);
        await waitFor(client, `!elements.landingScreen.classList.contains('hidden')`);
        await waitFor(client, `document.activeElement.id === 'color-history-entry'`);

        const observationReport = await evaluate(client, `({
            duration: OBSERVATION_DURATION_MS,
            matchCountdown: elements.countdown.textContent,
            recallCountdown: elements.recallCountdown.textContent,
            matchRulesUpdated: Object.values(matchDifficultyConfig).every(({ rules }) => (
                rules.some((rule) => rule.includes('5 秒后'))
                && rules.every((rule) => !rule.includes('6 秒后'))
            )),
            recallRulesUpdated: Object.values(recallDifficultyConfig).every(({ rules }) => (
                rules.some((rule) => rule.includes('5 秒后'))
                && rules.every((rule) => !rule.includes('6 秒后'))
            ))
        })`);
        if (observationReport.duration !== 5000
            || observationReport.matchCountdown !== '5'
            || observationReport.recallCountdown !== '5'
            || !observationReport.matchRulesUpdated
            || !observationReport.recallRulesUpdated) {
            throw new Error(`Observation duration update failed: ${JSON.stringify(observationReport)}`);
        }

        await evaluate(client, `(() => {
            const startedAt = performance.now();
            window.__observationTiming = { completed: false, elapsed: 0 };
            window.__observationProgress = document.createElement('div');
            runCountdown({
                counter: document.createElement('div'),
                progressBar: window.__observationProgress,
                durationMs: OBSERVATION_DURATION_MS,
                onComplete: () => {
                    window.__observationTiming.completed = true;
                    window.__observationTiming.elapsed = performance.now() - startedAt;
                }
            });
        })()`);
        await delay(100);
        const countdownRenderReport = await evaluate(client, `({
            width: window.__observationProgress.style.width,
            transform: window.__observationProgress.style.transform
        })`);
        const countdownScale = Number(countdownRenderReport.transform.match(/scaleX\(([^)]+)\)/)?.[1]);
        if (countdownRenderReport.width !== '100%'
            || !countdownRenderReport.transform.startsWith('scaleX(')
            || !Number.isFinite(countdownScale)
            || countdownScale <= 0
            || countdownScale >= 1) {
            throw new Error(`Countdown rendering path failed: ${JSON.stringify(countdownRenderReport)}`);
        }
        await waitFor(client, `window.__observationTiming.completed`, 7000);
        const observationTimingReport = await evaluate(client, `window.__observationTiming`);
        if (observationTimingReport.elapsed < 4900 || observationTimingReport.elapsed > 6500) {
            throw new Error(`Observation elapsed time failed: ${JSON.stringify(observationTimingReport)}`);
        }

        const feedbackReport = await evaluate(client, `(() => {
            const cases = [
                [9.7, '你就是Color Master!'],
                [9, '这波专业操作！'],
                [8, '就差一点，稳住！'],
                [6.5, '感觉对了'],
                [4, '小失误，再接再厉！'],
                [0, '色感加载中…']
            ];
            return {
                tiers: cases.map(([score, expected]) => ({
                    score,
                    expected,
                    actual: getRecallFeedback(score, 1)
                })),
                stable: getRecallFeedback(8.5, 2) === getRecallFeedback(8.5, 2),
                rotates: getRecallFeedback(8.5, 1) !== getRecallFeedback(8.5, 2)
            };
        })()`);
        if (feedbackReport.tiers.some(({ expected, actual }) => expected !== actual)
            || !feedbackReport.stable
            || !feedbackReport.rotates) {
            throw new Error(`Feedback regression failed: ${JSON.stringify(feedbackReport)}`);
        }

        const recallSemanticReport = await evaluate(client, `(() => {
            const grayAttempt = calculateRecallDistanceDetails(
                { r: 62, g: 124, b: 127 },
                { r: 128, g: 128, b: 128 }
            );
            const sameHueAttempt = calculateRecallDistanceDetails(
                { r: 118, g: 59, b: 135 },
                { r: 189, g: 97, b: 193 }
            );
            const grayFeedback = getRecallDifferenceFeedback(grayAttempt);
            const sameHueFeedback = getRecallDifferenceFeedback(sameHueAttempt);
            return {
                grayScore: Math.round(scoreFromPerceptualDistance(grayAttempt.distance) * 100) / 100,
                sameHueScore: Math.round(scoreFromPerceptualDistance(sameHueAttempt.distance) * 100) / 100,
                grayFeedback,
                sameHueFeedback,
                playerFacingTerminology: !/(?:Oklab|OKLab|ΔOK|RGB|Lab|色差|彩度)/.test(
                    grayFeedback + sameHueFeedback
                )
            };
        })()`);
        if (recallSemanticReport.grayScore !== 6.74
            || recallSemanticReport.sameHueScore !== 6.83
            || recallSemanticReport.sameHueScore <= recallSemanticReport.grayScore
            || recallSemanticReport.grayFeedback !== '明度接近，但饱和度明显偏低'
            || recallSemanticReport.grayFeedback.includes('灰色')
            || !recallSemanticReport.playerFacingTerminology
            || recallSemanticReport.sameHueFeedback !== '色相很接近，但明度明显偏亮') {
            throw new Error(`Recall semantic scoring failed: ${JSON.stringify(recallSemanticReport)}`);
        }

        await evaluate(client, `document.querySelector('#enter-game-button').click()`);
        await waitFor(client, `!document.querySelector('#mode-selection-screen').classList.contains('hidden')`);
        await evaluate(client, `document.querySelector('#color-match-mode').click()`);
        await waitFor(client, `!document.querySelector('#match-difficulty-screen').classList.contains('hidden')`);
        const localRecordDisclosureReport = await evaluate(client, `(() => {
            const triggerRect = elements.localRecordHint.getBoundingClientRect();
            const initial = {
                triggerVisible: !elements.localRecordHint.classList.contains('hidden'),
                noteAvailable: !elements.localRecordNote.classList.contains('hidden'),
                noteVisibility: getComputedStyle(elements.localRecordNote).visibility,
                expanded: elements.localRecordHint.getAttribute('aria-expanded'),
                label: elements.localRecordHint.getAttribute('aria-label'),
                controls: elements.localRecordHint.getAttribute('aria-controls'),
                role: elements.localRecordNote.getAttribute('role'),
                icon: elements.localRecordHint.querySelector('use').getAttribute('href'),
                triggerWidth: triggerRect.width,
                triggerHeight: triggerRect.height
            };
            elements.localRecordHint.dispatchEvent(new PointerEvent('pointerenter', {
                pointerType: 'mouse',
                bubbles: true
            }));
            const hover = {
                visible: elements.localRecordNote.classList.contains('is-visible'),
                visibility: getComputedStyle(elements.localRecordNote).visibility,
                expanded: elements.localRecordHint.getAttribute('aria-expanded')
            };
            elements.localRecordHint.dispatchEvent(new PointerEvent('pointerleave', {
                pointerType: 'mouse',
                bubbles: true
            }));
            const closedAfterLeave = !elements.localRecordNote.classList.contains('is-visible');
            elements.localRecordHint.click();
            const openedByClick = elements.localRecordNote.classList.contains('is-visible')
                && elements.localRecordHint.getAttribute('aria-expanded') === 'true';
            elements.localRecordHint.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true
            }));
            return {
                bestOverviewVisible: !elements.modeBestOverview.classList.contains('hidden'),
                note: elements.localRecordNote.textContent,
                duration: LOCAL_RECORD_HINT_DURATION_MS,
                initial,
                hover,
                closedAfterLeave,
                openedByClick,
                closedByEscape: !elements.localRecordNote.classList.contains('is-visible')
                    && elements.localRecordHint.getAttribute('aria-expanded') === 'false'
            };
        })()`);
        if (!localRecordDisclosureReport.bestOverviewVisible
            || !localRecordDisclosureReport.initial.triggerVisible
            || !localRecordDisclosureReport.initial.noteAvailable
            || localRecordDisclosureReport.initial.noteVisibility !== 'hidden'
            || localRecordDisclosureReport.initial.expanded !== 'false'
            || localRecordDisclosureReport.initial.label !== '查看本机成绩保存说明'
            || localRecordDisclosureReport.initial.controls !== 'local-record-note'
            || localRecordDisclosureReport.initial.role !== 'tooltip'
            || localRecordDisclosureReport.initial.icon !== '#icon-info'
            || localRecordDisclosureReport.initial.triggerWidth < 40
            || localRecordDisclosureReport.initial.triggerHeight < 40
            || !localRecordDisclosureReport.hover.visible
            || localRecordDisclosureReport.hover.visibility !== 'visible'
            || localRecordDisclosureReport.hover.expanded !== 'true'
            || !localRecordDisclosureReport.closedAfterLeave
            || !localRecordDisclosureReport.openedByClick
            || !localRecordDisclosureReport.closedByEscape
            || localRecordDisclosureReport.duration !== 5000
            || localRecordDisclosureReport.note !== '成绩只保存在当前浏览器；清除网站数据或更换设备后会重置。') {
            throw new Error(`Local record disclosure failed: ${JSON.stringify(localRecordDisclosureReport)}`);
        }
        await evaluate(client, `document.querySelector('[data-match-difficulty="basic"]').click()`);
        await waitFor(client, `!document.querySelector('#start-screen').classList.contains('hidden')`);
        const matchPreparationReport = await evaluate(client, `({
            gameInfoHidden: elements.gameInfoBar.classList.contains('hidden'),
            startVisible: !elements.startScreen.classList.contains('hidden'),
            hintHidden: elements.localRecordHint.classList.contains('hidden'),
            hintExpanded: elements.localRecordHint.getAttribute('aria-expanded'),
            mode: elements.preparationMode.textContent,
            difficulty: elements.preparationDifficulty.textContent
        })`);
        if (!matchPreparationReport.gameInfoHidden
            || !matchPreparationReport.startVisible
            || !matchPreparationReport.hintHidden
            || matchPreparationReport.hintExpanded !== 'false'
            || matchPreparationReport.mode !== '颜色匹配'
            || matchPreparationReport.difficulty !== '基础 · 3×3 色池') {
            throw new Error(`Match preparation stats visibility failed: ${JSON.stringify(matchPreparationReport)}`);
        }
        await captureScreenshot(client, 'preparation-desktop.png');
        await evaluate(client, `document.querySelector('#start-button').click(); stopActiveCountdown(); showColorGrid()`);
        await waitFor(client, `document.querySelectorAll('.color-card').length === 9`);

        const matchReport = await evaluate(client, `(() => {
            const cards = [...document.querySelectorAll('.color-card')];
            const colors = cards.map((card) => card.style.backgroundColor);
            const band = getMatchDistanceBand(gameState.matchDifficulty, gameState.level);
            const targetHex = rgbToHex(gameState.currentTargetColor);
            const originalRandom = Math.random;
            const failureMessages = [0, 0.2, 0.4, 0.6, 0.8].map((value) => {
                Math.random = () => value;
                return getMatchFailureMessage(false);
            });
            const finalFailureMessages = [0, 0.5].map((value) => {
                Math.random = () => value;
                return getMatchFailureMessage(true);
            });
            Math.random = originalRandom;
            const distanceChecks = colors
                .filter((color) => rgbToHex(color) !== targetHex)
                .map((color) => calculatePerceptualDistance(gameState.currentTargetColor, color));
            const selected = cards.find((card) => rgbToHex(card.style.backgroundColor) !== targetHex) || cards[0];
            const colorCodesBeforeSubmit = cards.filter((card) => card.querySelector('.match-card-code')).length;
            const screenTopBefore = elements.colorGridScreen.getBoundingClientRect().top;
            const scrollBefore = window.scrollY;
            const stableSurround = getComputedStyle(cards[0]).boxShadow.includes('rgb(16, 25, 29)');
            selected.click();
            selected.click();
            return {
                cardCount: cards.length,
                uniqueCount: new Set(colors.map(rgbToHex)).size,
                targetCount: colors.filter((color) => rgbToHex(color) === targetHex).length,
                colorCodesBeforeSubmit,
                distancesInBand: distanceChecks.every((distance) => distance >= band.min && distance <= band.max),
                failureMessages,
                finalFailureMessages,
                answersAfterDoubleClick: gameState.totalAnswers,
                stableSurround,
                gridStillVisible: !elements.colorGridScreen.classList.contains('hidden'),
                resultScreenHidden: elements.resultScreen.classList.contains('hidden'),
                brandStillHidden: elements.brandHeader.classList.contains('hidden'),
                resultTitle: elements.matchRoundMessage.textContent,
                resultIcon: elements.matchRoundIconUse.getAttribute('href'),
                titleFocused: document.activeElement === elements.matchRoundTitle,
                actionsVisible: !elements.matchRoundActions.classList.contains('hidden'),
                continueLabel: elements.matchContinueButton.textContent,
                levelBeforeContinue: gameState.level,
                disabledCards: cards.filter((card) => card.disabled).length,
                correctMarkers: cards.filter((card) => card.classList.contains('is-match-correct')).length,
                wrongMarkers: cards.filter((card) => card.classList.contains('is-match-selected-wrong')).length,
                mutedCards: cards.filter((card) => card.classList.contains('is-match-muted')).length,
                markerIcons: cards.filter((card) => card.querySelector('.match-card-result .ui-icon')).length,
                colorCodeCount: cards.filter((card) => card.querySelector('.match-card-code')).length,
                colorCodesCorrect: cards.every((card) => card.querySelector('.match-card-code').textContent === rgbToHex(card.style.backgroundColor)),
                accessibleColorCodes: cards.every((card) => card.getAttribute('aria-label').includes('色号 ' + rgbToHex(card.style.backgroundColor))),
                screenTopShift: Math.abs(elements.colorGridScreen.getBoundingClientRect().top - screenTopBefore),
                scrollShift: Math.abs(window.scrollY - scrollBefore)
            };
        })()`);

        if (matchReport.cardCount !== 9
            || matchReport.uniqueCount !== 9
            || matchReport.targetCount !== 1
            || matchReport.colorCodesBeforeSubmit !== 0
            || !matchReport.distancesInBand
            || JSON.stringify(matchReport.failureMessages) !== JSON.stringify([
                '匹配错误，再试试吧！',
                '匹配错误，慢慢来！',
                '匹配错误，别灰心!',
                '匹配错误，再靠近一点点!',
                '匹配错误，已经很接近了!'
            ])
            || JSON.stringify(matchReport.finalFailureMessages) !== JSON.stringify([
                '匹配错误，别灰心!',
                '匹配错误，已经很接近了!'
            ])
            || matchReport.answersAfterDoubleClick !== 1
            || !matchReport.stableSurround
            || !matchReport.gridStillVisible
            || !matchReport.resultScreenHidden
            || !matchReport.brandStillHidden
            || !matchReport.failureMessages.includes(matchReport.resultTitle)
            || matchReport.resultIcon !== '#icon-x-circle'
            || !matchReport.titleFocused
            || !matchReport.actionsVisible
            || matchReport.continueLabel !== '下一关'
            || matchReport.levelBeforeContinue !== 1
            || matchReport.disabledCards !== 9
            || matchReport.correctMarkers !== 1
            || matchReport.wrongMarkers !== 1
            || matchReport.mutedCards !== 7
            || matchReport.markerIcons !== 2
            || matchReport.colorCodeCount !== 9
            || !matchReport.colorCodesCorrect
            || !matchReport.accessibleColorCodes
            || matchReport.screenTopShift > 1
            || matchReport.scrollShift > 1) {
            throw new Error(`Match regression failed: ${JSON.stringify(matchReport)}`);
        }
        await captureScreenshot(client, 'match-inline-failure-desktop.png');

        const matchContinueReport = await evaluate(client, `(() => {
            elements.matchContinueButton.click();
            stopActiveCountdown();
            return {
                level: gameState.level,
                targetVisible: !elements.targetColorScreen.classList.contains('hidden')
            };
        })()`);
        if (matchContinueReport.level !== 2 || !matchContinueReport.targetVisible) {
            throw new Error(`Match continue flow failed: ${JSON.stringify(matchContinueReport)}`);
        }

        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });
        await evaluate(client, `gameState.matchDifficulty = 'advanced'; updateDisplays(); showColorGrid()`);
        await waitFor(client, `document.querySelectorAll('.color-card').length === 16`);
        const matchMobileSuccessReport = await evaluate(client, `(() => {
            const cards = [...document.querySelectorAll('.color-card')];
            const targetHex = rgbToHex(gameState.currentTargetColor);
            const target = cards.find((card) => rgbToHex(card.style.backgroundColor) === targetHex);
            const screenTopBefore = elements.colorGridScreen.getBoundingClientRect().top;
            const scrollBefore = window.scrollY;
            target.click();
            const continueRect = elements.matchContinueButton.getBoundingClientRect();
            const screenRect = elements.colorGridScreen.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const targetCodeRect = target.querySelector('.match-card-code').getBoundingClientRect();
            const targetMarkerRect = target.querySelector('.match-card-result').getBoundingClientRect();
            return {
                cardCount: cards.length,
                targetHex,
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                gridStillVisible: !elements.colorGridScreen.classList.contains('hidden'),
                resultScreenHidden: elements.resultScreen.classList.contains('hidden'),
                footerHidden: elements.siteFooter.classList.contains('hidden'),
                resultTitle: elements.matchRoundMessage.textContent,
                resultIcon: elements.matchRoundIconUse.getAttribute('href'),
                levelBeforeContinue: gameState.level,
                correctMarkers: cards.filter((card) => card.classList.contains('is-match-correct')).length,
                wrongMarkers: cards.filter((card) => card.classList.contains('is-match-selected-wrong')).length,
                mutedCards: cards.filter((card) => card.classList.contains('is-match-muted')).length,
                colorCodeCount: cards.filter((card) => card.querySelector('.match-card-code')).length,
                colorCodesFit: cards.every((card) => {
                    const cardRect = card.getBoundingClientRect();
                    const codeRect = card.querySelector('.match-card-code').getBoundingClientRect();
                    return codeRect.left >= cardRect.left && codeRect.right <= cardRect.right
                        && codeRect.top >= cardRect.top && codeRect.bottom <= cardRect.bottom;
                }),
                targetCodeMarkerSeparate: targetCodeRect.right <= targetMarkerRect.left,
                targetMetaFits: targetCodeRect.left >= targetRect.left && targetMarkerRect.right <= targetRect.right,
                targetLabel: target.getAttribute('aria-label'),
                actionsVisible: !elements.matchRoundActions.classList.contains('hidden'),
                buttonsFit: continueRect.left >= screenRect.left - 1 && continueRect.right <= screenRect.right + 1,
                screenTopShift: Math.abs(elements.colorGridScreen.getBoundingClientRect().top - screenTopBefore),
                scrollShift: Math.abs(window.scrollY - scrollBefore)
            };
        })()`);
        if (matchMobileSuccessReport.cardCount !== 16
            || matchMobileSuccessReport.scrollWidth !== matchMobileSuccessReport.viewportWidth
            || !matchMobileSuccessReport.gridStillVisible
            || !matchMobileSuccessReport.resultScreenHidden
            || !matchMobileSuccessReport.footerHidden
            || matchMobileSuccessReport.resultTitle !== '完美匹配！'
            || matchMobileSuccessReport.resultIcon !== '#icon-check-circle'
            || matchMobileSuccessReport.levelBeforeContinue !== 2
            || matchMobileSuccessReport.correctMarkers !== 1
            || matchMobileSuccessReport.wrongMarkers !== 0
            || matchMobileSuccessReport.mutedCards !== 15
            || matchMobileSuccessReport.colorCodeCount !== 16
            || !matchMobileSuccessReport.colorCodesFit
            || !matchMobileSuccessReport.targetCodeMarkerSeparate
            || !matchMobileSuccessReport.targetMetaFits
            || !matchMobileSuccessReport.targetLabel.includes('正确选择')
            || !matchMobileSuccessReport.targetLabel.includes(`色号 ${matchMobileSuccessReport.targetHex}`)
            || !matchMobileSuccessReport.actionsVisible
            || !matchMobileSuccessReport.buttonsFit
            || matchMobileSuccessReport.screenTopShift > 1
            || matchMobileSuccessReport.scrollShift > 1) {
            throw new Error(`Mobile match result continuity failed: ${JSON.stringify(matchMobileSuccessReport)}`);
        }
        await captureScreenshot(client, 'match-inline-success-mobile.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });

        const masterAdvanceReport = await evaluate(client, `(() => {
            gameState.matchDifficulty = 'master';
            gameState.level = 3;
            gameState.matchLastAnswerCorrect = false;
            nextLevel();
            stopActiveCountdown();
            const levelAfterFailure = gameState.level;
            gameState.matchLastAnswerCorrect = true;
            nextLevel();
            stopActiveCountdown();
            return {
                levelAfterFailure,
                levelAfterSuccess: gameState.level
            };
        })()`);
        if (masterAdvanceReport.levelAfterFailure !== 3 || masterAdvanceReport.levelAfterSuccess !== 4) {
            throw new Error(`Master match progression failed: ${JSON.stringify(masterAdvanceReport)}`);
        }

        const matchFinalSummaryReport = await evaluate(client, `(() => {
            gameState.matchDifficulty = 'basic';
            gameState.level = matchDifficultyConfig.basic.totalLevels;
            gameState.isGameActive = true;
            showTargetColor();
            stopActiveCountdown();
            showColorGrid();
            const targetHex = rgbToHex(gameState.currentTargetColor);
            const cards = [...document.querySelectorAll('.color-card')];
            const selected = cards.find((card) => rgbToHex(card.style.backgroundColor) !== targetHex);
            const selectedHex = rgbToHex(selected.style.backgroundColor);
            const originalRandom = Math.random;
            Math.random = () => 0;
            selected.click();
            Math.random = originalRandom;
            const inlineFeedback = {
                gridVisible: !elements.colorGridScreen.classList.contains('hidden'),
                resultHidden: elements.resultScreen.classList.contains('hidden'),
                title: elements.matchRoundMessage.textContent,
                icon: elements.matchRoundIconUse.getAttribute('href'),
                continueLabel: elements.matchContinueButton.textContent,
                completesGame: gameState.matchRoundCompletesGame,
                correctMarkers: cards.filter((card) => card.classList.contains('is-match-correct')).length,
                wrongMarkers: cards.filter((card) => card.classList.contains('is-match-selected-wrong')).length
            };
            elements.matchContinueButton.click();
            const recapTiles = [...document.querySelectorAll('.session-recap-face [data-recap-index]')];
            const lastRecapTile = recapTiles[recapTiles.length - 1];
            return {
                inlineFeedback,
                gridHidden: elements.colorGridScreen.classList.contains('hidden'),
                resultVisible: !elements.resultScreen.classList.contains('hidden'),
                title: elements.resultText.textContent,
                restartVisible: !elements.restartButton.classList.contains('hidden'),
                primaryLabel: elements.finalPrimaryLabel.textContent,
                primaryValue: elements.finalPrimaryValue.textContent,
                correctAnswers: gameState.correctAnswers,
                totalAnswers: gameState.totalAnswers,
                statOne: elements.finalStatOneValue.textContent,
                statLabels: Array.from(document.querySelectorAll('.final-stats > div span'))
                    .map((label) => label.textContent),
                statColumns: getComputedStyle(document.querySelector('.final-stats'))
                    .gridTemplateColumns.split(' ').length,
                lastRecap: {
                    targetHex: lastRecapTile.dataset.targetHex,
                    answerHex: lastRecapTile.dataset.answerHex,
                    outcome: lastRecapTile.dataset.outcome
                },
                expectedTargetHex: targetHex,
                expectedAnswerHex: selectedHex,
                recapVisible: !elements.sessionRecap.classList.contains('hidden'),
                recapMode: elements.sessionRecap.dataset.mode,
                recapToggleLabels: [elements.recapShowTarget.textContent, elements.recapShowAnswer.textContent],
                recapAriaLabels: {
                    toggle: elements.recapShowTarget.parentElement.getAttribute('aria-label'),
                    viewport: elements.recapCubeViewport.getAttribute('aria-label'),
                    list: elements.recapRoundList.getAttribute('aria-label'),
                    target: elements.recapDetailTargetHex.parentElement.getAttribute('aria-label'),
                    answer: elements.recapDetailAnswerHex.parentElement.getAttribute('aria-label')
                },
                recapRounds: document.querySelectorAll('.session-recap-face [data-recap-index]').length,
                footerHidden: elements.siteFooter.classList.contains('hidden'),
                brandHidden: elements.brandHeader.classList.contains('hidden'),
                statsHidden: elements.gameInfoBar.classList.contains('hidden'),
                bodyImmersive: document.body.classList.contains('is-immersive-screen'),
                shellMode: elements.resultScreen.dataset.finalShell,
                shellParts: Array.from(elements.resultScreen.querySelectorAll('[data-final-part]'))
                    .map((part) => part.dataset.finalPart),
                legacyNodesAbsent: [
                    'continue-button',
                    'result-target-color',
                    'result-selected-color',
                    'target-color-code',
                    'selected-color-code',
                    'recall-final-summary'
                ].every((id) => !document.getElementById(id))
            };
        })()`);
        if (!matchFinalSummaryReport.inlineFeedback.gridVisible
            || !matchFinalSummaryReport.inlineFeedback.resultHidden
            || matchFinalSummaryReport.inlineFeedback.title !== '匹配错误，别灰心!'
            || matchFinalSummaryReport.inlineFeedback.icon !== '#icon-x-circle'
            || matchFinalSummaryReport.inlineFeedback.continueLabel !== '查看结果'
            || !matchFinalSummaryReport.inlineFeedback.completesGame
            || matchFinalSummaryReport.inlineFeedback.correctMarkers !== 1
            || matchFinalSummaryReport.inlineFeedback.wrongMarkers !== 1
            || !matchFinalSummaryReport.gridHidden
            || !matchFinalSummaryReport.resultVisible
            || matchFinalSummaryReport.title !== '基础 · 颜色匹配'
            || !matchFinalSummaryReport.restartVisible
            || matchFinalSummaryReport.primaryLabel !== '正确率'
            || matchFinalSummaryReport.primaryValue !== String(Math.round(
                (matchFinalSummaryReport.correctAnswers / matchFinalSummaryReport.totalAnswers) * 100
            ))
            || matchFinalSummaryReport.statOne !== `${matchFinalSummaryReport.correctAnswers} / ${matchFinalSummaryReport.totalAnswers}`
            || JSON.stringify(matchFinalSummaryReport.statLabels) !== JSON.stringify(['答对', '本机最佳'])
            || matchFinalSummaryReport.statColumns !== 2
            || matchFinalSummaryReport.lastRecap.targetHex !== matchFinalSummaryReport.expectedTargetHex
            || matchFinalSummaryReport.lastRecap.answerHex !== matchFinalSummaryReport.expectedAnswerHex
            || matchFinalSummaryReport.lastRecap.outcome !== '未命中'
            || !matchFinalSummaryReport.recapVisible
            || matchFinalSummaryReport.recapMode !== 'match'
            || JSON.stringify(matchFinalSummaryReport.recapToggleLabels) !== JSON.stringify(['目标色', '你的选择'])
            || JSON.stringify(matchFinalSummaryReport.recapAriaLabels) !== JSON.stringify({
                toggle: '切换目标色或你的选择',
                viewport: '三维本局复盘魔方，使用左右方向键切换关卡面',
                list: '当前魔方面关卡',
                target: '目标色',
                answer: '你的选择'
            })
            || matchFinalSummaryReport.recapRounds < 1
            || !matchFinalSummaryReport.footerHidden
            || !matchFinalSummaryReport.brandHidden
            || !matchFinalSummaryReport.statsHidden
            || !matchFinalSummaryReport.bodyImmersive
            || matchFinalSummaryReport.shellMode !== 'shared'
            || JSON.stringify(matchFinalSummaryReport.shellParts) !== JSON.stringify([
                'header', 'summary', 'recap', 'actions'
            ])
            || !matchFinalSummaryReport.legacyNodesAbsent) {
            throw new Error(`Match final summary failed: ${JSON.stringify(matchFinalSummaryReport)}`);
        }
        await captureScreenshot(client, 'match-final-desktop.png');

        const masterFinalSummaryReport = await evaluate(client, `(() => {
            gameState.matchDifficulty = 'master';
            gameState.level = 4;
            gameState.score = 3;
            gameState.correctAnswers = 3;
            gameState.totalAnswers = 3;
            gameState.lives = 1;
            gameState.isGameActive = true;
            showTargetColor();
            stopActiveCountdown();
            showColorGrid();
            const targetHex = rgbToHex(gameState.currentTargetColor);
            const selected = [...document.querySelectorAll('.color-card')]
                .find((card) => rgbToHex(card.style.backgroundColor) !== targetHex);
            const originalRandom = Math.random;
            Math.random = () => 0.99;
            selected.click();
            Math.random = originalRandom;
            const inlineFeedback = {
                lives: gameState.lives,
                gridVisible: !elements.colorGridScreen.classList.contains('hidden'),
                resultHidden: elements.resultScreen.classList.contains('hidden'),
                title: elements.matchRoundMessage.textContent,
                continueLabel: elements.matchContinueButton.textContent,
                completesGame: gameState.matchRoundCompletesGame
            };
            elements.matchContinueButton.click();
            const recapTiles = [...document.querySelectorAll('.session-recap-face [data-recap-index]')];
            const lastRecapTile = recapTiles[recapTiles.length - 1];
            return {
                inlineFeedback,
                resultVisible: !elements.resultScreen.classList.contains('hidden'),
                title: elements.resultText.textContent,
                restartVisible: !elements.restartButton.classList.contains('hidden'),
                primaryLabel: elements.finalPrimaryLabel.textContent,
                primaryValue: elements.finalPrimaryValue.textContent,
                score: gameState.score,
                statOne: elements.finalStatOneValue.textContent,
                level: gameState.level,
                statLabels: Array.from(document.querySelectorAll('.final-stats > div span'))
                    .map((label) => label.textContent),
                recordNote: elements.finalRecordNote.textContent,
                recapOutcome: lastRecapTile.dataset.outcome
            };
        })()`);
        if (masterFinalSummaryReport.inlineFeedback.lives !== 0
            || !masterFinalSummaryReport.inlineFeedback.gridVisible
            || !masterFinalSummaryReport.inlineFeedback.resultHidden
            || masterFinalSummaryReport.inlineFeedback.title !== '匹配错误，已经很接近了!'
            || masterFinalSummaryReport.inlineFeedback.continueLabel !== '查看结果'
            || !masterFinalSummaryReport.inlineFeedback.completesGame
            || !masterFinalSummaryReport.resultVisible
            || masterFinalSummaryReport.title !== '大师 · 颜色匹配'
            || !masterFinalSummaryReport.restartVisible
            || masterFinalSummaryReport.primaryLabel !== '得分'
            || masterFinalSummaryReport.primaryValue !== String(masterFinalSummaryReport.score)
            || masterFinalSummaryReport.statOne !== String(masterFinalSummaryReport.level)
            || JSON.stringify(masterFinalSummaryReport.statLabels) !== JSON.stringify(['最高关卡', '本机最佳'])
            || masterFinalSummaryReport.recordNote !== '新纪录！！'
            || masterFinalSummaryReport.recapOutcome !== '未命中') {
            throw new Error(`Master final summary failed: ${JSON.stringify(masterFinalSummaryReport)}`);
        }

        const matchFinalActionReport = await evaluate(client, `(() => {
            elements.resultChangeDifficulty.click();
            const difficultyVisible = !elements.matchDifficultyScreen.classList.contains('hidden');
            const recapResetForDifficulty = elements.sessionRecap.classList.contains('hidden')
                && gameState.sessionRounds.length > 0;

            gameState.gameMode = 'colorMatch';
            gameState.matchDifficulty = 'basic';
            gameState.score = 5;
            gameState.correctAnswers = 5;
            gameState.totalAnswers = 10;
            showGameEnd();
            elements.restartButton.click();
            stopActiveCountdown();
            return {
                difficultyVisible,
                recapResetForDifficulty,
                restarted: gameState.isGameActive
                    && gameState.level === 1
                    && gameState.score === 0
                    && gameState.correctAnswers === 0
                    && gameState.totalAnswers === 0
                    && gameState.sessionRounds.length === 0
                    && !elements.targetColorScreen.classList.contains('hidden')
                    && elements.resultScreen.classList.contains('hidden')
            };
        })()`);
        if (!matchFinalActionReport.difficultyVisible
            || !matchFinalActionReport.recapResetForDifficulty
            || !matchFinalActionReport.restarted) {
            throw new Error(`Match final actions failed: ${JSON.stringify(matchFinalActionReport)}`);
        }

        await navigate(client, appUrl);
        await evaluate(client, `document.querySelector('#enter-game-button').click()`);
        await waitFor(client, `!document.querySelector('#mode-selection-screen').classList.contains('hidden')`);
        await evaluate(client, `document.querySelector('#color-recall-mode').click()`);
        await waitFor(client, `!document.querySelector('#recall-difficulty-screen').classList.contains('hidden')`);
        await evaluate(client, `document.querySelector('[data-recall-difficulty="advanced"]').click()`);
        await waitFor(client, `!document.querySelector('#start-screen').classList.contains('hidden')`);
        const recallPreparationReport = await evaluate(client, `({
            gameInfoHidden: elements.gameInfoBar.classList.contains('hidden'),
            startVisible: !elements.startScreen.classList.contains('hidden'),
            mode: elements.preparationMode.textContent,
            difficulty: elements.preparationDifficulty.textContent
        })`);
        if (!recallPreparationReport.gameInfoHidden
            || !recallPreparationReport.startVisible
            || recallPreparationReport.mode !== '颜色复现'
            || recallPreparationReport.difficulty !== '进阶 · RGB 控制') {
            throw new Error(`Recall preparation stats visibility failed: ${JSON.stringify(recallPreparationReport)}`);
        }
        await evaluate(client, `(() => {
            document.querySelector('#start-button').click();
            stopActiveCountdown();
            showRecallSection(elements.recallControlSection);
        })()`);
        await waitFor(client, `document.activeElement.id === 'recall-control-title'`);
        const recallStatsReport = await evaluate(client, `({
            gameInfoVisible: !elements.gameInfoBar.classList.contains('hidden'),
            levelLabel: elements.levelLabel.textContent,
            level: elements.levelDisplay.textContent,
            scoreLabel: elements.scoreLabel.textContent,
            score: elements.scoreDisplay.textContent,
            bestLabel: elements.bestScoreLabel.textContent,
            best: elements.bestScoreDisplay.textContent,
            duplicateProgressRemoved: !document.querySelector('#recall-control-progress'),
            statsAnchored: elements.gameInfoAnchor.nextElementSibling === elements.gameInfoBar,
            footerHidden: elements.siteFooter.classList.contains('hidden'),
            brandHidden: elements.brandHeader.classList.contains('hidden'),
            bodyImmersive: document.body.classList.contains('is-immersive-screen'),
            joinedGap: elements.recallControlSection.getBoundingClientRect().top
                - elements.gameInfoBar.getBoundingClientRect().bottom
        })`);
        if (!recallStatsReport.gameInfoVisible
            || recallStatsReport.levelLabel !== '当前轮次'
            || recallStatsReport.level !== '1'
            || recallStatsReport.scoreLabel !== '累计得分'
            || recallStatsReport.score !== '0.00'
            || recallStatsReport.bestLabel !== '进阶最佳'
            || recallStatsReport.best !== '0.00'
            || !recallStatsReport.duplicateProgressRemoved
            || !recallStatsReport.statsAnchored
            || !recallStatsReport.footerHidden
            || !recallStatsReport.brandHidden
            || recallStatsReport.joinedGap < 0
            || recallStatsReport.joinedGap > 24) {
            throw new Error(`Recall stats bar failed: ${JSON.stringify(recallStatsReport)}`);
        }
        await captureScreenshot(client, 'recall-control-desktop.png');
        const redBeforeKey = await evaluate(client, `(() => {
            elements.redSlider.focus();
            return Number(elements.redSlider.value);
        })()`);
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
        const redAfterKey = await evaluate(client, `({
            value: Number(elements.redSlider.value),
            state: gameState.recallUserRGB.r
        })`);
        if (redAfterKey.value !== redBeforeKey + 1 || redAfterKey.state !== redAfterKey.value) {
            throw new Error(`RGB keyboard control failed: ${JSON.stringify({ redBeforeKey, redAfterKey })}`);
        }
        await evaluate(client, `
            gameState.recallUserRGB = { ...gameState.recallTargetRGB };
            updateRecallUserColor();
            submitRecallAnswer();
        `);
        await waitFor(client, `!document.querySelector('#recall-result-section').classList.contains('hidden')`);
        await waitFor(client, `document.activeElement.id === 'recall-result-title'`);

        const recallReport = await evaluate(client, `(() => {
            const details = calculateRecallDistanceDetails(
                gameState.recallTargetRGB,
                gameState.recallUserRGB
            );
            return {
                score: Math.round(scoreFromPerceptualDistance(details.distance) * 100) / 100,
                totalCenti: gameState.recallTotalScoreCenti,
                distance: details.distance,
                displayedScore: document.querySelector('#recall-round-score').textContent,
                feedback: document.querySelector('#recall-round-feedback').textContent,
                guidance: elements.recallRoundGuidance.textContent,
                baseDistance: details.baseDistance,
                neutralPenalty: details.neutralPenalty,
                focused: document.activeElement.id,
                topStatsVisible: !elements.gameInfoBar.classList.contains('hidden'),
                topRound: elements.levelDisplay.textContent,
                topScore: elements.scoreDisplay.textContent
            };
        })()`);
        if (recallReport.score !== 10
            || recallReport.totalCenti !== 1000
            || recallReport.distance !== 0
            || recallReport.displayedScore !== '10.00'
            || recallReport.feedback !== '“你就是Color Master!”'
            || recallReport.guidance !== '色相、饱和度和明度都很接近'
            || recallReport.baseDistance !== 0
            || recallReport.neutralPenalty !== 0
            || recallReport.focused !== 'recall-result-title'
            || !recallReport.topStatsVisible
            || recallReport.topRound !== '1'
            || recallReport.topScore !== '10.00'
            || recallReport.feedback.includes('Oklab')
            || recallReport.feedback.includes('色差')) {
            throw new Error(`Recall regression failed: ${JSON.stringify(recallReport)}`);
        }
        await captureScreenshot(client, 'recall-result-desktop.png');

        const scoreExplanationRemovalReport = await evaluate(client, `(() => {
            const removedPrefix = ['score', 'info'].join('-');
            const result = document.querySelector('#recall-result-section').getBoundingClientRect();
            const feedback = document.querySelector('#recall-round-feedback');
            const feedbackRect = feedback.getBoundingClientRect();
            return {
                buttonAbsent: !document.querySelector('#' + removedPrefix + '-button'),
                dialogAbsent: !document.querySelector('#' + removedPrefix + '-dialog'),
                prefixedIdsAbsent: document.querySelectorAll('[id^="' + removedPrefix + '-"]').length === 0,
                panelAbsent: !document.querySelector('.' + removedPrefix + '-panel'),
                centerDelta: Math.abs(
                    (feedbackRect.left + feedbackRect.right) / 2 - (result.left + result.right) / 2
                ),
                textAlign: getComputedStyle(feedback).textAlign
            };
        })()`);
        if (!scoreExplanationRemovalReport.buttonAbsent
            || !scoreExplanationRemovalReport.dialogAbsent
            || !scoreExplanationRemovalReport.prefixedIdsAbsent
            || !scoreExplanationRemovalReport.panelAbsent
            || scoreExplanationRemovalReport.centerDelta > 1
            || scoreExplanationRemovalReport.textAlign !== 'center') {
            throw new Error(
                `Score explanation removal failed: ${JSON.stringify(scoreExplanationRemovalReport)}`
            );
        }

        const recallNavigationGuardReport = await evaluate(client, `(() => {
            nextRecallRoundOrEnd();
            nextRecallRoundOrEnd();
            stopActiveCountdown();
            return {
                round: gameState.recallRound,
                submitted: gameState.recallRoundSubmitted,
                targetVisible: !elements.recallTargetSection.classList.contains('hidden')
            };
        })()`);
        if (recallNavigationGuardReport.round !== 2
            || recallNavigationGuardReport.submitted
            || !recallNavigationGuardReport.targetVisible) {
            throw new Error(`Recall navigation guard failed: ${JSON.stringify(recallNavigationGuardReport)}`);
        }

        const centiAccumulationReport = await evaluate(client, `(() => {
            const candidates = [
                { r: 0, g: 0, b: 0 },
                { r: 255, g: 255, b: 255 },
                { r: 255, g: 0, b: 0 }
            ];
            gameState.recallUserRGB = candidates.find((color) => (
                Math.round(calculateRecallScore(gameState.recallTargetRGB, color) * 100) % 100 !== 0
            )) || candidates[0];
            gameState.recallTotalScore = 0;
            gameState.recallTotalScoreCenti = 0;
            const expectedRoundCenti = Math.round(
                calculateRecallScore(gameState.recallTargetRGB, gameState.recallUserRGB) * 100
            );
            for (let round = 0; round < 10; round++) {
                gameState.recallRoundSubmitted = false;
                submitRecallAnswer();
            }
            return {
                expectedRoundCenti,
                expectedTotalCenti: expectedRoundCenti * 10,
                totalCenti: gameState.recallTotalScoreCenti,
                total: gameState.recallTotalScore
            };
        })()`);
        if (centiAccumulationReport.expectedRoundCenti % 100 === 0
            || centiAccumulationReport.totalCenti !== centiAccumulationReport.expectedTotalCenti
            || centiAccumulationReport.total !== centiAccumulationReport.totalCenti / 100) {
            throw new Error(`Centi accumulation failed: ${JSON.stringify(centiAccumulationReport)}`);
        }

        await evaluate(client, `(() => {
            stopActiveCountdown();
            gameState.sessionRounds = [];
            resetRecallAttemptState();
            gameState.isGameActive = true;
            startColorRecallRound();
            stopActiveCountdown();
            showRecallSection(elements.recallControlSection);
            for (let round = 0; round < 10; round++) {
                gameState.recallUserRGB = { ...gameState.recallTargetRGB };
                updateRecallUserColor();
                elements.submitRecallBtn.click();
                elements.nextRecallBtn.click();
                if (round < 9) {
                    stopActiveCountdown();
                    showRecallSection(elements.recallControlSection);
                }
            }
        })()`);
        await waitFor(client, `!elements.resultScreen.classList.contains('hidden')`);
        await waitFor(client, `document.activeElement.id === 'result-text'`);
        const persistenceReport = await evaluate(client, `({
            total: gameState.recallTotalScore,
            totalCenti: gameState.recallTotalScoreCenti,
            round: gameState.recallRound,
            best: gameState.recallBestScores.advanced,
            storedV4: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v4'),
            storedV3: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v3'),
            storedV2: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v2'),
            legacyValue: localStorage.getItem('colorMemoryBestRecallScore_advanced'),
            bestLabel: elements.finalStatTwoLabel.textContent,
            recordNote: elements.finalRecordNote.textContent,
            primaryValue: elements.finalPrimaryValue.textContent,
            averageValue: elements.finalStatOneValue.textContent,
            statLabels: Array.from(document.querySelectorAll('.final-stats > div span'))
                .map((label) => label.textContent),
            recapVisible: !elements.sessionRecap.classList.contains('hidden'),
            recapMode: elements.sessionRecap.dataset.mode,
            recapToggleLabels: [elements.recapShowTarget.textContent, elements.recapShowAnswer.textContent],
            recapAriaLabels: {
                toggle: elements.recapShowTarget.parentElement.getAttribute('aria-label'),
                viewport: elements.recapCubeViewport.getAttribute('aria-label'),
                list: elements.recapRoundList.getAttribute('aria-label'),
                target: elements.recapDetailTargetHex.parentElement.getAttribute('aria-label'),
                answer: elements.recapDetailAnswerHex.parentElement.getAttribute('aria-label')
            },
            recapRounds: document.querySelectorAll('.session-recap-face [data-recap-index]').length,
            recapListRounds: elements.recapRoundList.querySelectorAll('[data-recap-index]').length,
            shellMode: elements.resultScreen.dataset.finalShell,
            footerHidden: elements.siteFooter.classList.contains('hidden'),
            brandHidden: elements.brandHeader.classList.contains('hidden'),
            focused: document.activeElement.id
        })`);
        if (persistenceReport.total !== 100
            || persistenceReport.totalCenti !== 10000
            || persistenceReport.round !== 10
            || persistenceReport.best !== 100
            || persistenceReport.storedV4 !== '100'
            || persistenceReport.storedV3 !== '77'
            || persistenceReport.storedV2 !== '88'
            || persistenceReport.legacyValue !== '99'
            || persistenceReport.bestLabel !== '本机最佳'
            || persistenceReport.recordNote !== '首次完成，已记录为本机最佳'
            || persistenceReport.primaryValue !== '100.00'
            || persistenceReport.averageValue !== '10.00 / 10'
            || JSON.stringify(persistenceReport.statLabels) !== JSON.stringify(['平均得分', '本机最佳'])
            || !persistenceReport.recapVisible
            || persistenceReport.recapMode !== 'recall'
            || JSON.stringify(persistenceReport.recapToggleLabels) !== JSON.stringify(['目标色', '你的复现'])
            || JSON.stringify(persistenceReport.recapAriaLabels) !== JSON.stringify({
                toggle: '切换目标色或你的复现',
                viewport: '三维本局复盘魔方，使用左右方向键切换轮次面',
                list: '当前魔方面轮次',
                target: '目标色',
                answer: '你的复现'
            })
            || persistenceReport.recapRounds !== 10
            || persistenceReport.recapListRounds !== 4
            || persistenceReport.shellMode !== 'shared'
            || !persistenceReport.footerHidden
            || !persistenceReport.brandHidden
            || persistenceReport.focused !== 'result-text') {
            throw new Error(`Score persistence regression failed: ${JSON.stringify(persistenceReport)}`);
        }
        await captureScreenshot(client, 'recall-final-desktop.png');

        const improvedRecallRecordReport = await evaluate(client, `(() => {
            const previousBest = gameState.recallBestScores.advanced;
            gameState.recallBestScores.advanced = 75;
            gameState.recallTotalScoreCenti = 8250;
            gameState.recallTotalScore = 82.5;
            showColorRecallResult();
            const report = {
                note: elements.finalRecordNote.textContent,
                best: gameState.recallBestScores.advanced,
                stored: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v4')
            };
            gameState.recallBestScores.advanced = previousBest;
            gameState.recallTotalScoreCenti = previousBest * 100;
            gameState.recallTotalScore = previousBest;
            setStorageItem('colorMemoryBestRecallScore_advanced_oklab_v4', String(previousBest));
            showColorRecallResult();
            return report;
        })()`);
        if (improvedRecallRecordReport.note !== '新纪录！！ 提高了7.50分'
            || improvedRecallRecordReport.best !== 82.5
            || improvedRecallRecordReport.stored !== '82.5') {
            throw new Error(`Improved recall record copy failed: ${JSON.stringify(improvedRecallRecordReport)}`);
        }

        const recapInteractionReport = await evaluate(client, `(() => {
            gameState.sessionRounds = Array.from({ length: 15 }, (_, index) => ({
                mode: 'colorMatch',
                attempt: index + 1,
                round: index + 1,
                targetHex: index === 3 ? '#ffffff' : '#' + (index + 1).toString(16).padStart(6, '0'),
                answerHex: index === 4 ? '#f7f7f7' : '#' + (index + 101).toString(16).padStart(6, '0'),
                correct: index % 3 !== 0
            }));
            renderSessionRecap();
            const visibleTiles = () => Array.from(
                document.querySelectorAll('.session-recap-face [data-recap-index]')
            );
            const initial = {
                status: elements.recapFaceRange.textContent,
                firstRound: visibleTiles()[0].dataset.recapRound,
                lastRound: visibleTiles()[visibleTiles().length - 1].dataset.recapRound,
                tileCount: visibleTiles().length,
                targetColor: visibleTiles()[0].style.backgroundColor,
                tileLabelsAbsent: visibleTiles().every((tile) => tile.childElementCount === 0),
                tilesAccessible: visibleTiles().every((tile) => tile.getAttribute('aria-label')),
                previousDisabled: elements.recapPrevious.disabled,
                nextDisabled: elements.recapNext.disabled
            };

            elements.recapNext.click();
            const afterButton = {
                page: recapState.page,
                status: elements.recapFaceRange.textContent,
                transform: elements.recapCube.style.transform,
                selectedRound: elements.recapDetailRound.textContent,
                turning: elements.recapCube.classList.contains('is-turning')
            };
            const pageTile = document.querySelector('.session-recap-face--right [data-recap-index="4"]');
            const targetColor = pageTile.style.backgroundColor;
            elements.recapShowAnswer.click();
            const answer = {
                targetPressed: elements.recapShowTarget.getAttribute('aria-pressed'),
                answerPressed: elements.recapShowAnswer.getAttribute('aria-pressed'),
                colorChanged: pageTile.style.backgroundColor !== targetColor
            };

            elements.recapCubeViewport.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                bubbles: true,
                cancelable: true
            }));
            const afterKeyboard = {
                page: recapState.page,
                status: elements.recapFaceRange.textContent,
                transform: elements.recapCube.style.transform,
                nextDisabled: elements.recapNext.disabled,
                turning: elements.recapCube.classList.contains('is-turning')
            };

            const touchStart = new Event('touchstart', { bubbles: true });
            Object.defineProperty(touchStart, 'touches', {
                value: [{ clientX: 200, clientY: 100 }]
            });
            const touchEnd = new Event('touchend', { bubbles: true });
            Object.defineProperty(touchEnd, 'changedTouches', {
                value: [{ clientX: 260, clientY: 104 }]
            });
            elements.recapCubeViewport.dispatchEvent(touchStart);
            elements.recapCubeViewport.dispatchEvent(touchEnd);
            const afterTouch = {
                page: recapState.page,
                status: elements.recapFaceRange.textContent,
                transform: elements.recapCube.style.transform,
                turning: elements.recapCube.classList.contains('is-turning')
            };

            const secondRoundOnPage = elements.recapRoundList.querySelector('[data-recap-index="5"]');
            secondRoundOnPage.click();
            const selectedRound = elements.recapDetailRound.textContent;
            const selectedCurrentCount = elements.sessionRecap.querySelectorAll('[aria-current="true"]').length;
            const focusedTile = document.querySelector('.session-recap-face--right [data-recap-index="5"]');
            focusedTile.focus();
            focusedTile.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                bubbles: true,
                cancelable: true
            }));
            const tileKeyboard = {
                page: recapState.page,
                focusReturnedToViewport: document.activeElement === elements.recapCubeViewport,
                previousFaceHidden: elements.recapFaces[1].getAttribute('aria-hidden') === 'true',
                previousTileUntabbable: focusedTile.tabIndex === -1,
                turning: elements.recapCube.classList.contains('is-turning')
            };
            updateRecapPage(1);
            return {
                initial,
                afterButton,
                answer,
                afterKeyboard,
                afterTouch,
                selectedRound,
                selectedCurrentCount,
                tileKeyboard,
                faceAccessibility: Array.from(elements.recapFaces, (face) => ({
                    hidden: face.getAttribute('aria-hidden'),
                    tabbable: face.querySelectorAll('button[tabindex="0"]').length
                }))
            };
        })()`);
        if (recapInteractionReport.initial.status !== '第4–7关'
            || recapInteractionReport.initial.firstRound !== '4'
            || recapInteractionReport.initial.lastRound !== '15'
            || recapInteractionReport.initial.tileCount !== 12
            || !recapInteractionReport.initial.tileLabelsAbsent
            || !recapInteractionReport.initial.tilesAccessible
            || !recapInteractionReport.initial.previousDisabled
            || recapInteractionReport.initial.nextDisabled
            || recapInteractionReport.afterButton.page !== 1
            || recapInteractionReport.afterButton.status !== '第8–11关'
            || recapInteractionReport.afterButton.transform !== 'rotateY(-90deg)'
            || recapInteractionReport.afterButton.selectedRound !== '第8关'
            || !recapInteractionReport.afterButton.turning
            || recapInteractionReport.answer.targetPressed !== 'false'
            || recapInteractionReport.answer.answerPressed !== 'true'
            || !recapInteractionReport.answer.colorChanged
            || recapInteractionReport.afterKeyboard.page !== 2
            || recapInteractionReport.afterKeyboard.status !== '第12–15关'
            || recapInteractionReport.afterKeyboard.transform !== 'rotateY(-180deg)'
            || !recapInteractionReport.afterKeyboard.nextDisabled
            || recapInteractionReport.afterKeyboard.turning
            || recapInteractionReport.afterTouch.page !== 1
            || recapInteractionReport.afterTouch.status !== '第8–11关'
            || recapInteractionReport.afterTouch.transform !== 'rotateY(-90deg)'
            || !recapInteractionReport.afterTouch.turning
            || recapInteractionReport.selectedRound !== '第9关'
            || recapInteractionReport.selectedCurrentCount !== 2
            || recapInteractionReport.tileKeyboard.page !== 2
            || !recapInteractionReport.tileKeyboard.focusReturnedToViewport
            || !recapInteractionReport.tileKeyboard.previousFaceHidden
            || !recapInteractionReport.tileKeyboard.previousTileUntabbable
            || recapInteractionReport.tileKeyboard.turning
            || JSON.stringify(recapInteractionReport.faceAccessibility) !== JSON.stringify([
                { hidden: 'true', tabbable: 0 },
                { hidden: 'false', tabbable: 4 },
                { hidden: 'true', tabbable: 0 }
            ])) {
            throw new Error(`Session recap interaction failed: ${JSON.stringify(recapInteractionReport)}`);
        }
        await captureScreenshot(client, 'session-recap-desktop.png');

        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });
        await delay(100);
        const recapMobileReport = await evaluate(client, `(() => {
            const viewport = elements.recapCubeViewport.getBoundingClientRect();
            const controls = document.querySelector('.recap-navigation').getBoundingClientRect();
            const result = elements.resultScreen.getBoundingClientRect();
            return {
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                viewportLeft: viewport.left,
                viewportRight: viewport.right,
                controlsLeft: controls.left,
                controlsRight: controls.right,
                resultLeft: result.left,
                resultRight: result.right,
                footerHidden: elements.siteFooter.classList.contains('hidden'),
                rangeHidden: getComputedStyle(elements.recapFaceRange).display === 'none',
                indexVisible: getComputedStyle(elements.recapFaceIndex).display !== 'none',
                indexText: elements.recapFaceIndex.textContent,
                buttonsFit: Array.from(elements.sessionRecap.querySelectorAll('button')).every((button) => {
                    const rect = button.getBoundingClientRect();
                    return rect.left >= result.left - 1 && rect.right <= result.right + 1;
                })
            };
        })()`);
        if (recapMobileReport.scrollWidth > recapMobileReport.viewportWidth
            || recapMobileReport.viewportLeft < recapMobileReport.resultLeft - 1
            || recapMobileReport.viewportRight > recapMobileReport.resultRight + 1
            || recapMobileReport.controlsLeft < recapMobileReport.resultLeft - 1
            || recapMobileReport.controlsRight > recapMobileReport.resultRight + 1
            || !recapMobileReport.footerHidden
            || !recapMobileReport.rangeHidden
            || !recapMobileReport.indexVisible
            || recapMobileReport.indexText !== '2/3'
            || !recapMobileReport.buttonsFit) {
            throw new Error(`Session recap mobile layout failed: ${JSON.stringify(recapMobileReport)}`);
        }
        await captureScreenshot(client, 'session-recap-mobile.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });
        await client.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
        });
        const recapReducedMotionReport = await evaluate(client, `(() => {
            updateRecapPage(2, true, true);
            return {
                page: recapState.page,
                transform: elements.recapCube.style.transform,
                turning: elements.recapCube.classList.contains('is-turning')
            };
        })()`);
        if (recapReducedMotionReport.page !== 2
            || recapReducedMotionReport.transform !== 'rotateY(-180deg)'
            || recapReducedMotionReport.turning) {
            throw new Error(`Session recap reduced motion failed: ${JSON.stringify(recapReducedMotionReport)}`);
        }
        await client.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
        });

        const recapFlatFallbackReport = await evaluate(client, `(() => {
            const originalSupports = window.CSS.supports;
            window.CSS.supports = () => false;
            updateRecapPage(0, true, true);
            const report = {
                flat: elements.recapCubeStage.classList.contains('is-flat'),
                turning: elements.recapCube.classList.contains('is-turning'),
                activeFaceDisplay: getComputedStyle(elements.recapFaces[0]).display,
                hiddenFaceDisplay: getComputedStyle(elements.recapFaces[1]).display,
                cubeTransform: getComputedStyle(elements.recapCube).transform
            };
            window.CSS.supports = originalSupports;
            updateRecapPage(1);
            return report;
        })()`);
        if (!recapFlatFallbackReport.flat
            || recapFlatFallbackReport.turning
            || recapFlatFallbackReport.activeFaceDisplay !== 'grid'
            || recapFlatFallbackReport.hiddenFaceDisplay !== 'none'
            || recapFlatFallbackReport.cubeTransform !== 'none') {
            throw new Error(`Session recap flat fallback failed: ${JSON.stringify(recapFlatFallbackReport)}`);
        }

        const finalActionReport = await evaluate(client, `(() => {
            elements.resultChangeDifficulty.click();
            const difficultyVisible = !elements.recallDifficultyScreen.classList.contains('hidden');
            const resetAfterDifficulty = gameState.recallRound === 1 && gameState.recallTotalScore === 0;

            gameState.recallTotalScoreCenti = 10000;
            gameState.recallTotalScore = 100;
            gameState.recallRound = gameState.recallTotalRounds;
            showColorRecallResult();
            elements.restartButton.click();
            const restarted = gameState.isGameActive
                && gameState.recallRound === 1
                && !elements.colorRecallScreen.classList.contains('hidden')
                && !elements.recallTargetSection.classList.contains('hidden');
            stopActiveCountdown();
            return { difficultyVisible, resetAfterDifficulty, restarted };
        })()`);
        if (!finalActionReport.difficultyVisible
            || !finalActionReport.resetAfterDifficulty
            || !finalActionReport.restarted) {
            throw new Error(`Final recall actions failed: ${JSON.stringify(finalActionReport)}`);
        }

        await navigate(client, appUrl);
        const reloadedBest = await evaluate(client, `gameState.recallBestScores.advanced`);
        if (reloadedBest !== 100) {
            throw new Error(`Reloaded V2 best score was ${reloadedBest}, expected 100.`);
        }
        await evaluate(client, `document.querySelector('#enter-game-button').click()`);
        await waitFor(client, `!document.querySelector('#mode-selection-screen').classList.contains('hidden')`);
        await evaluate(client, `document.querySelector('#color-recall-mode').click()`);
        await waitFor(client, `!document.querySelector('#recall-difficulty-screen').classList.contains('hidden')`);
        await evaluate(client, `document.querySelector('[data-recall-difficulty="basic"]').click()`);
        await waitFor(client, `!document.querySelector('#start-screen').classList.contains('hidden')`);
        await evaluate(client, `(() => {
            document.querySelector('#start-button').click();
            stopActiveCountdown();
            showRecallSection(elements.recallControlSection);
            updateHSLPointerPosition();
        })()`);
        await waitFor(client, `document.activeElement.id === 'recall-control-title'`);
        const basicRecallReport = await evaluate(client, `(() => {
            const wheel = elements.hslWheel.getBoundingClientRect();
            const pointer = elements.hslWheelPointer.getBoundingClientRect();
            return {
                targetHsl: { ...gameState.recallTargetHSL },
                userHsl: { ...gameState.recallUserHSL },
                hueSlider: Number(elements.hueSlider.value),
                saturationSlider: Number(elements.saturationSlider.value),
                lightnessSlider: Number(elements.lightnessSlider.value),
                hueValue: elements.hueValue.textContent,
                saturationValue: elements.saturationValue.textContent,
                lightnessValue: elements.lightnessValue.textContent,
                userColor: getComputedStyle(elements.recallUserColor).backgroundColor,
                userCode: elements.recallUserCodeDisplay.textContent,
                pointerCenterDelta: Math.hypot(
                    (pointer.left + pointer.right) / 2 - (wheel.left + wheel.right) / 2,
                    (pointer.top + pointer.bottom) / 2 - (wheel.top + wheel.bottom) / 2
                )
            };
        })()`);
        if (JSON.stringify(basicRecallReport.userHsl) !== JSON.stringify({ h: 180, s: 0, l: 50 })
            || basicRecallReport.hueSlider !== 180
            || basicRecallReport.saturationSlider !== 0
            || basicRecallReport.lightnessSlider !== 50
            || basicRecallReport.hueValue !== '180°'
            || basicRecallReport.saturationValue !== '0%'
            || basicRecallReport.lightnessValue !== '50%'
            || basicRecallReport.userColor !== 'rgb(128, 128, 128)'
            || basicRecallReport.userCode !== 'hsl(180, 0%, 50%)'
            || basicRecallReport.pointerCenterDelta > 0.5) {
            throw new Error(`Basic recall neutral start failed: ${JSON.stringify(basicRecallReport)}`);
        }
        await evaluate(client, `elements.hueSlider.value = 0; elements.hueSlider.focus();`);
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
        const hueKeyboardReport = await evaluate(client, `({
            value: Number(elements.hueSlider.value),
            state: gameState.recallUserHSL.h
        })`);
        if (hueKeyboardReport.value !== 1 || hueKeyboardReport.state !== 1) {
            throw new Error(`HSL keyboard control failed: ${JSON.stringify(hueKeyboardReport)}`);
        }
        const basicExactReport = await evaluate(client, `(() => {
            elements.hueSlider.value = gameState.recallTargetHSL.h;
            elements.saturationSlider.value = gameState.recallTargetHSL.s;
            elements.lightnessSlider.value = gameState.recallTargetHSL.l;
            elements.hueSlider.dispatchEvent(new Event('input', { bubbles: true }));
            elements.saturationSlider.dispatchEvent(new Event('input', { bubbles: true }));
            elements.lightnessSlider.dispatchEvent(new Event('input', { bubbles: true }));
            submitRecallAnswer();
            const details = calculateRecallDistanceDetails(
                gameState.recallTargetRGB,
                getRecallUserRGB()
            );
            return {
                score: Math.round(scoreFromPerceptualDistance(details.distance) * 100) / 100,
                distance: details.distance,
                selectedHsl: { ...gameState.recallUserHSL },
                targetHsl: { ...gameState.recallTargetHSL }
            };
        })()`);
        if (basicExactReport.score !== 10
            || basicExactReport.distance !== 0
            || JSON.stringify(basicExactReport.selectedHsl) !== JSON.stringify(basicExactReport.targetHsl)) {
            throw new Error(`Basic recall cannot reach full score: ${JSON.stringify(basicExactReport)}`);
        }

        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });
        await openRecallControl(client, appUrl, 'basic');
        const basicDesktopWorkbenchReport = await evaluate(client, `(() => {
            const shell = elements.colorRecallScreen.getBoundingClientRect();
            const wheel = document.querySelector('.hsl-wheel-container').getBoundingClientRect();
            const sliders = document.querySelector('.hsl-slider-stack').getBoundingClientRect();
            const submit = elements.submitRecallBtn.getBoundingClientRect();
            return {
                viewportHeight: window.innerHeight,
                shellTop: shell.top,
                shellBottom: shell.bottom,
                submitBottom: submit.bottom,
                horizontalWorkbench: sliders.left >= wheel.right,
                statsAnchored: elements.gameInfoAnchor.nextElementSibling === elements.gameInfoBar,
                statsOutsideShell: elements.gameInfoBar.parentElement !== elements.colorRecallScreen,
                footerHidden: elements.siteFooter.classList.contains('hidden')
            };
        })()`);
        if (basicDesktopWorkbenchReport.shellTop < 0
            || basicDesktopWorkbenchReport.shellBottom > basicDesktopWorkbenchReport.viewportHeight + 1
            || basicDesktopWorkbenchReport.submitBottom > basicDesktopWorkbenchReport.viewportHeight + 1
            || !basicDesktopWorkbenchReport.horizontalWorkbench
            || !basicDesktopWorkbenchReport.statsAnchored
            || !basicDesktopWorkbenchReport.statsOutsideShell
            || !basicDesktopWorkbenchReport.footerHidden) {
            throw new Error(`Basic desktop workbench failed: ${JSON.stringify(basicDesktopWorkbenchReport)}`);
        }
        const hslDragFlushReport = await evaluate(client, `(() => {
            const rect = elements.hslWheel.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            elements.hslWheel.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, buttons: 1
            }));
            document.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, cancelable: true, clientX: rect.right, clientY: centerY, buttons: 1
            }));
            document.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true, cancelable: true, clientX: rect.right, clientY: centerY
            }));
            return {
                hue: gameState.recallUserHSL.h,
                saturation: gameState.recallUserHSL.s
            };
        })()`);
        if (Math.abs(hslDragFlushReport.hue - 90) > 1 || hslDragFlushReport.saturation !== 100) {
            throw new Error(`HSL drag flush failed: ${JSON.stringify(hslDragFlushReport)}`);
        }
        await captureScreenshot(client, 'recall-control-basic-desktop.png');

        const viewports = [
            { width: 375, height: 667 },
            { width: 390, height: 844 },
            { width: 360, height: 800 },
            { width: 430, height: 932 }
        ];
        const mobileMatchStageReports = [];
        const mobileObservationReports = [];
        for (const viewport of viewports) {
            await client.send('Emulation.setDeviceMetricsOverride', {
                ...viewport,
                deviceScaleFactor: 2,
                mobile: true
            });
            await openObservation(client, appUrl, 'match');
            const matchStageReport = await evaluate(client, `(() => {
                const measure = (stage) => {
                    const rect = stage.getBoundingClientRect();
                    return { top: rect.top, bottom: rect.bottom, height: rect.height };
                };
                const observation = measure(elements.targetColorScreen);
                const observationToolbar = elements.targetColorScreen.querySelector('.game-stage-toolbar')
                    .getBoundingClientRect();
                const observationHeading = elements.targetColorScreen.querySelector('.game-stage-title')
                    .getBoundingClientRect();
                const observationSwatch = elements.targetColor.getBoundingClientRect();
                const observationSpaceBefore = observationHeading.top - observationToolbar.bottom;
                const observationSpaceAfter = observation.bottom - observationSwatch.bottom;
                showColorGrid();
                const selection = measure(elements.colorGridScreen);
                const selectionToolbar = elements.colorGridScreen.querySelector('.game-stage-toolbar')
                    .getBoundingClientRect();
                const selectionHeading = elements.matchRoundTitle.getBoundingClientRect();
                const selectionGrid = elements.colorGrid.getBoundingClientRect();
                const selectionSpaceBefore = selectionHeading.top - selectionToolbar.bottom;
                const selectionSpaceAfter = selection.bottom - selectionGrid.bottom;
                const targetHex = rgbToHex(gameState.currentTargetColor);
                const targetCard = Array.from(elements.colorGrid.querySelectorAll('.color-card'))
                    .find((card) => rgbToHex(card.style.backgroundColor) === targetHex);
                targetCard.click();
                const feedback = measure(elements.colorGridScreen);
                const actions = elements.matchRoundActions.getBoundingClientRect();
                const stages = [observation, selection, feedback];
                return {
                    viewportWidth: document.documentElement.clientWidth,
                    viewportHeight: window.visualViewport?.height || window.innerHeight,
                    scrollWidth: document.documentElement.scrollWidth,
                    observation,
                    selection,
                    feedback,
                    topDelta: Math.max(...stages.map((stage) => stage.top))
                        - Math.min(...stages.map((stage) => stage.top)),
                    bottomDelta: Math.max(...stages.map((stage) => stage.bottom))
                        - Math.min(...stages.map((stage) => stage.bottom)),
                    heightDelta: Math.max(...stages.map((stage) => stage.height))
                        - Math.min(...stages.map((stage) => stage.height)),
                    observationBalanceDelta: Math.abs(observationSpaceBefore - observationSpaceAfter),
                    selectionBalanceDelta: Math.abs(selectionSpaceBefore - selectionSpaceAfter),
                    feedbackActionsFit: actions.bottom <= feedback.bottom - 11
                };
            })()`);
            mobileMatchStageReports.push({ ...viewport, ...matchStageReport });
            if (matchStageReport.scrollWidth > matchStageReport.viewportWidth
                || matchStageReport.topDelta > 1
                || matchStageReport.bottomDelta > 1
                || matchStageReport.heightDelta > 1
                || matchStageReport.observationBalanceDelta > 20
                || matchStageReport.selectionBalanceDelta > 20
                || !matchStageReport.feedbackActionsFit
                || matchStageReport.feedback.bottom > matchStageReport.viewportHeight + 1) {
                throw new Error(`Mobile match stage alignment failed: ${JSON.stringify({
                    viewport,
                    report: matchStageReport
                })}`);
            }
            if (viewport.width === 390 && viewport.height === 844) {
                await openObservation(client, appUrl, 'match');
                await captureScreenshot(client, 'match-stage-observation-mobile.png');
                await evaluate(client, `showColorGrid()`);
                await captureScreenshot(client, 'match-stage-selection-mobile.png');
                await evaluate(client, `(() => {
                    const targetHex = rgbToHex(gameState.currentTargetColor);
                    const targetCard = Array.from(elements.colorGrid.querySelectorAll('.color-card'))
                        .find((card) => rgbToHex(card.style.backgroundColor) === targetHex);
                    targetCard.click();
                })()`);
                await captureScreenshot(client, 'match-stage-feedback-mobile.png');
            }
            for (const mode of ['match', 'recall']) {
                await openObservation(client, appUrl, mode);
                const report = await evaluate(client, `(() => {
                    const isRecall = ${JSON.stringify(mode)} === 'recall';
                    const stageElement = document.querySelector(isRecall
                        ? '#recall-target-section'
                        : '#target-color-screen');
                    const stage = stageElement.getBoundingClientRect();
                    const swatch = document.querySelector(isRecall
                        ? '#recall-target-color'
                        : '#target-color').getBoundingClientRect();
                    const toolbar = stageElement.querySelector('.game-stage-toolbar').getBoundingClientRect();
                    const heading = stageElement.querySelector('.game-stage-title').getBoundingClientRect();
                    const viewportHeight = window.visualViewport?.height || window.innerHeight;
                    return {
                        viewportWidth: document.documentElement.clientWidth,
                        viewportHeight,
                        scrollWidth: document.documentElement.scrollWidth,
                        scrollHeight: document.documentElement.scrollHeight,
                        stageTop: stage.top,
                        stageBottom: stage.bottom,
                        stageHeight: stage.height,
                        swatchBottom: swatch.bottom,
                        swatchToStageBottom: stage.bottom - swatch.bottom,
                        stageToViewportBottom: viewportHeight - stage.bottom,
                        contentBalanceDelta: Math.abs(
                            (heading.top - toolbar.bottom)
                            - (stage.bottom - swatch.bottom)
                        ),
                        bottomGapBalanceDelta: Math.abs(
                            (stage.bottom - swatch.bottom)
                            - (viewportHeight - stage.bottom)
                        )
                    };
                })()`);
                mobileObservationReports.push({ ...viewport, mode, ...report });
                if (viewport.width === 390 && viewport.height === 844) {
                    await captureScreenshot(client, `observation-${mode}-mobile.png`);
                }
                if (report.scrollWidth > report.viewportWidth
                    || report.scrollHeight > report.viewportHeight + 1
                    || report.stageTop < 0
                    || report.stageBottom > report.viewportHeight + 1
                    || Math.abs(report.stageTop - matchStageReport.observation.top) > 1
                    || Math.abs(report.stageBottom - matchStageReport.observation.bottom) > 1
                    || Math.abs(report.stageHeight - matchStageReport.observation.height) > 1
                    || report.swatchToStageBottom < 56
                    || report.contentBalanceDelta > 20
                    || report.stageToViewportBottom < -1) {
                    throw new Error(`Mobile observation regression failed: ${JSON.stringify({ viewport, mode, report })}`);
                }
            }
        }

        const mobileReports = [];
        for (const viewport of viewports) {
            await client.send('Emulation.setDeviceMetricsOverride', {
                ...viewport,
                deviceScaleFactor: 2,
                mobile: true
            });
            for (const difficulty of ['basic', 'advanced', 'master']) {
                await openRecallControl(client, appUrl, difficulty);
                const report = await evaluate(client, `(() => {
                    const viewportHeight = window.visualViewport?.height || window.innerHeight;
                    const submit = elements.submitRecallBtn.getBoundingClientRect();
                    const exit = document.querySelector('#recall-control-section [data-back-target="start"]').getBoundingClientRect();
                    const preview = elements.recallPreviewPanel.getBoundingClientRect();
                    const previewSwatch = elements.recallUserColor.getBoundingClientRect();
                    const previewLabel = elements.recallPreviewPanel.querySelector(':scope > p').getBoundingClientRect();
                    const previewCode = elements.recallUserCodeDisplay.getBoundingClientRect();
                    const wheel = document.querySelector('.hsl-wheel-container').getBoundingClientRect();
                    return {
                        difficulty: gameState.recallDifficulty,
                        viewportWidth: document.documentElement.clientWidth,
                        viewportHeight,
                        scrollWidth: document.documentElement.scrollWidth,
                        scrollHeight: document.documentElement.scrollHeight,
                        submitTop: submit.top,
                        submitBottom: submit.bottom,
                        exitTop: exit.top,
                        gameInfoHidden: elements.gameInfoBar.classList.contains('hidden'),
                        statsBottom: elements.gameInfoBar.getBoundingClientRect().bottom,
                        roundLabel: elements.levelLabel.textContent,
                        round: elements.levelDisplay.textContent,
                        scoreLabel: elements.scoreLabel.textContent,
                        previewHidden: elements.recallPreviewPanel.classList.contains('hidden'),
                        previewWidth: preview.width,
                        previewHeight: preview.height,
                        previewSwatchWidth: previewSwatch.width,
                        previewSwatchHeight: previewSwatch.height,
                        previewSwatchCenterDelta: Math.abs(
                            (previewSwatch.left + previewSwatch.right) / 2
                            - (preview.left + preview.right) / 2
                        ),
                        previewMetaCenterDelta: Math.abs(
                            (previewLabel.top + previewLabel.bottom) / 2
                            - (previewCode.top + previewCode.bottom) / 2
                        ),
                        previewSwatchBelowMeta: previewSwatch.top
                            > Math.max(previewLabel.bottom, previewCode.bottom),
                        wheelWidth: wheel.width
                    };
                })()`);
                mobileReports.push({ ...viewport, ...report });
                if (viewport.width === 390 && viewport.height === 844 && difficulty === 'basic') {
                    await captureScreenshot(client, 'recall-control-mobile.png');
                }
                const expectsPreview = difficulty !== 'master';
                if (report.scrollWidth > report.viewportWidth
                    || report.scrollHeight > report.viewportHeight + 1
                    || report.submitTop < 0
                    || report.submitBottom > report.viewportHeight + 1
                    || report.exitTop < 0
                    || report.gameInfoHidden
                    || report.statsBottom > report.exitTop
                    || report.roundLabel !== '当前轮次'
                    || report.round !== '1'
                    || report.scoreLabel !== '累计得分'
                    || report.previewHidden === expectsPreview
                    || (expectsPreview
                        && Math.abs(report.previewSwatchWidth - report.previewSwatchHeight) > 0.5)
                    || (expectsPreview
                        && (report.previewSwatchWidth < 112 || report.previewSwatchWidth > 141))
                    || (expectsPreview && report.previewSwatchCenterDelta > 0.5)
                    || (expectsPreview && report.previewMetaCenterDelta > 0.5)
                    || (expectsPreview && !report.previewSwatchBelowMeta)
                    || (difficulty === 'basic' && (report.wheelWidth < 132 || report.wheelWidth > 148))) {
                    throw new Error(`Mobile control regression failed: ${JSON.stringify({ viewport, report })}`);
                }
            }
        }

        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 375,
            height: 667,
            deviceScaleFactor: 2,
            mobile: true
        });
        await openRecallControl(client, appUrl, 'basic');
        await evaluate(client, `
            document.documentElement.style.fontSize = '200%';
            document.documentElement.style.scrollBehavior = 'auto';
        `);
        await delay(100);
        await evaluate(client, `document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight`);
        await delay(100);
        const zoomReport = await evaluate(client, `(() => {
            const submit = elements.submitRecallBtn.getBoundingClientRect();
            return {
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight,
                viewportHeight: window.visualViewport?.height || window.innerHeight,
                scrollY: window.scrollY,
                submitTop: submit.top,
                submitBottom: submit.bottom
            };
        })()`);
        if (zoomReport.scrollWidth > zoomReport.viewportWidth
            || zoomReport.submitTop < 0
            || zoomReport.submitBottom > zoomReport.viewportHeight + 1) {
            throw new Error(`200% text scaling regression failed: ${JSON.stringify(zoomReport)}`);
        }

        await evaluate(client, `(() => {
            gameState.recallTotalScoreCenti = 10000;
            gameState.recallTotalScore = 100;
            gameState.recallRound = gameState.recallTotalRounds;
            showColorRecallResult();
        })()`);
        await delay(100);
        const finalZoomReport = await collectFinalZoomReport(client);
        if (finalZoomReport.scrollWidth > finalZoomReport.viewportWidth
            || finalZoomReport.score !== '100.00'
            || finalZoomReport.average !== '10.00 / 10'
            || finalZoomReport.restartLabel !== '再玩一次'
            || !finalZoomReport.changeDifficultyVisible
            || !finalZoomReport.scorePanelFits
            || !finalZoomReport.statsFit
            || !finalZoomReport.footerHidden
            || !finalZoomReport.brandHidden
            || JSON.stringify(finalZoomReport.shellParts) !== JSON.stringify([
                'header', 'summary', 'recap', 'actions'
            ])
            || finalZoomReport.overflowElements.length) {
            throw new Error(`Final summary text scaling failed: ${JSON.stringify(finalZoomReport)}`);
        }

        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 320,
            height: 667,
            deviceScaleFactor: 2,
            mobile: true
        });
        await delay(100);
        const narrowFinalZoomReport = await collectFinalZoomReport(client);
        if (narrowFinalZoomReport.scrollWidth > narrowFinalZoomReport.viewportWidth
            || !narrowFinalZoomReport.scorePanelFits
            || !narrowFinalZoomReport.statsFit
            || narrowFinalZoomReport.overflowElements.length) {
            throw new Error(`Narrow final summary scaling failed: ${JSON.stringify(narrowFinalZoomReport)}`);
        }

        const populatedRecapZoomReport = await evaluate(client, `(() => {
            gameState.sessionRounds = Array.from({ length: 12 }, (_, index) => ({
                mode: 'colorRecall',
                round: index + 1,
                targetHex: index === 0 ? '#ffffff' : '#' + (index + 17).toString(16).padStart(6, '0'),
                answerHex: index === 0 ? '#f0f0f0' : '#' + (index + 117).toString(16).padStart(6, '0'),
                score: 8.25,
                perceptualDistance: 9.5,
                guidance: '色相接近，继续校准明度与饱和度'
            }));
            renderSessionRecap();
            const result = elements.resultScreen.getBoundingClientRect();
            const recap = elements.sessionRecap.getBoundingClientRect();
            const layout = document.querySelector('.session-recap-layout');
            const cubeColumn = document.querySelector('.recap-cube-column').getBoundingClientRect();
            const cubeViewport = elements.recapCubeViewport.getBoundingClientRect();
            const cubeStage = elements.recapCubeStage.getBoundingClientRect();
            const inspector = document.querySelector('.recap-inspector').getBoundingClientRect();
            const countColumns = (element) => getComputedStyle(element).gridTemplateColumns
                .split(' ')
                .filter(Boolean)
                .length;
            return {
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                resultFits: elements.resultScreen.scrollWidth <= elements.resultScreen.clientWidth,
                recapFits: elements.sessionRecap.scrollWidth <= elements.sessionRecap.clientWidth,
                recapVisible: !elements.sessionRecap.classList.contains('hidden'),
                layoutColumns: countColumns(layout),
                roundListColumns: countColumns(elements.recapRoundList),
                colorPairColumns: countColumns(document.querySelector('.recap-color-pair')),
                inspectorWidth: inspector.width,
                inspectorWithinResult: inspector.left >= result.left - 1 && inspector.right <= result.right + 1,
                inspectorBelowCube: inspector.top >= cubeColumn.bottom - 1,
                cubeFitsViewport: cubeStage.width <= cubeViewport.width + 1,
                recapWithinResult: recap.left >= result.left - 1 && recap.right <= result.right + 1,
                controlsFit: Array.from(elements.sessionRecap.querySelectorAll('button')).every((button) => {
                    const rect = button.getBoundingClientRect();
                    return rect.left >= result.left - 1 && rect.right <= result.right + 1;
                }),
                roundButtonsFit: Array.from(elements.recapRoundList.children).every((button) => (
                    button.scrollWidth <= button.clientWidth
                )),
                footerHidden: elements.siteFooter.classList.contains('hidden')
            };
        })()`);
        if (populatedRecapZoomReport.scrollWidth > populatedRecapZoomReport.viewportWidth
            || !populatedRecapZoomReport.resultFits
            || !populatedRecapZoomReport.recapFits
            || !populatedRecapZoomReport.recapVisible
            || populatedRecapZoomReport.layoutColumns !== 1
            || populatedRecapZoomReport.roundListColumns !== 1
            || populatedRecapZoomReport.colorPairColumns !== 1
            || populatedRecapZoomReport.inspectorWidth <= 0
            || !populatedRecapZoomReport.inspectorWithinResult
            || !populatedRecapZoomReport.inspectorBelowCube
            || !populatedRecapZoomReport.cubeFitsViewport
            || !populatedRecapZoomReport.recapWithinResult
            || !populatedRecapZoomReport.controlsFit
            || !populatedRecapZoomReport.roundButtonsFit
            || !populatedRecapZoomReport.footerHidden) {
            throw new Error(`Populated recap text scaling failed: ${JSON.stringify(populatedRecapZoomReport)}`);
        }
        await evaluate(client, `elements.sessionRecap.scrollIntoView({ block: 'start' })`);
        await captureScreenshot(client, 'session-recap-zoom.png');

        const offlineReport = await evaluate(client, `(() => {
            const resultIcon = elements.resultIcon.querySelector('.ui-icon');
            const resultIconBox = resultIcon?.getBoundingClientRect();
            return {
                stylesheets: Array.from(document.styleSheets).map((sheet) => sheet.href),
                localIcons: document.querySelectorAll('.ui-icon use').length,
                resultIcon: resultIcon?.querySelector('use')?.getAttribute('href'),
                resultIconWidth: resultIconBox?.width || 0,
                resultIconHeight: resultIconBox?.height || 0,
                tailwindApplied: getComputedStyle(document.body).boxSizing === 'border-box'
                    && getComputedStyle(elements.enterGameButton).display.includes('flex')
            };
        })()`);
        const localStylesheets = offlineReport.stylesheets.filter(Boolean);
        if (client.remoteRequests.length
            || localStylesheets.length !== 2
            || !localStylesheets.every((href) => href.startsWith('file:'))
            || !localStylesheets.some((href) => new URL(href).pathname.endsWith('/tailwind.css'))
            || !localStylesheets.some((href) => new URL(href).pathname.endsWith('/styles.css'))
            || offlineReport.localIcons < 30
            || offlineReport.resultIcon !== '#icon-paint-brush'
            || offlineReport.resultIconWidth <= 0
            || offlineReport.resultIconHeight <= 0
            || !offlineReport.tailwindApplied) {
            throw new Error(`Offline asset regression failed: ${JSON.stringify({
                ...offlineReport,
                remoteRequests: client.remoteRequests
            })}`);
        }

        if (client.exceptions.length) {
            throw new Error(`Browser exceptions: ${JSON.stringify(client.exceptions)}`);
        }

        console.log(JSON.stringify({
            matchReport,
            matchPreparationReport,
            legacyIsolationReport,
            startupStorageFailureReport,
            blockedStorageThemeReport,
            storageFailureReport,
            audioFailureReport,
            startupFailClosedReport,
            homepageReport,
            desktopShellReport,
            homepageMobileReport,
            narrowLandingReport,
            landingZoomReport,
            themeStructureReport,
            keyboardThemeStartReport,
            rapidThemeInputReport,
            amethystThemeReport,
            ivoryThemeReport,
            reducedThemeReport,
            themeResetReport,
            spaceThemeStartReport,
            touchThemeStartReport,
            emptyPaletteReport,
            filledPaletteReport,
            hydratedPaletteReport,
            paletteZoomReport,
            paletteInspectorReport,
            inspectorInjectionReport,
            paletteCapReport,
            clearConfirmationReport,
            clearCancelReport,
            clearedPaletteReport,
            observationReport,
            countdownRenderReport,
            observationTimingReport,
            matchMobileSuccessReport,
            matchFinalSummaryReport,
            masterFinalSummaryReport,
            matchFinalActionReport,
            recallReport,
            recallPreparationReport,
            recallStatsReport,
            centiAccumulationReport,
            persistenceReport,
            recapInteractionReport,
            recapMobileReport,
            recapReducedMotionReport,
            recapFlatFallbackReport,
            finalActionReport,
            reloadedBest,
            basicRecallReport,
            hueKeyboardReport,
            basicExactReport,
            basicDesktopWorkbenchReport,
            hslDragFlushReport,
            feedbackReport,
            scoreExplanationRemovalReport,
            recallNavigationGuardReport,
            mobileMatchStageReports,
            mobileObservationReports,
            mobileReports,
            zoomReport,
            finalZoomReport,
            narrowFinalZoomReport,
            populatedRecapZoomReport,
            offlineReport
        }, null, 2));
    } finally {
        if (client) client.close();
        browser.kill();
        await Promise.race([once(browser, 'exit'), delay(2000)]);
        fs.rmSync(profilePath, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200
        });
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
