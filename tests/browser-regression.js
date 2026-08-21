const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
        scrollWidth: document.documentElement.scrollWidth,
        score: elements.recallFinalScore.textContent,
        average: elements.recallFinalAverage.textContent,
        restartLabel: elements.restartButton.textContent,
        changeDifficultyVisible: !elements.resultChangeDifficulty.classList.contains('hidden'),
        scorePanelFits: document.querySelector('.recall-final-score-panel').scrollWidth
            <= document.querySelector('.recall-final-score-panel').clientWidth,
        statsFit: Array.from(document.querySelectorAll('.recall-final-stat')).every((stat) => (
            stat.scrollWidth <= stat.clientWidth
        )),
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
        await navigate(client, appUrl);
        await evaluate(client, `
            localStorage.setItem('colorMemoryBestRecallScore_advanced', '99');
            localStorage.setItem('colorMemoryBestRecallScore_advanced_oklab_v2', '88');
        `);
        await navigate(client, appUrl);
        const legacyIsolationReport = await evaluate(client, `({
            loadedV3Best: gameState.recallBestScores.advanced,
            storedV2: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v2'),
            legacyValue: localStorage.getItem('colorMemoryBestRecallScore_advanced')
        })`);
        if (legacyIsolationReport.loadedV3Best !== 0
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

        const homepageReport = await evaluate(client, `({
            secondaryGuideRemoved: !document.querySelector('.landing-secondary')
                && !document.querySelector('#game-guide'),
            supportingContentRemoved: !document.querySelector('#supporting-content'),
            paletteEntryTag: elements.colorHistoryEntry.tagName,
            paletteCount: elements.landingHistoryCount.textContent,
            audioControlsRemoved: !document.querySelector('#sound-toggle')
                && !document.querySelector('#icon-volume-up')
                && !document.querySelector('#icon-volume-off')
        })`);
        if (!homepageReport.secondaryGuideRemoved
            || !homepageReport.supportingContentRemoved
            || homepageReport.paletteEntryTag !== 'BUTTON'
            || homepageReport.paletteCount !== '0'
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
                return {
                    screen: screen.id,
                    screenCenter: (screenRect.top + screenRect.bottom) / 2,
                    mainCenter: (mainRect.top + mainRect.bottom) / 2,
                    footerTop: footerRect.top,
                    footerBottom: footerRect.bottom
                };
            });
            showScreen(elements.landingScreen);
            const backButtonHeights = Array.from(document.querySelectorAll('.back-button'))
                .map((button) => parseFloat(getComputedStyle(button).minHeight));
            return {
                viewportHeight: window.innerHeight,
                footerPosition: getComputedStyle(footer).position,
                measurements,
                backButtonHeights
            };
        })()`);
        const desktopFooterTops = desktopShellReport.measurements.map(({ footerTop }) => footerTop);
        if (desktopShellReport.footerPosition !== 'static'
            || desktopShellReport.measurements.some(({ footerBottom }) => (
                footerBottom > desktopShellReport.viewportHeight + 1
            ))
            || Math.max(...desktopFooterTops) - Math.min(...desktopFooterTops) > 1
            || desktopShellReport.measurements.some(({ screenCenter, mainCenter }) => (
                Math.abs(screenCenter - mainCenter) > 1
            ))
            || desktopShellReport.backButtonHeights.some((height) => height !== 36)) {
            throw new Error(`Desktop shell layout failed: ${JSON.stringify(desktopShellReport)}`);
        }
        await captureScreenshot(client, 'landing-desktop.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });
        const homepageMobileReport = await evaluate(client, `(() => {
            const primary = elements.enterGameButton.getBoundingClientRect();
            const paletteEntry = elements.colorHistoryEntry.getBoundingClientRect();
            const brandName = document.querySelector('.brand-name');
            const footer = document.querySelector('.site-footer');
            return {
                viewportWidth: document.documentElement.clientWidth,
                viewportHeight: window.visualViewport?.height || window.innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
                primaryBottom: primary.bottom,
                paletteBottom: paletteEntry.bottom,
                brandNameColor: getComputedStyle(brandName).color,
                brandSuffixColor: getComputedStyle(brandName.querySelector('small')).color,
                footerPosition: getComputedStyle(footer).position,
                footerAfterMain: footer.offsetTop >= document.querySelector('.app-container > main').offsetTop
                    + document.querySelector('.app-container > main').offsetHeight,
                backButtonHeights: Array.from(document.querySelectorAll('.back-button'))
                    .map((button) => parseFloat(getComputedStyle(button).minHeight))
            };
        })()`);
        if (homepageMobileReport.scrollWidth > homepageMobileReport.viewportWidth
            || homepageMobileReport.primaryBottom > homepageMobileReport.viewportHeight + 1
            || homepageMobileReport.paletteBottom > homepageMobileReport.viewportHeight + 1
            || homepageMobileReport.brandNameColor !== homepageMobileReport.brandSuffixColor
            || homepageMobileReport.footerPosition !== 'static'
            || !homepageMobileReport.footerAfterMain
            || homepageMobileReport.backButtonHeights.some((height) => height !== 40)) {
            throw new Error(`Mobile homepage layout failed: ${JSON.stringify(homepageMobileReport)}`);
        }
        await captureScreenshot(client, 'landing-mobile.png');
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
            cubePrimary: ['--cube-primary-1', '--cube-primary-2', '--cube-primary-3', '--cube-primary-4']
                .map((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim()),
            cubeSecondary: ['--cube-secondary-1', '--cube-secondary-2', '--cube-secondary-3', '--cube-secondary-4']
                .map((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim()),
            cubeTopGold: getComputedStyle(document.documentElement).getPropertyValue('--cube-neutral-3').trim(),
            progressTrack: getComputedStyle(elements.progressBar.parentElement).backgroundColor,
            progressFill: getComputedStyle(elements.progressBar).backgroundColor
        })`);
        if (amethystThemeReport.theme !== 'amethyst'
            || amethystThemeReport.stored !== 'amethyst'
            || !amethystThemeReport.label.includes('当前星夜紫金')
            || amethystThemeReport.activeDots !== 1
            || amethystThemeReport.activeDot !== 'amethyst'
            || amethystThemeReport.turn !== '120deg'
            || amethystThemeReport.titlePrimary !== 'rgb(143, 121, 232)'
            || amethystThemeReport.titleSecondary !== 'rgb(236, 225, 101)'
            || amethystThemeReport.themeColor !== '#100B25'
            || amethystThemeReport.cubePrimary.join('|') !== '#c8bef4|#8c78e2|#674cc7|#3b258d'
            || amethystThemeReport.cubeSecondary.join('|') !== '#ede7b1|#ece165|#d4c85e|#baac45'
            || amethystThemeReport.cubeTopGold !== '#f4f0cd'
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
            || !ivoryThemeReport.label.includes('当前雾蓝柔粉')
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
            return {
                grayScore: Math.round(scoreFromPerceptualDistance(grayAttempt.distance) * 100) / 100,
                sameHueScore: Math.round(scoreFromPerceptualDistance(sameHueAttempt.distance) * 100) / 100,
                grayFeedback: getRecallDifferenceFeedback(grayAttempt),
                sameHueFeedback: getRecallDifferenceFeedback(sameHueAttempt)
            };
        })()`);
        if (recallSemanticReport.grayScore !== 6.74
            || recallSemanticReport.sameHueScore !== 6.83
            || recallSemanticReport.sameHueScore <= recallSemanticReport.grayScore
            || recallSemanticReport.grayFeedback !== '明度接近，但饱和度明显偏低，颜色接近灰色'
            || recallSemanticReport.sameHueFeedback !== '色相很接近，但明度明显偏亮') {
            throw new Error(`Recall semantic scoring failed: ${JSON.stringify(recallSemanticReport)}`);
        }

        await evaluate(client, `document.querySelector('#enter-game-button').click()`);
        await waitFor(client, `!document.querySelector('#mode-selection-screen').classList.contains('hidden')`);
        await evaluate(client, `document.querySelector('#color-match-mode').click()`);
        await waitFor(client, `!document.querySelector('#match-difficulty-screen').classList.contains('hidden')`);
        const localRecordDisclosureReport = await evaluate(client, `({
            bestOverviewVisible: !elements.modeBestOverview.classList.contains('hidden'),
            noteVisible: !elements.localRecordNote.classList.contains('hidden'),
            note: elements.localRecordNote.textContent
        })`);
        if (!localRecordDisclosureReport.bestOverviewVisible
            || !localRecordDisclosureReport.noteVisible
            || localRecordDisclosureReport.note !== '成绩仅保存在当前设备的本地缓存；清理缓存或更换设备后会重置。') {
            throw new Error(`Local record disclosure failed: ${JSON.stringify(localRecordDisclosureReport)}`);
        }
        await evaluate(client, `document.querySelector('[data-match-difficulty="basic"]').click()`);
        await waitFor(client, `!document.querySelector('#start-screen').classList.contains('hidden')`);
        const matchPreparationReport = await evaluate(client, `({
            gameInfoHidden: elements.gameInfoBar.classList.contains('hidden'),
            startVisible: !elements.startScreen.classList.contains('hidden'),
            mode: elements.preparationMode.textContent,
            difficulty: elements.preparationDifficulty.textContent
        })`);
        if (!matchPreparationReport.gameInfoHidden
            || !matchPreparationReport.startVisible
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
            const distanceChecks = colors
                .filter((color) => rgbToHex(color) !== targetHex)
                .map((color) => calculatePerceptualDistance(gameState.currentTargetColor, color));
            const selected = cards.find((card) => rgbToHex(card.style.backgroundColor) !== targetHex) || cards[0];
            selected.click();
            selected.click();
            return {
                cardCount: cards.length,
                uniqueCount: new Set(colors.map(rgbToHex)).size,
                targetCount: colors.filter((color) => rgbToHex(color) === targetHex).length,
                distancesInBand: distanceChecks.every((distance) => distance >= band.min && distance <= band.max),
                answersAfterDoubleClick: gameState.totalAnswers,
                stableSurround: getComputedStyle(cards[0]).boxShadow.includes('rgb(16, 25, 29)')
            };
        })()`);

        if (matchReport.cardCount !== 9
            || matchReport.uniqueCount !== 9
            || matchReport.targetCount !== 1
            || !matchReport.distancesInBand
            || matchReport.answersAfterDoubleClick !== 1
            || !matchReport.stableSurround) {
            throw new Error(`Match regression failed: ${JSON.stringify(matchReport)}`);
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
            compactRecallStats: elements.gameInfoBar.classList.contains('recall-stats'),
            levelLabel: elements.levelLabel.textContent,
            level: elements.levelDisplay.textContent,
            scoreLabel: elements.scoreLabel.textContent,
            score: elements.scoreDisplay.textContent,
            bestLabel: elements.bestScoreLabel.textContent,
            best: elements.bestScoreDisplay.textContent,
            duplicateProgressRemoved: !document.querySelector('#recall-control-progress'),
            statsParent: elements.gameInfoBar.parentElement.id,
            joinedGap: elements.recallControlSection.getBoundingClientRect().top
                - elements.gameInfoBar.getBoundingClientRect().bottom
        })`);
        if (!recallStatsReport.gameInfoVisible
            || !recallStatsReport.compactRecallStats
            || recallStatsReport.levelLabel !== '当前轮次'
            || recallStatsReport.level !== '1'
            || recallStatsReport.scoreLabel !== '累计得分'
            || recallStatsReport.score !== '0.00'
            || recallStatsReport.bestLabel !== '进阶最佳'
            || recallStatsReport.best !== '0.00'
            || !recallStatsReport.duplicateProgressRemoved
            || recallStatsReport.statsParent !== 'color-recall-screen'
            || Math.abs(recallStatsReport.joinedGap) > 1) {
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

        const recallReport = await evaluate(client, `({
            score: gameState.recallLastRoundScore,
            totalCenti: gameState.recallTotalScoreCenti,
            distance: gameState.recallLastRoundDistance,
            displayedScore: document.querySelector('#recall-round-score').textContent,
            feedback: document.querySelector('#recall-round-feedback').textContent,
            guidance: elements.recallRoundGuidance.textContent,
            baseDistance: gameState.recallLastRoundBaseDistance,
            neutralPenalty: gameState.recallLastRoundNeutralPenalty,
            focused: document.activeElement.id,
            topStatsVisible: !elements.gameInfoBar.classList.contains('hidden'),
            topRound: elements.levelDisplay.textContent,
            topScore: elements.scoreDisplay.textContent
        })`);
        if (recallReport.score !== 10
            || recallReport.totalCenti !== 1000
            || recallReport.distance !== 0
            || recallReport.displayedScore !== '10.00'
            || recallReport.feedback !== '你就是Color Master!'
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

        await evaluate(client, `document.querySelector('#score-info-button').click()`);
        await waitFor(client, `!document.querySelector('#score-info-dialog').classList.contains('hidden')`);
        const dialogReport = await evaluate(client, `({
            title: document.querySelector('#score-info-title').textContent,
            score: document.querySelector('#score-info-score').textContent,
            distance: document.querySelector('#score-info-distance').textContent,
            description: document.querySelector('#score-info-description').textContent,
            adjustment: document.querySelector('#score-info-adjustment').textContent,
            baseDistance: document.querySelector('#score-info-base-distance').textContent,
            oklabExplanation: document.querySelector('.score-calculation li:first-child p').textContent,
            squareFormula: document.querySelector('#score-info-square-formula').textContent,
            rawFormula: document.querySelector('#score-info-raw-formula').textContent,
            scaleNote: document.querySelector('.score-scale-note').textContent,
            baseFormula: document.querySelector('#score-info-base-formula').textContent,
            neutralStart: document.querySelector('#score-info-neutral-start').textContent,
            neutralFormula: document.querySelector('#score-info-neutral-formula').textContent,
            neutralSmooth: document.querySelector('#score-info-neutral-smooth').textContent,
            adjustmentFormula: document.querySelector('#score-info-adjustment-formula').textContent,
            targetCode: document.querySelector('#score-info-target-code').textContent,
            userCode: document.querySelector('#score-info-user-code').textContent,
            guidance: document.querySelector('#score-info-guidance').textContent,
            totalFormula: document.querySelector('#score-info-total-formula').textContent.trim(),
            roundingNote: document.querySelector('.score-rounding-note').textContent,
            range: document.querySelector('#score-info-range').textContent,
            interpolation: document.querySelector('#score-info-interpolation').textContent,
            processSteps: document.querySelectorAll('.score-calculation li').length,
            grayStepTitle: document.querySelector('.score-calculation li:nth-child(2) strong').textContent,
            mappingAnchorCount: new Set(Array.from(
                document.querySelectorAll('#score-info-mapping-body [data-score-anchor]'),
                (cell) => cell.dataset.scoreAnchor
            )).size,
            mappingRows: document.querySelectorAll('#score-info-mapping-body tr').length,
            activeMappingAnchors: Array.from(new Set(Array.from(
                document.querySelectorAll('#score-info-mapping-body .is-active'),
                (cell) => Number(cell.dataset.scoreAnchor)
            ))),
            genericCardsRemoved: !document.querySelector('.score-info-current')
                && !document.querySelector('.score-info-formula')
                && !document.querySelector('.score-anchor-section')
                && !document.querySelector('.score-anchor-grid'),
            singleCloseControl: document.querySelectorAll('.score-info-panel button').length === 1
                && !document.querySelector('#score-info-confirm'),
            helpHitWidth: elements.scoreInfoButton.getBoundingClientRect().width,
            helpVisualWidth: parseFloat(getComputedStyle(elements.scoreInfoButton, '::before').width),
            focused: document.activeElement.id,
            role: document.querySelector('#score-info-dialog').getAttribute('role'),
            modal: document.querySelector('#score-info-dialog').getAttribute('aria-modal'),
            hidden: document.querySelector('#score-info-dialog').getAttribute('aria-hidden')
        })`);
        if (dialogReport.title !== '为什么是 10.00 分'
            || dialogReport.score !== '10.00 / 10'
            || dialogReport.distance !== '0.00'
            || dialogReport.description !== '先计算两种颜色的 Oklab 感知色差，再按游戏映射换成 10 分制。最终差异越小，分数越高。'
            || dialogReport.description.includes('彩度')
            || !dialogReport.adjustment.includes('本轮各项相乘后，修正值为 0.00')
            || dialogReport.baseDistance !== '0.00'
            || !dialogReport.oklabExplanation.includes('RGB 各分量的数值差不能直接代表人眼看到的色差')
            || !dialogReport.oklabExplanation.includes('L 表示明度，a、b 表示两个颜色轴')
            || dialogReport.squareFormula !== '三项平方和 = (0.0000)² + (0.0000)² + (0.0000)² ≈ 0.00000'
            || dialogReport.rawFormula !== '原始 ΔOK = √(0.00000) ≈ 0.0000'
            || !dialogReport.scaleNote.includes('完整距离整体乘以 100')
            || !dialogReport.scaleNote.includes('不是分别放大 L、a、b')
            || dialogReport.baseFormula !== '游戏展示差异 = 0.0000 × 100 ≈ 0.00'
            || dialogReport.neutralStart.includes('clamp')
            || dialogReport.neutralStart.includes('min(')
            || dialogReport.neutralFormula.includes('clamp')
            || !dialogReport.neutralFormula.includes('灰色程度')
            || !dialogReport.neutralSmooth.includes('g =')
            || !dialogReport.adjustmentFormula.endsWith('≈ 0.00')
            || dialogReport.targetCode !== dialogReport.userCode
            || dialogReport.guidance !== '色相、饱和度和明度都很接近'
            || dialogReport.totalFormula !== '0.00 + 0.00 ≈ 0.00'
            || dialogReport.roundingNote !== '界面数值保留两位小数，评分使用未四舍五入的完整数值。'
            || dialogReport.range !== '最终差异是 0，表示两种颜色一致。'
            || dialogReport.interpolation !== '映射点：差异 0 → 10.00 分。'
            || dialogReport.processSteps !== 3
            || dialogReport.grayStepTitle !== '防止灰色得到虚高分'
            || dialogReport.mappingAnchorCount !== 8
            || dialogReport.mappingRows !== 4
            || JSON.stringify(dialogReport.activeMappingAnchors) !== '[0]'
            || !dialogReport.genericCardsRemoved
            || !dialogReport.singleCloseControl
            || dialogReport.helpHitWidth !== 44
            || dialogReport.helpVisualWidth !== 28
            || dialogReport.focused !== 'score-info-title'
            || dialogReport.role !== 'dialog'
            || dialogReport.modal !== 'true'
            || dialogReport.hidden !== 'false') {
            throw new Error(`Score dialog regression failed: ${JSON.stringify(dialogReport)}`);
        }
        await captureScreenshot(client, 'score-dialog-desktop.png');
        await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab' });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' });
        await waitFor(client, `document.activeElement.id === 'score-info-close'`);
        await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab' });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' });
        await waitFor(client, `document.activeElement.id === 'score-info-close'`);
        await evaluate(client, `document.querySelector('#score-info-close').click()`);
        await waitFor(client, `document.querySelector('#score-info-dialog').classList.contains('hidden')`);
        await waitFor(client, `document.activeElement.id === 'score-info-button'`);
        const closeFocus = await evaluate(client, `document.activeElement.id`);
        if (closeFocus !== 'score-info-button') {
            throw new Error(`Dialog focus returned to ${closeFocus}, expected score-info-button.`);
        }

        await evaluate(client, `document.querySelector('#score-info-button').click()`);
        await waitFor(client, `!document.querySelector('#score-info-dialog').classList.contains('hidden')`);
        await client.send('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27
        });
        await waitFor(client, `document.querySelector('#score-info-dialog').classList.contains('hidden')`);
        await waitFor(client, `document.activeElement.id === 'score-info-button'`);
        const escapeFocus = await evaluate(client, `document.activeElement.id`);
        if (escapeFocus !== 'score-info-button') {
            throw new Error(`Escape returned focus to ${escapeFocus}, expected score-info-button.`);
        }

        await evaluate(client, `
            document.querySelector('#score-info-button').click();
            document.querySelector('#score-info-dialog').click();
        `);
        await waitFor(client, `document.querySelector('#score-info-dialog').classList.contains('hidden')`);

        const referenceDialogReport = await evaluate(client, `(() => {
            const target = { r: 154, g: 65, b: 92 };
            const user = { r: 185, g: 128, b: 191 };
            const details = calculateRecallDistanceDetails(target, user);
            gameState.recallTargetRGB = target;
            gameState.recallUserRGB = user;
            gameState.recallLastRoundDistance = details.distance;
            gameState.recallLastRoundBaseDistance = details.baseDistance;
            gameState.recallLastRoundNeutralPenalty = details.neutralPenalty;
            gameState.recallLastRoundScore = Math.round(scoreFromPerceptualDistance(details.distance) * 100) / 100;
            openScoreInfoDialog();
            return {
                title: elements.scoreInfoTitle.textContent,
                squareFormula: elements.scoreInfoSquareFormula.textContent,
                rawFormula: elements.scoreInfoRawFormula.textContent,
                baseFormula: elements.scoreInfoBaseFormula.textContent,
                adjustment: elements.scoreInfoAdjustment.textContent,
                range: elements.scoreInfoRange.textContent,
                interpolation: elements.scoreInfoInterpolation.textContent,
                activeMappingAnchors: Array.from(new Set(Array.from(
                    elements.scoreInfoMappingBody.querySelectorAll('.is-active'),
                    (cell) => Number(cell.dataset.scoreAnchor)
                )))
            };
        })()`);
        if (referenceDialogReport.title !== '为什么是 6.58 分'
            || referenceDialogReport.squareFormula !== '三项平方和 = (0.1778)² + (-0.0330)² + (-0.0733)² ≈ 0.03809'
            || referenceDialogReport.rawFormula !== '原始 ΔOK = √(0.03809) ≈ 0.1952'
            || referenceDialogReport.baseFormula !== '游戏展示差异 = 0.1952 × 100 ≈ 19.52'
            || !referenceDialogReport.adjustment.includes('本轮各项相乘后，修正值为 0.00')
            || !referenceDialogReport.range.includes('10 和 20 之间')
            || referenceDialogReport.interpolation !== '本轮得分 = 8.2 + (6.5 − 8.2) × (19.52 − 10) ÷ (20 − 10) ≈ 6.58'
            || JSON.stringify(referenceDialogReport.activeMappingAnchors) !== '[10,20]') {
            throw new Error(`Score reference dialog failed: ${JSON.stringify(referenceDialogReport)}`);
        }
        await captureScreenshot(client, 'score-dialog-wording-reference-desktop.png');
        await evaluate(client, `closeScoreInfoDialog()`);
        await waitFor(client, `document.querySelector('#score-info-dialog').classList.contains('hidden')`);

        const grayCorrectionDialogReport = await evaluate(client, `(() => {
            const target = { r: 92, g: 64, b: 54 };
            const user = { r: 128, g: 128, b: 128 };
            const details = calculateRecallDistanceDetails(target, user);
            gameState.recallTargetRGB = target;
            gameState.recallUserRGB = user;
            gameState.recallLastRoundDistance = details.distance;
            gameState.recallLastRoundBaseDistance = details.baseDistance;
            gameState.recallLastRoundNeutralPenalty = details.neutralPenalty;
            gameState.recallLastRoundScore = Math.round(scoreFromPerceptualDistance(details.distance) * 100) / 100;
            openScoreInfoDialog();
            return {
                title: elements.scoreInfoTitle.textContent,
                squareFormula: elements.scoreInfoSquareFormula.textContent,
                rawFormula: elements.scoreInfoRawFormula.textContent,
                baseFormula: elements.scoreInfoBaseFormula.textContent,
                adjustment: elements.scoreInfoAdjustment.textContent,
                neutralStart: elements.scoreInfoNeutralStart.textContent,
                neutralFormula: elements.scoreInfoNeutralFormula.textContent,
                neutralSmooth: elements.scoreInfoNeutralSmooth.textContent,
                adjustmentFormula: elements.scoreInfoAdjustmentFormula.textContent,
                totalFormula: document.querySelector('#score-info-total-formula').textContent.trim(),
                interpolation: elements.scoreInfoInterpolation.textContent,
                activeMappingAnchors: Array.from(new Set(Array.from(
                    elements.scoreInfoMappingBody.querySelectorAll('.is-active'),
                    (cell) => Number(cell.dataset.scoreAnchor)
                )))
            };
        })()`);
        if (grayCorrectionDialogReport.title !== '为什么是 5.41 分'
            || !grayCorrectionDialogReport.squareFormula.endsWith('≈ 0.04177')
            || grayCorrectionDialogReport.rawFormula !== '原始 ΔOK = √(0.04177) ≈ 0.2044'
            || !grayCorrectionDialogReport.baseFormula.endsWith('≈ 20.44')
            || !grayCorrectionDialogReport.adjustment.includes('不是直接扣掉 6.85 分')
            || grayCorrectionDialogReport.neutralStart !== '色彩强度：目标 C = 0.0428，复现 C = 0.0000；较小值 = 0.0000'
            || grayCorrectionDialogReport.neutralFormula !== '灰色程度初值 = 1 − 0.0000 ÷ 0.04 ≈ 1.000；限制到 0–1 后 n = 1.000'
            || grayCorrectionDialogReport.neutralSmooth !== '为避免修正突然变化，再平滑：g = n² × (3 − 2n) = 1.000'
            || !grayCorrectionDialogReport.adjustmentFormula.endsWith('≈ 6.85')
            || grayCorrectionDialogReport.totalFormula !== '20.44 + 6.85 ≈ 27.28'
            || !grayCorrectionDialogReport.interpolation.endsWith('≈ 5.41')
            || JSON.stringify(grayCorrectionDialogReport.activeMappingAnchors) !== '[20,40]') {
            throw new Error(`Gray correction dialog failed: ${JSON.stringify(grayCorrectionDialogReport)}`);
        }
        await captureScreenshot(client, 'score-dialog-gray-correction-desktop.png');
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 320,
            height: 667,
            deviceScaleFactor: 2,
            mobile: true
        });
        await evaluate(client, `document.documentElement.style.fontSize = '200%'`);
        await delay(100);
        const scoreDialogZoomReport = await evaluate(client, `(() => {
            const panel = document.querySelector('.score-info-panel');
            const close = elements.scoreInfoClose;
            const tableWrap = document.querySelector('.score-mapping-table-wrap');
            const panelRect = panel.getBoundingClientRect();
            const closeRect = close.getBoundingClientRect();
            const tableRect = tableWrap.getBoundingClientRect();
            return {
                viewportWidth: document.documentElement.clientWidth,
                documentScrollWidth: document.documentElement.scrollWidth,
                panelLeft: panelRect.left,
                panelRight: panelRect.right,
                panelHeight: panelRect.height,
                closeTop: closeRect.top,
                closeRight: closeRect.right,
                tableLeft: tableRect.left,
                tableRight: tableRect.right,
                bodyScrollable: elements.scoreInfoDialog.querySelector('.score-info-body').scrollHeight
                    > elements.scoreInfoDialog.querySelector('.score-info-body').clientHeight,
                formulasFit: Array.from(document.querySelectorAll('.score-detail-formula')).every((formula) => (
                    formula.scrollWidth <= formula.clientWidth
                ))
            };
        })()`);
        if (scoreDialogZoomReport.documentScrollWidth > scoreDialogZoomReport.viewportWidth
            || scoreDialogZoomReport.panelLeft < 0
            || scoreDialogZoomReport.panelRight > scoreDialogZoomReport.viewportWidth
            || scoreDialogZoomReport.panelHeight > 667
            || scoreDialogZoomReport.closeTop < 0
            || scoreDialogZoomReport.closeRight > scoreDialogZoomReport.viewportWidth
            || scoreDialogZoomReport.tableLeft < scoreDialogZoomReport.panelLeft
            || scoreDialogZoomReport.tableRight > scoreDialogZoomReport.panelRight
            || !scoreDialogZoomReport.bodyScrollable
            || !scoreDialogZoomReport.formulasFit) {
            throw new Error(`Score dialog text scaling failed: ${JSON.stringify(scoreDialogZoomReport)}`);
        }
        await captureScreenshot(client, 'score-dialog-gray-correction-zoom.png');
        await evaluate(client, `document.documentElement.style.fontSize = ''`);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
        });
        await evaluate(client, `closeScoreInfoDialog()`);
        await waitFor(client, `document.querySelector('#score-info-dialog').classList.contains('hidden')`);

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
            storedV3: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v3'),
            storedV2: localStorage.getItem('colorMemoryBestRecallScore_advanced_oklab_v2'),
            legacyValue: localStorage.getItem('colorMemoryBestRecallScore_advanced'),
            bestLabel: document.querySelector('#recall-final-summary .recall-final-stat:nth-child(2) p').textContent,
            recordNote: elements.recallFinalRecordNote.textContent,
            focused: document.activeElement.id
        })`);
        if (persistenceReport.total !== 100
            || persistenceReport.totalCenti !== 10000
            || persistenceReport.round !== 10
            || persistenceReport.best !== 100
            || persistenceReport.storedV3 !== '100'
            || persistenceReport.storedV2 !== '88'
            || persistenceReport.legacyValue !== '99'
            || persistenceReport.bestLabel !== '本机最佳'
            || persistenceReport.recordNote !== '首次完成，已记录为本机最佳'
            || persistenceReport.focused !== 'result-text') {
            throw new Error(`Score persistence regression failed: ${JSON.stringify(persistenceReport)}`);
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
            elements.hueSlider.value = 0;
        })()`);
        await waitFor(client, `document.activeElement.id === 'recall-control-title'`);
        const basicRecallReport = await evaluate(client, `(() => {
            elements.hueSlider.focus();
            return {
                targetHsl: { ...gameState.recallTargetHSL }
            };
        })()`);
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
            return {
                score: gameState.recallLastRoundScore,
                distance: gameState.recallLastRoundDistance,
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
                statsInsideShell: elements.gameInfoBar.parentElement === elements.colorRecallScreen
            };
        })()`);
        if (basicDesktopWorkbenchReport.shellTop < 0
            || basicDesktopWorkbenchReport.shellBottom > basicDesktopWorkbenchReport.viewportHeight + 1
            || basicDesktopWorkbenchReport.submitBottom > basicDesktopWorkbenchReport.viewportHeight + 1
            || !basicDesktopWorkbenchReport.horizontalWorkbench
            || !basicDesktopWorkbenchReport.statsInsideShell) {
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
        if (hslDragFlushReport.hue !== 90 || hslDragFlushReport.saturation !== 100) {
            throw new Error(`HSL drag flush failed: ${JSON.stringify(hslDragFlushReport)}`);
        }
        await captureScreenshot(client, 'recall-control-basic-desktop.png');

        const mobileReports = [];
        const viewports = [
            { width: 375, height: 667 },
            { width: 390, height: 844 },
            { width: 360, height: 800 },
            { width: 430, height: 932 }
        ];
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
                        wheelWidth: wheel.width
                    };
                })()`);
                mobileReports.push({ ...viewport, ...report });
                if (viewport.width === 390 && viewport.height === 844 && difficulty === 'basic') {
                    await captureScreenshot(client, 'recall-control-mobile.png');
                }
                const expectsPreview = difficulty !== 'master';
                if (report.scrollWidth > report.viewportWidth
                    || report.submitTop < 0
                    || report.submitBottom > report.viewportHeight + 1
                    || report.exitTop < 0
                    || report.gameInfoHidden
                    || report.statsBottom > report.exitTop
                    || report.roundLabel !== '当前轮次'
                    || report.round !== '1'
                    || report.scoreLabel !== '累计得分'
                    || report.previewHidden === expectsPreview
                    || (expectsPreview && report.previewWidth <= report.previewHeight)
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
            || finalZoomReport.average !== '10.00'
            || finalZoomReport.restartLabel !== '再玩一次'
            || !finalZoomReport.changeDifficultyVisible
            || !finalZoomReport.scorePanelFits
            || !finalZoomReport.statsFit
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
            homepageReport,
            desktopShellReport,
            homepageMobileReport,
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
            recallReport,
            recallPreparationReport,
            recallStatsReport,
            centiAccumulationReport,
            persistenceReport,
            finalActionReport,
            reloadedBest,
            basicRecallReport,
            hueKeyboardReport,
            basicExactReport,
            basicDesktopWorkbenchReport,
            hslDragFlushReport,
            feedbackReport,
            dialogReport,
            referenceDialogReport,
            recallNavigationGuardReport,
            mobileReports,
            zoomReport,
            finalZoomReport,
            narrowFinalZoomReport,
            offlineReport
        }, null, 2));
    } finally {
        if (client) client.close();
        browser.kill();
        await delay(200);
        fs.rmSync(profilePath, { recursive: true, force: true });
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
