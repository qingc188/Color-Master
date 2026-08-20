// 游戏状态
const COLOR_HISTORY_STORAGE_KEY = 'colorMemoryGlobalColorHistory';
const THEME_STORAGE_KEY = 'colorMemoryInterfaceTheme';
const MAX_COLOR_HISTORY = 100;
const OBSERVATION_DURATION_MS = 5000;
const THEME_ROTATION_MS = 520;
const THEME_SWAP_DELAY_MS = 260;
const THEME_ORDER = ['cyan', 'amethyst', 'ivory'];
const THEME_CONFIG = {
    cyan: { name: '青橙', themeColor: '#071820' },
    amethyst: { name: '星夜紫金', themeColor: '#100B25' },
    ivory: { name: '雾蓝柔粉', themeColor: '#151B2C' }
};
let storageAvailable = true;

function markStorageUnavailable() {
    storageAvailable = false;
    document.getElementById('storage-status')?.classList.remove('hidden');
}

function getStorageItem(key) {
    if (!storageAvailable) return null;
    try {
        return localStorage.getItem(key);
    } catch {
        markStorageUnavailable();
        return null;
    }
}

function setStorageItem(key, value) {
    if (!storageAvailable) return false;
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        markStorageUnavailable();
        return false;
    }
}

function removeStorageItem(key) {
    if (!storageAvailable) return false;
    try {
        localStorage.removeItem(key);
        return true;
    } catch {
        markStorageUnavailable();
        return false;
    }
}

function normalizeTheme(themeId) {
    return THEME_ORDER.includes(themeId) ? themeId : THEME_ORDER[0];
}

let activeThemeIndex = THEME_ORDER.indexOf(normalizeTheme(getStorageItem(THEME_STORAGE_KEY)));
let cubeRotationDegrees = activeThemeIndex * 120;
let themeSwitching = false;
let themeSwapTimeoutId;
let themeFinishTimeoutId;
document.documentElement.dataset.theme = THEME_ORDER[activeThemeIndex];

const gameState = {
    level: 1,
    score: 0,
    currentTargetColor: null,
    isGameActive: false,
    colorHistory: loadColorHistory(),
    // 新模式相关状态
    gameMode: null, // 'colorMatch' 或 'colorRecall'
    matchDifficulty: 'basic',
    matchBestScores: {
        basic: Number(getStorageItem('colorMemoryBestMatchScore_basic')) || 0,
        advanced: Number(getStorageItem('colorMemoryBestMatchScore_advanced')) || 0,
        master: Number(getStorageItem('colorMemoryBestMatchScore_master') ?? getStorageItem('colorMemoryBestScore')) || 0
    },
    lives: 3, // 仅用于颜色匹配大师模式
    totalLevels: 10, // 仅用于固定关卡的颜色匹配模式
    correctAnswers: 0, // 用于计算正确率
    totalAnswers: 0, // 用于计算正确率
    matchRoundSubmitted: false,
    // 颜色复现模式专用
    recallDifficulty: 'basic',
    recallTotalScore: 0, // 累计得分
    recallTotalScoreCenti: 0,
    recallBestScores: {
        basic: Number(getStorageItem('colorMemoryBestRecallScore_basic_oklab_v2')) || 0,
        advanced: Number(getStorageItem('colorMemoryBestRecallScore_advanced_oklab_v2')) || 0,
        master: Number(getStorageItem('colorMemoryBestRecallScore_master_oklab_v2')) || 0
    },
    recallTargetHSL: null, // 目标HSL颜色
    recallTargetRGB: null,
    recallUserHSL: { h: 0, s: 100, l: 50 }, // 用户当前HSL颜色
    recallUserRGB: { r: 128, g: 128, b: 128 },
    recallRound: 1, // 当前轮次
    recallRoundSubmitted: false,
    recallLastRoundScore: 0,
    recallLastRoundDistance: 0,
    recallTotalRounds: 10 // 总轮次
};

// DOM 元素
const elements = {
    themeColorMeta: document.getElementById('theme-color-meta'),
    themeCubeButton: document.getElementById('theme-cube-button'),
    themeCube: document.getElementById('theme-cube'),
    themeStatus: document.getElementById('theme-status'),
    themeDots: document.querySelectorAll('[data-theme-dot]'),
    brandHeader: document.getElementById('brand-header'),
    landingScreen: document.getElementById('landing-screen'),
    enterGameButton: document.getElementById('enter-game-button'),
    colorHistoryEntry: document.getElementById('color-history-entry'),
    landingHistoryCount: document.getElementById('landing-history-count'),
    colorHistoryScreen: document.getElementById('color-history-screen'),
    colorHistoryTitle: document.getElementById('color-history-title'),
    modeSelectionScreen: document.getElementById('mode-selection-screen'),
    colorMatchMode: document.getElementById('color-match-mode'),
    matchDifficultyScreen: document.getElementById('match-difficulty-screen'),
    matchDifficultyCards: document.querySelectorAll('[data-match-difficulty]'),
    colorRecallMode: document.getElementById('color-recall-mode'),
    recallDifficultyScreen: document.getElementById('recall-difficulty-screen'),
    recallDifficultyCards: document.querySelectorAll('[data-recall-difficulty]'),
    startScreen: document.getElementById('start-screen'),
    preparationMode: document.getElementById('preparation-mode'),
    preparationDifficulty: document.getElementById('preparation-difficulty'),
    targetColorScreen: document.getElementById('target-color-screen'),
    colorGridScreen: document.getElementById('color-grid-screen'),
    colorRecallScreen: document.getElementById('color-recall-screen'),
    gameInfoAnchor: document.getElementById('game-info-anchor'),
    gameInfoBar: document.getElementById('game-info-bar'),
    gameStatsPanel: document.getElementById('game-stats-panel'),
    modeBestOverview: document.getElementById('mode-best-overview'),
    localRecordNote: document.getElementById('local-record-note'),
    overviewBestBasicLabel: document.getElementById('overview-best-basic-label'),
    overviewBestAdvancedLabel: document.getElementById('overview-best-advanced-label'),
    overviewBestMasterLabel: document.getElementById('overview-best-master-label'),
    overviewBestBasic: document.getElementById('overview-best-basic'),
    overviewBestAdvanced: document.getElementById('overview-best-advanced'),
    overviewBestMaster: document.getElementById('overview-best-master'),
    recallTargetSection: document.getElementById('recall-target-section'),
    recallControlSection: document.getElementById('recall-control-section'),
    recallResultSection: document.getElementById('recall-result-section'),
    recallControlTitle: document.getElementById('recall-control-title'),
    hslControlPanel: document.getElementById('hsl-control-panel'),
    rgbControlPanel: document.getElementById('rgb-control-panel'),
    recallPreviewPanel: document.getElementById('recall-preview-panel'),
    resultScreen: document.getElementById('result-screen'),
    startButton: document.getElementById('start-button'),
    continueButton: document.getElementById('continue-button'),
    restartButton: document.getElementById('restart-button'),
    backButtons: document.querySelectorAll('[data-back-target]'),
    rulesList: document.getElementById('rules-list'),
    targetColor: document.getElementById('target-color'),
    colorGrid: document.getElementById('color-grid'),
    countdown: document.getElementById('countdown'),
    progressBar: document.getElementById('progress-bar'),
    levelLabel: document.getElementById('level-label'),
    levelDisplay: document.getElementById('level'),
    scoreDisplay: document.getElementById('score'),
    scoreLabel: document.getElementById('score-label'),
    bestScoreDisplay: document.getElementById('best-score'),
    bestScoreLabel: document.getElementById('best-score-label'),
    livesDisplay: document.getElementById('lives-display'),
    lives: document.getElementById('lives'),
    resultIcon: document.getElementById('result-icon'),
    resultText: document.getElementById('result-text'),
    resultDetail: document.getElementById('result-detail'),
    matchResultSummary: document.getElementById('match-result-summary'),
    resultLevelLabel: document.getElementById('result-level-label'),
    resultLevel: document.getElementById('result-level'),
    resultScore: document.getElementById('result-score'),
    resultTargetColor: document.getElementById('result-target-color'),
    resultSelectedColor: document.getElementById('result-selected-color'),
    recallFinalSummary: document.getElementById('recall-final-summary'),
    recallFinalScore: document.getElementById('recall-final-score'),
    recallFinalMax: document.getElementById('recall-final-max'),
    recallFinalAverage: document.getElementById('recall-final-average'),
    recallFinalBest: document.getElementById('recall-final-best'),
    recallFinalRounds: document.getElementById('recall-final-rounds'),
    recallFinalRecordNote: document.getElementById('recall-final-record-note'),
    resultChangeDifficulty: document.getElementById('result-change-difficulty'),
    colorHistory: document.getElementById('color-history'),
    colorHistoryCollection: document.getElementById('color-history-collection'),
    colorHistorySummary: document.getElementById('color-history-summary'),
    colorHistoryEmpty: document.getElementById('color-history-empty'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    clearHistoryCancel: document.getElementById('clear-history-cancel'),
    paletteInspectorSwatch: document.getElementById('palette-inspector-swatch'),
    paletteInspectorHex: document.getElementById('palette-inspector-hex'),
    paletteInspectorRgb: document.getElementById('palette-inspector-rgb'),
    paletteInspectorHsl: document.getElementById('palette-inspector-hsl'),
    paletteInspectorContext: document.getElementById('palette-inspector-context'),
    storageStatus: document.getElementById('storage-status'),
    // 颜色复现模式元素
    recallCountdown: document.getElementById('recall-countdown'),
    recallProgressBar: document.getElementById('recall-progress-bar'),
    recallTargetColor: document.getElementById('recall-target-color'),
    recallUserColor: document.getElementById('recall-user-color'),
    recallUserCodeDisplay: document.getElementById('recall-user-code-display'),
    hslWheel: document.getElementById('hsl-wheel'),
    hslWheelPointer: document.getElementById('hsl-wheel-pointer'),
    hueSlider: document.getElementById('hue-slider'),
    saturationSlider: document.getElementById('saturation-slider'),
    hueValue: document.getElementById('hue-value'),
    saturationValue: document.getElementById('saturation-value'),
    lightnessSlider: document.getElementById('lightness-slider'),
    lightnessValue: document.getElementById('lightness-value'),
    redSlider: document.getElementById('red-slider'),
    greenSlider: document.getElementById('green-slider'),
    blueSlider: document.getElementById('blue-slider'),
    redValue: document.getElementById('red-value'),
    greenValue: document.getElementById('green-value'),
    blueValue: document.getElementById('blue-value'),
    submitRecallBtn: document.getElementById('submit-recall-btn'),
    nextRecallBtn: document.getElementById('next-recall-btn'),
    restartRecallBtn: document.getElementById('restart-recall-btn'),
    recallRoundScore: document.getElementById('recall-round-score'),
    recallRoundFeedback: document.getElementById('recall-round-feedback'),
    scoreInfoButton: document.getElementById('score-info-button'),
    scoreInfoDialog: document.getElementById('score-info-dialog'),
    scoreInfoClose: document.getElementById('score-info-close'),
    scoreInfoConfirm: document.getElementById('score-info-confirm'),
    scoreInfoTitle: document.getElementById('score-info-title'),
    scoreInfoScore: document.getElementById('score-info-score'),
    scoreInfoDistance: document.getElementById('score-info-distance'),
    scoreInfoRange: document.getElementById('score-info-range'),
    scoreInfoInterpolation: document.getElementById('score-info-interpolation'),
    recallResultTarget: document.getElementById('recall-result-target'),
    recallResultUser: document.getElementById('recall-result-user'),
    recallTargetCode: document.getElementById('recall-target-code'),
    recallUserCode: document.getElementById('recall-user-code')
};

const soundPatterns = {
    correct: [660, 880],
    wrong: [220, 165]
};

const recallFeedbackTiers = [
    {
        minScore: 9.7,
        messages: ['你就是Color Master!', '这轮拿捏了！', '准得有点离谱！']
    },
    {
        minScore: 9,
        messages: ['这波专业操作！', '很准，再抠一点细节', '色彩DNA动了~']
    },
    {
        minScore: 8,
        messages: ['就差一点，稳住！', '大方向没毛病', '差一点点，继续冲！']
    },
    {
        minScore: 6.5,
        messages: ['感觉对了', '这波差了点运气', '有点接近了，再试试']
    },
    {
        minScore: 4,
        messages: ['小失误，再接再厉！', '展示一下容错', '问题不大，下一轮上大分！']
    },
    {
        minScore: 0,
        messages: ['色感加载中…', '没关系，重新找感觉', '先热个身，继续来']
    }
];

const mainScreens = [
    elements.landingScreen,
    elements.colorHistoryScreen,
    elements.modeSelectionScreen,
    elements.matchDifficultyScreen,
    elements.recallDifficultyScreen,
    elements.startScreen,
    elements.targetColorScreen,
    elements.colorGridScreen,
    elements.colorRecallScreen,
    elements.resultScreen
];

const recallSections = [
    elements.recallTargetSection,
    elements.recallControlSection,
    elements.recallResultSection
];

let activeCountdownId = 0;
let paletteRetryTimeoutId;
let audioContext;
let scoreInfoReturnFocus;
let selectedHistoryHex;
let clearHistoryConfirmationTimeoutId;

const matchDifficultyConfig = {
    basic: {
        name: '基础',
        gridSize: 3,
        totalLevels: 10,
        endless: false,
        storageKey: 'colorMemoryBestMatchScore_basic',
        rules: [
            '每关将显示一个目标颜色，观察并记住它',
            '5 秒后，屏幕上将出现 3×3 共 9 个颜色方块',
            '干扰色按 Oklab 感知距离生成，并随关卡逐渐接近目标',
            '无论对错都会进入下一关',
            '完成 10 关后统计正确率，并保存基础模式最佳正确数'
        ]
    },
    advanced: {
        name: '进阶',
        gridSize: 4,
        totalLevels: 10,
        endless: false,
        storageKey: 'colorMemoryBestMatchScore_advanced',
        rules: [
            '每关将显示一个目标颜色，观察并记住它',
            '5 秒后，屏幕上将出现 4×4 共 16 个颜色方块',
            '干扰色按更窄的 Oklab 感知距离生成，并随关卡逐渐接近目标',
            '无论对错都会进入下一关',
            '完成 10 关后统计正确率，并保存进阶模式最佳正确数'
        ]
    },
    master: {
        name: '大师',
        gridSize: 4,
        totalLevels: Infinity,
        endless: true,
        storageKey: 'colorMemoryBestMatchScore_master',
        rules: [
            '每关将显示一个目标颜色，观察并记住它',
            '5 秒后，屏幕上将出现 4×4 共 16 个颜色方块',
            'Oklab 感知距离会持续收窄，直到大师难度下限',
            '答对得 1 分并进入下一关；答错后继续本关',
            '共有 3 条生命，每次答错会失去 1 条生命',
            '生命归零后游戏结束，并保存大师模式最佳分数'
        ]
    }
};

const recallDifficultyConfig = {
    basic: {
        name: '基础',
        controlName: 'HSL 控制',
        preview: true,
        storageKey: 'colorMemoryBestRecallScore_basic_oklab_v2',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '5 秒后目标颜色隐藏，进入复现环节',
            '使用 HSL 色轮或色相、饱和度、明度滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '每轮按 Oklab 感知色差计分，满分 10 分，共 10 轮'
        ]
    },
    advanced: {
        name: '进阶',
        controlName: 'RGB 控制',
        preview: true,
        storageKey: 'colorMemoryBestRecallScore_advanced_oklab_v2',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '5 秒后目标颜色隐藏，进入复现环节',
            '使用 R、G、B 三个滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '每轮按 Oklab 感知色差计分，满分 10 分，共 10 轮'
        ]
    },
    master: {
        name: '大师',
        controlName: 'RGB 盲调',
        preview: false,
        storageKey: 'colorMemoryBestRecallScore_master_oklab_v2',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '5 秒后目标颜色隐藏，进入复现环节',
            '只使用 R、G、B 三个滑杆调整参数',
            '调整时不会显示实时颜色预览',
            '每轮按 Oklab 感知色差计分，满分 10 分，共 10 轮'
        ]
    }
};

function applyTheme(themeId, { persist = false, announce = false } = {}) {
    const normalizedTheme = normalizeTheme(themeId);
    const currentIndex = THEME_ORDER.indexOf(normalizedTheme);
    const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
    const config = THEME_CONFIG[normalizedTheme];

    activeThemeIndex = currentIndex;
    document.documentElement.dataset.theme = normalizedTheme;
    elements.themeColorMeta?.setAttribute('content', config.themeColor);
    elements.themeDots.forEach((dot) => {
        dot.classList.toggle('is-active', dot.dataset.themeDot === normalizedTheme);
    });

    if (elements.themeCubeButton) {
        elements.themeCubeButton.setAttribute(
            'aria-label',
            `切换界面配色，当前${config.name}，下一套${THEME_CONFIG[THEME_ORDER[nextIndex]].name}`
        );
    }
    if (persist) setStorageItem(THEME_STORAGE_KEY, normalizedTheme);
    if (announce && elements.themeStatus) {
        elements.themeStatus.textContent = `已切换为${config.name}配色`;
    }
}

function setCubeRotationWithoutMotion(degrees) {
    if (!elements.themeCube) return;
    elements.themeCube.classList.add('is-resetting');
    elements.themeCube.style.setProperty('--cube-turn', `${degrees}deg`);
    // Commit the equivalent 360° reset before another activation can start.
    elements.themeCube.getBoundingClientRect();
    elements.themeCube.classList.remove('is-resetting');
}

function finishThemeSwitch() {
    if (cubeRotationDegrees >= 360) {
        cubeRotationDegrees %= 360;
        setCubeRotationWithoutMotion(cubeRotationDegrees);
    }
    themeSwitching = false;
    document.documentElement.classList.remove('theme-transitioning');
    elements.themeCubeButton?.classList.remove('is-turning');
    elements.themeCubeButton?.removeAttribute('aria-busy');
}

function switchTheme() {
    if (themeSwitching) return;

    const nextThemeIndex = (activeThemeIndex + 1) % THEME_ORDER.length;
    const nextTheme = THEME_ORDER[nextThemeIndex];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const supports3d = window.CSS?.supports?.('transform-style', 'preserve-3d');

    cubeRotationDegrees += 120;
    if (reduceMotion || !supports3d) {
        cubeRotationDegrees %= 360;
        setCubeRotationWithoutMotion(cubeRotationDegrees);
        applyTheme(nextTheme, { persist: true, announce: true });
        return;
    }

    themeSwitching = true;
    clearTimeout(themeSwapTimeoutId);
    clearTimeout(themeFinishTimeoutId);
    document.documentElement.classList.add('theme-transitioning');
    elements.themeCubeButton.classList.add('is-turning');
    elements.themeCubeButton.setAttribute('aria-busy', 'true');
    elements.themeCube.style.setProperty('--cube-turn', `${cubeRotationDegrees}deg`);

    themeSwapTimeoutId = setTimeout(() => {
        applyTheme(nextTheme, { persist: true, announce: true });
    }, THEME_SWAP_DELAY_MS);
    themeFinishTimeoutId = setTimeout(finishThemeSwitch, THEME_ROTATION_MS);
}

function initializeThemeSwitcher() {
    applyTheme(THEME_ORDER[activeThemeIndex]);
    setCubeRotationWithoutMotion(cubeRotationDegrees);
    elements.themeCubeButton?.addEventListener('click', switchTheme);
}

function showScreen(screen) {
    mainScreens.forEach((item) => {
        item.classList.toggle('hidden', item !== screen);
    });
    updateBrandState(screen);
    updateStatsVisibility(screen);
    window.scrollTo(0, 0);
}

function updateBrandState(screen) {
    const isActiveGameScreen = screen === elements.targetColorScreen
        || screen === elements.colorGridScreen
        || screen === elements.colorRecallScreen;
    elements.brandHeader.classList.toggle('hidden', screen === elements.landingScreen || isActiveGameScreen);
}

function showRecallSection(section) {
    recallSections.forEach((item) => {
        item.classList.toggle('hidden', item !== section);
    });
    section.querySelector('h2')?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
        if (section.classList.contains('hidden')) return;
        window.scrollTo(0, 0);
    });
}

function stopActiveCountdown() {
    activeCountdownId++;
    if (paletteRetryTimeoutId) {
        clearTimeout(paletteRetryTimeoutId);
        paletteRetryTimeoutId = undefined;
    }
}

function resetRecallAttemptState() {
    gameState.recallTotalScore = 0;
    gameState.recallTotalScoreCenti = 0;
    gameState.recallRound = 1;
    gameState.recallRoundSubmitted = false;
    gameState.recallLastRoundScore = 0;
    gameState.recallLastRoundDistance = 0;
    gameState.recallUserHSL = { h: 0, s: 100, l: 50 };
    gameState.recallUserRGB = { r: 128, g: 128, b: 128 };
    elements.nextRecallBtn.textContent = '下一轮';
    updateDisplays();
}

function resetResultColorBlocks() {
    elements.resultTargetColor.style.backgroundColor = '';
    elements.resultTargetColor.style.border = '';
    elements.resultTargetColor.classList.remove('flex', 'flex-col', 'items-center', 'justify-center');
    elements.resultTargetColor.innerHTML = '';
    elements.resultSelectedColor.style.backgroundColor = '';
    elements.resultSelectedColor.style.border = '';
    elements.resultSelectedColor.classList.remove('flex', 'flex-col', 'items-center', 'justify-center');
    elements.resultSelectedColor.innerHTML = '';
}

function showMatchResultLayout() {
    elements.matchResultSummary.classList.remove('hidden');
    elements.recallFinalSummary.classList.add('hidden');
    elements.resultChangeDifficulty.classList.add('hidden');
    elements.continueButton.classList.remove('hidden');
    elements.restartButton.classList.remove('recall-primary-action');
    elements.restartButton.textContent = '重新开始';
}

function showRecallFinalLayout() {
    elements.matchResultSummary.classList.add('hidden');
    elements.recallFinalSummary.classList.remove('hidden');
    elements.resultChangeDifficulty.classList.remove('hidden');
    elements.restartButton.classList.add('recall-primary-action');
    elements.restartButton.textContent = '再玩一次';
}

function loadColorHistory() {
    try {
        const savedHistory = JSON.parse(getStorageItem(COLOR_HISTORY_STORAGE_KEY) || '[]');
        return Array.isArray(savedHistory) ? savedHistory.slice(-MAX_COLOR_HISTORY) : [];
    } catch {
        return [];
    }
}

function saveColorHistory() {
    setStorageItem(COLOR_HISTORY_STORAGE_KEY, JSON.stringify(gameState.colorHistory));
}

function updateStatsVisibility(screen) {
    const isMainMenu = screen === elements.landingScreen
        || screen === elements.modeSelectionScreen
        || screen === elements.colorHistoryScreen;
    const isPreparationScreen = screen === elements.startScreen;
    const isDifficultyScreen = screen === elements.matchDifficultyScreen
        || screen === elements.recallDifficultyScreen;
    const isRecallFinalResult = screen === elements.resultScreen
        && gameState.gameMode === 'colorRecall'
        && !gameState.isGameActive;
    const isRecallGameplay = screen === elements.colorRecallScreen;

    if (isRecallGameplay) {
        elements.colorRecallScreen.prepend(elements.gameInfoBar);
    } else {
        elements.gameInfoAnchor.after(elements.gameInfoBar);
    }
    elements.gameInfoBar.classList.toggle('hidden', isMainMenu || isPreparationScreen || isRecallFinalResult);
    elements.gameInfoBar.classList.toggle('recall-stats', isRecallGameplay);
    elements.gameStatsPanel.classList.toggle('hidden', isMainMenu || isDifficultyScreen);
    elements.modeBestOverview.classList.toggle('hidden', !isDifficultyScreen);
    elements.localRecordNote.classList.toggle('hidden', !isDifficultyScreen);
    elements.gameInfoBar.style.gridTemplateColumns = '1fr';
    elements.gameInfoBar.style.justifyContent = 'stretch';
}

function updateBestOverviews(type = gameState.gameMode) {
    elements.overviewBestBasicLabel.textContent = '基础最佳';
    elements.overviewBestAdvancedLabel.textContent = '进阶最佳';
    elements.overviewBestMasterLabel.textContent = '大师最佳';

    if (type === 'colorRecall') {
        elements.overviewBestBasic.textContent = gameState.recallBestScores.basic.toFixed(2);
        elements.overviewBestAdvanced.textContent = gameState.recallBestScores.advanced.toFixed(2);
        elements.overviewBestMaster.textContent = gameState.recallBestScores.master.toFixed(2);
        return;
    }

    elements.overviewBestBasic.textContent = gameState.matchBestScores.basic;
    elements.overviewBestAdvanced.textContent = gameState.matchBestScores.advanced;
    elements.overviewBestMaster.textContent = gameState.matchBestScores.master;
}

function getColorDetails(color) {
    const hex = rgbToHex(color);
    let rgb;
    let hslText = color;

    if (typeof color === 'string' && color.startsWith('hsl')) {
        const hslMatch = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (hslMatch) {
            const [, h, s, l] = hslMatch.map(Number);
            rgb = hslToRgb(h, s, l);
            hslText = `hsl(${h}, ${s}%, ${l}%)`;
        }
    }

    if (!rgb && typeof color === 'string') {
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            const [, r, g, b] = rgbMatch.map(Number);
            rgb = { r, g, b };
            hslText = rgbToHslText(r, g, b);
        }
    }

    if (!rgb && typeof color === 'object' && color.r !== undefined) {
        rgb = color;
        hslText = rgbToHslText(color.r, color.g, color.b);
    }

    return {
        hex,
        rgbText: rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : String(color),
        hslText
    };
}

function rgbToHslText(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        if (max === g) h = (b - r) / d + 2;
        if (max === b) h = (r - g) / d + 4;
        h /= 6;
    }

    return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function runCountdown({ counter, progressBar, durationMs, onComplete }) {
    const countdownId = ++activeCountdownId;
    const startTime = performance.now();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let previousSeconds;

    function update(now) {
        if (countdownId !== activeCountdownId) return;

        const elapsed = now - startTime;
        const remaining = Math.max(0, durationMs - elapsed);
        const secondsLeft = Math.ceil(remaining / 1000);

        if (secondsLeft !== previousSeconds) {
            counter.textContent = secondsLeft;
            previousSeconds = secondsLeft;
        }
        if (!reduceMotion) {
            progressBar.style.transform = `scaleX(${remaining / durationMs})`;
        }

        if (remaining > 0) {
            requestAnimationFrame(update);
            return;
        }

        onComplete();
    }

    previousSeconds = Math.ceil(durationMs / 1000);
    counter.textContent = previousSeconds;
    progressBar.style.width = '100%';
    progressBar.style.transform = 'scaleX(1)';
    requestAnimationFrame(update);
}

function bindCardActivation(element, handler) {
    element.addEventListener('click', handler);
    element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handler();
    });
}

// 初始化游戏
function initGame() {
    initializeThemeSwitcher();
    // 更新最佳分数显示
    updateBrandState(elements.landingScreen);
    updateStatsVisibility(elements.landingScreen);
    updateBestOverviews();
    updateDisplays();
    updateColorHistoryDisplay();
    
    // 设置HSL色轮交互
    setupHSLWheelInteraction();
    
    // 绑定事件监听器
    elements.enterGameButton.addEventListener('click', () => showScreen(elements.modeSelectionScreen));
    elements.colorHistoryEntry.addEventListener('click', openColorHistory);
    bindCardActivation(elements.colorMatchMode, () => showDifficultyScreen(elements.matchDifficultyScreen, 'colorMatch'));
    elements.matchDifficultyCards.forEach((card) => {
        bindCardActivation(card, () => selectMatchDifficulty(card.dataset.matchDifficulty));
    });
    bindCardActivation(elements.colorRecallMode, () => showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall'));
    elements.recallDifficultyCards.forEach((card) => {
        bindCardActivation(card, () => selectRecallDifficulty(card.dataset.recallDifficulty));
    });
    elements.startButton.addEventListener('click', startGame);
    elements.continueButton.addEventListener('click', nextLevel);
    elements.restartButton.addEventListener('click', handleRestartButton);
    elements.restartRecallBtn.addEventListener('click', restartCurrentRecallDifficulty);
    elements.backButtons.forEach((button) => {
        button.addEventListener('click', () => handleBackNavigation(button.dataset.backTarget));
    });
    elements.clearHistoryBtn.addEventListener('click', handleClearHistoryRequest);
    elements.clearHistoryCancel.addEventListener('click', () => {
        resetClearHistoryConfirmation();
        elements.clearHistoryBtn.focus();
    });
    elements.resultChangeDifficulty.addEventListener('click', returnToRecallDifficultySelection);
    elements.scoreInfoButton.addEventListener('click', openScoreInfoDialog);
    elements.scoreInfoClose.addEventListener('click', closeScoreInfoDialog);
    elements.scoreInfoConfirm.addEventListener('click', closeScoreInfoDialog);
    elements.scoreInfoDialog.addEventListener('click', (event) => {
        if (event.target === elements.scoreInfoDialog) closeScoreInfoDialog();
    });
    elements.scoreInfoDialog.addEventListener('keydown', handleScoreInfoDialogKeydown);
    // 倒计时期间不允许点击跳过，确保每轮观察时间一致。
}

function renderRules(rules) {
    elements.rulesList.innerHTML = rules
        .map((rule) => `<li>${iconMarkup('circle', 'rule-icon')} ${rule}</li>`)
        .join('');
}

function updatePreparationContext() {
    if (gameState.gameMode === 'colorRecall') {
        const config = recallDifficultyConfig[gameState.recallDifficulty];
        elements.preparationMode.textContent = '颜色复现';
        elements.preparationDifficulty.textContent = `${config.name} · ${config.controlName}`;
        return;
    }

    const config = matchDifficultyConfig[gameState.matchDifficulty];
    elements.preparationMode.textContent = '颜色匹配';
    elements.preparationDifficulty.textContent = `${config.name} · ${config.gridSize}×${config.gridSize} 色池`;
}

function iconMarkup(name, className = '') {
    return `<svg class="ui-icon ${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function showDifficultyScreen(screen, type = gameState.gameMode) {
    updateBestOverviews(type);
    showScreen(screen);
}

function openColorHistory() {
    updateColorHistoryDisplay();
    showScreen(elements.colorHistoryScreen);
    requestAnimationFrame(() => elements.colorHistoryTitle.focus({ preventScroll: true }));
}

function selectMatchDifficulty(difficulty) {
    const config = matchDifficultyConfig[difficulty];
    gameState.gameMode = 'colorMatch';
    gameState.matchDifficulty = difficulty;
    gameState.totalLevels = config.totalLevels;
    renderRules(config.rules);
    updatePreparationContext();
    updateDisplays();
    showScreen(elements.startScreen);
}

function selectRecallDifficulty(difficulty) {
    const config = recallDifficultyConfig[difficulty];
    gameState.gameMode = 'colorRecall';
    gameState.recallDifficulty = difficulty;
    gameState.recallTotalScore = 0;
    gameState.recallTotalScoreCenti = 0;
    gameState.recallRound = 1;
    renderRules(config.rules);
    updatePreparationContext();
    updateDisplays();
    showScreen(elements.startScreen);
}

function handleBackNavigation(target) {
    if (target === 'start' && gameState.isGameActive
        && !window.confirm('退出后，本局成绩不会保存。确定退出吗？')) {
        return;
    }

    stopActiveCountdown();

    if (target === 'landing') {
        const returnsFromPalette = !elements.colorHistoryScreen.classList.contains('hidden');
        gameState.gameMode = null;
        showScreen(elements.landingScreen);
        updateDisplays();
        if (returnsFromPalette) {
            requestAnimationFrame(() => elements.colorHistoryEntry.focus({ preventScroll: true }));
        }
        return;
    }

    if (target === 'mode-selection') {
        showScreen(elements.modeSelectionScreen);
        gameState.gameMode = null;
        updateDisplays();
        return;
    }

    if (target === 'mode-selection-or-difficulty') {
        if (gameState.gameMode === 'colorRecall') {
            showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall');
        } else if (gameState.gameMode === 'colorMatch') {
            showDifficultyScreen(elements.matchDifficultyScreen, 'colorMatch');
        } else {
            showScreen(elements.modeSelectionScreen);
            gameState.gameMode = null;
        }
        updateDisplays();
        return;
    }

    if (target === 'start') {
        if (gameState.gameMode === 'colorRecall') {
            restartCurrentRecallDifficulty();
        } else {
            restartCurrentMatchDifficulty();
        }
        return;
    }
}

function restartCurrentMatchDifficulty() {
    stopActiveCountdown();
    gameState.isGameActive = false;
    gameState.gameMode = 'colorMatch';
    gameState.level = 1;
    gameState.score = 0;
    gameState.correctAnswers = 0;
    gameState.totalAnswers = 0;
    gameState.lives = matchDifficultyConfig[gameState.matchDifficulty].endless ? 3 : 0;
    resetResultColorBlocks();
    elements.continueButton.classList.remove('hidden');
    elements.continueButton.textContent = '下一关';
    updateDisplays();
    showScreen(elements.startScreen);
}

function restartCurrentRecallDifficulty() {
    stopActiveCountdown();
    gameState.isGameActive = false;
    gameState.gameMode = 'colorRecall';
    resetResultColorBlocks();
    resetRecallAttemptState();
    showScreen(elements.startScreen);
}

function returnToRecallDifficultySelection() {
    stopActiveCountdown();
    gameState.isGameActive = false;
    gameState.gameMode = 'colorRecall';
    resetResultColorBlocks();
    resetRecallAttemptState();
    showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall');
}

function handleRestartButton() {
    if (gameState.gameMode === 'colorRecall') {
        startGame();
        return;
    }

    if (gameState.gameMode === 'colorMatch') {
        restartCurrentMatchDifficulty();
        return;
    }

    restartGame();
}

// 开始游戏
function startGame() {
    gameState.isGameActive = true;
    gameState.level = 1;
    gameState.score = 0;
    gameState.correctAnswers = 0;
    gameState.totalAnswers = 0;
    
    // 根据模式初始化状态
    if (gameState.gameMode === 'colorMatch') {
        const config = matchDifficultyConfig[gameState.matchDifficulty];
        gameState.totalLevels = config.totalLevels;
        gameState.lives = config.endless ? 3 : 0;
    } else if (gameState.gameMode === 'colorRecall') {
        // 初始化颜色复现模式
        resetRecallAttemptState();
    }
    
    updateDisplays();
    
    // 根据模式开始游戏
    if (gameState.gameMode === 'colorRecall') {
        startColorRecallRound();
    } else {
        showTargetColor();
    }
}

// 显示目标颜色
function showTargetColor() {
    showScreen(elements.targetColorScreen);
    if (paletteRetryTimeoutId) {
        clearTimeout(paletteRetryTimeoutId);
        paletteRetryTimeoutId = undefined;
    }
    gameState.matchRoundSubmitted = false;
    
    // 生成目标颜色
    gameState.currentTargetColor = generateColor(gameState.level);
    
    // 设置目标颜色显示
    elements.targetColor.style.backgroundColor = gameState.currentTargetColor;
    
    runCountdown({
        counter: elements.countdown,
        progressBar: elements.progressBar,
        durationMs: OBSERVATION_DURATION_MS,
        onComplete: showColorGrid
    });
}

// 显示颜色选择网格
function showColorGrid() {
    showScreen(elements.colorGridScreen);
    const config = matchDifficultyConfig[gameState.matchDifficulty];
    const gridTotal = config.gridSize * config.gridSize;
    
    // 清空颜色网格
    elements.colorGrid.innerHTML = '';
    elements.colorGrid.className = 'grid gap-3 sm:gap-4';
    elements.colorGrid.style.gridTemplateColumns = `repeat(${config.gridSize}, minmax(0, 1fr))`;
    
    // 按当前难度的 Oklab 距离带一次性生成整组干扰色。
    let distractors;
    try {
        distractors = generatePerceptualDistractors(
            gameState.currentTargetColor,
            gridTotal - 1,
            {
                difficulty: gameState.matchDifficulty,
                level: gameState.level
            }
        );
    } catch (error) {
        console.warn('Retrying color palette with relaxed pair spacing.', error);
        try {
            distractors = generatePerceptualDistractors(
                gameState.currentTargetColor,
                gridTotal - 1,
                {
                    difficulty: gameState.matchDifficulty,
                    level: gameState.level,
                    maxAttempts: 16000,
                    pairDistanceScale: 0.75
                }
            );
        } catch (retryError) {
            console.error('Unable to generate the color palette.', retryError);
            elements.colorGrid.innerHTML = '<p class="col-span-full py-8 text-center text-gray-300">本轮色板生成失败，正在重新出题…</p>';
            paletteRetryTimeoutId = setTimeout(() => {
                paletteRetryTimeoutId = undefined;
                showTargetColor();
            }, 1000);
            return;
        }
    }
    const colors = [gameState.currentTargetColor, ...distractors];
    
    // 随机打乱颜色顺序
    shuffleArray(colors);

    // 创建颜色方块
    colors.forEach((color, index) => {
        const colorBlock = document.createElement('button');
        colorBlock.type = 'button';
        colorBlock.className = 'color-card w-full aspect-square rounded-xl shadow-lg cursor-pointer';
        colorBlock.style.backgroundColor = color;
        colorBlock.setAttribute('aria-label', `颜色选项 ${index + 1}`);
        colorBlock.addEventListener('click', () => checkColorSelection(color));
        elements.colorGrid.appendChild(colorBlock);
    });
}

// 检查颜色选择
function checkColorSelection(selectedColor) {
    if (gameState.matchRoundSubmitted) return;
    gameState.matchRoundSubmitted = true;
    showMatchResultLayout();
    showScreen(elements.resultScreen);
    resetResultColorBlocks();
    elements.resultDetail.innerHTML = '';
    elements.resultDetail.classList.add('hidden');
    addToColorHistory(gameState.currentTargetColor);
    
    // 更新结果显示
    elements.resultTargetColor.style.backgroundColor = gameState.currentTargetColor;
    elements.resultSelectedColor.style.backgroundColor = selectedColor;
    elements.resultLevel.textContent = gameState.level;
    
    // 显示颜色的十六进制色码
    document.getElementById('target-color-code').textContent = rgbToHex(gameState.currentTargetColor);
    document.getElementById('selected-color-code').textContent = rgbToHex(selectedColor);
    
    // 增加总答题数
    gameState.totalAnswers++;
    const isCorrect = rgbToHex(selectedColor) === rgbToHex(gameState.currentTargetColor);
    const config = matchDifficultyConfig[gameState.matchDifficulty];
    
    // 判断选择是否正确
    if (isCorrect) {
        // 选择正确
        playSound('correct');
        gameState.score++;
        gameState.correctAnswers++;
        
        elements.resultIcon.className = 'text-6xl mb-4 text-success';
        elements.resultIcon.innerHTML = iconMarkup('check-circle');
        elements.resultText.textContent = '回答正确';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-success';

    } else {
        // 选择错误
        playSound('wrong');
        elements.resultIcon.className = 'text-6xl mb-4 text-danger';
        elements.resultIcon.innerHTML = iconMarkup('x-circle');
        elements.resultText.textContent = '没有选中目标色';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-danger';
        
        // 处理大师无尽模式的生命值
        if (config.endless) {
            gameState.lives--;
            
            // 检查是否游戏结束
            if (gameState.lives <= 0) {
                showGameEnd();
                return;
            }
        }
    }
    
    if (!config.endless) {
        elements.continueButton.textContent = '下一关';
        if (gameState.level >= config.totalLevels) {
            showGameEnd();
            return;
        }
        gameState.level++;
    } else if (isCorrect) {
        // 大师模式只有做对才进入下一关
        elements.continueButton.textContent = '下一关';
        gameState.level++;
    } else {
        elements.continueButton.textContent = '继续本关';
    }
    
    elements.resultScore.textContent = gameState.score;
    updateDisplays();
}

// 进入下一关
function nextLevel() {
    showTargetColor();
}

// 显示游戏结束
function showGameEnd() {
    gameState.isGameActive = false;
    showMatchResultLayout();
    showScreen(elements.resultScreen);
    elements.resultDetail.classList.add('hidden');
    elements.resultDetail.innerHTML = '';
    const config = matchDifficultyConfig[gameState.matchDifficulty];
    const isNewRecord = gameState.score > gameState.matchBestScores[gameState.matchDifficulty];
    if (isNewRecord) {
        gameState.matchBestScores[gameState.matchDifficulty] = gameState.score;
        setStorageItem(config.storageKey, gameState.score.toString());
        updateBestOverviews();
    }
    
    // 根据游戏模式显示不同的结束信息
    if (!config.endless) {
        // 固定关卡匹配模式结束
        const accuracy = gameState.totalAnswers > 0
            ? Math.round((gameState.correctAnswers / gameState.totalAnswers) * 100)
            : 0;
        
        elements.resultIcon.className = 'text-6xl mb-4 text-primary';
        elements.resultIcon.innerHTML = iconMarkup('trophy');
        elements.resultText.textContent = `${config.name}颜色匹配完成！`;
        elements.resultText.className = 'text-3xl font-bold mb-6 text-primary';
        
        elements.resultDetail.innerHTML = `
            <p class="text-xl font-semibold mb-2">正确率: <span class="text-success">${accuracy}%</span></p>
            <div class="progress-track w-full rounded-full h-2.5">
                <div class="progress-fill h-2.5 rounded-full" style="width: ${accuracy}%"></div>
            </div>
            <p class="text-sm text-gray-400 mt-2">答对: ${gameState.correctAnswers} / 总题数: ${gameState.totalAnswers}</p>
            <p class="text-sm text-gray-400 mt-1">${isNewRecord ? '新纪录！' : `${config.name}最佳：${gameState.matchBestScores[gameState.matchDifficulty]}`}</p>
        `;
        elements.resultDetail.classList.remove('hidden');
    } else {
        // 大师无尽模式结束
        elements.resultIcon.className = 'text-6xl mb-4 text-secondary';
        elements.resultIcon.innerHTML = iconMarkup('star');
        elements.resultText.textContent = '大师颜色匹配结束！';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-secondary';
        
        elements.resultDetail.innerHTML = `
            <p class="text-xl font-semibold mb-2">最高关卡: <span class="text-secondary">${gameState.level}</span></p>
            <p class="text-sm text-gray-400">你坚持到了第 ${gameState.level} 关！</p>
            <p class="text-sm text-gray-400 mt-1">${isNewRecord ? '新纪录！' : `大师最佳：${gameState.matchBestScores.master}`}</p>
        `;
        elements.resultDetail.classList.remove('hidden');
    }
    
    // 更新结果显示
    elements.resultLevel.textContent = gameState.level;
    elements.resultScore.textContent = gameState.score;
    updateDisplays();
    
    // 隐藏"下一关"按钮，只显示"重新开始"按钮
    elements.continueButton.classList.add('hidden');
    elements.restartButton.classList.remove('hidden');
}

// 重新开始游戏
function restartGame() {
    showScreen(elements.modeSelectionScreen);
    stopActiveCountdown();
    gameState.isGameActive = false;
    gameState.gameMode = null;
    
    // 重置标签
    elements.levelLabel.textContent = '当前关卡';
    elements.scoreLabel.textContent = '得分';
    elements.bestScoreLabel.textContent = '最佳记录';
    
    // 清除结果屏幕上的模式详情
    elements.resultDetail.innerHTML = '';
    elements.resultDetail.classList.add('hidden');
    
    // 恢复按钮显示
    elements.continueButton.classList.remove('hidden');
    
    // 恢复结果区域样式
    resetResultColorBlocks();
}

// 更新显示
function updateDisplays() {
    const isRecallMode = gameState.gameMode === 'colorRecall';
    elements.levelLabel.textContent = isRecallMode ? '当前轮次' : '当前关卡';
    elements.resultLevelLabel.textContent = isRecallMode ? '完成轮数' : '当前关卡';
    elements.levelDisplay.textContent = gameState.gameMode === 'colorRecall'
        ? gameState.recallRound
        : gameState.level;
    
    // 根据游戏模式显示不同的得分和标签
    if (gameState.gameMode === 'colorRecall') {
        const config = recallDifficultyConfig[gameState.recallDifficulty];
        elements.scoreLabel.textContent = '累计得分';
        elements.bestScoreLabel.textContent = `${config.name}最佳`;
        elements.scoreDisplay.textContent = gameState.recallTotalScore.toFixed(2);
        elements.bestScoreDisplay.textContent = gameState.recallBestScores[gameState.recallDifficulty].toFixed(2);
    } else if (gameState.gameMode === 'colorMatch') {
        const config = matchDifficultyConfig[gameState.matchDifficulty];
        elements.scoreLabel.textContent = config.endless ? '得分' : '正确数';
        elements.bestScoreLabel.textContent = `${config.name}最佳`;
        elements.scoreDisplay.textContent = gameState.score;
        elements.bestScoreDisplay.textContent = gameState.matchBestScores[gameState.matchDifficulty];
    } else {
        elements.scoreLabel.textContent = '得分';
        elements.bestScoreLabel.textContent = '最佳记录';
        elements.scoreDisplay.textContent = gameState.score;
        elements.bestScoreDisplay.textContent = 0;
    }
    
    // 根据游戏模式显示或隐藏生命值
    const shouldShowLives = gameState.gameMode === 'colorMatch'
        && matchDifficultyConfig[gameState.matchDifficulty].endless;
    elements.gameStatsPanel.classList.toggle('has-lives', shouldShowLives);

    if (shouldShowLives) {
        elements.livesDisplay.classList.remove('hidden');
        elements.lives.textContent = gameState.lives;
    } else {
        elements.livesDisplay.classList.add('hidden');
    }
}

// 添加颜色到历史记录
function addToColorHistory(color) {
    const details = getColorDetails(color);
    const exists = gameState.colorHistory.some((item) => item.hex === details.hex);
    if (exists) return;

    gameState.colorHistory.push({
        color,
        hex: details.hex,
        rgbText: details.rgbText,
        hslText: details.hslText,
        context: getCurrentHistoryContext()
    });
    selectedHistoryHex = details.hex;
    
    // 最多保留100个历史颜色，满了按遇到顺序替换最旧的颜色。
    if (gameState.colorHistory.length > MAX_COLOR_HISTORY) {
        gameState.colorHistory.shift();
    }
    
    saveColorHistory();
    updateColorHistoryDisplay();
}

function getCurrentHistoryContext() {
    if (gameState.gameMode === 'colorRecall') {
        const config = recallDifficultyConfig[gameState.recallDifficulty];
        return `颜色复现 · ${config.name} · 第${gameState.recallRound}轮`;
    }

    if (gameState.gameMode === 'colorMatch') {
        const config = matchDifficultyConfig[gameState.matchDifficulty];
        return `颜色匹配 · ${config.name} · 第${gameState.level}关`;
    }

    return '自由浏览';
}

// 更新颜色历史显示
function updateColorHistoryDisplay() {
    elements.colorHistory.replaceChildren();
    const historyCount = gameState.colorHistory.length;
    const isEmpty = historyCount === 0;
    elements.landingHistoryCount.textContent = historyCount;
    elements.colorHistorySummary.textContent = `${historyCount} / ${MAX_COLOR_HISTORY}`;
    elements.colorHistoryEmpty.classList.toggle('hidden', !isEmpty);
    elements.colorHistoryCollection.classList.toggle('hidden', isEmpty);
    elements.clearHistoryBtn.disabled = isEmpty;
    resetClearHistoryConfirmation();
    if (isEmpty) {
        selectedHistoryHex = undefined;
        return;
    }

    const displayedHistory = [...gameState.colorHistory].reverse();
    if (!displayedHistory.some((item) => item.hex === selectedHistoryHex)) {
        selectedHistoryHex = displayedHistory[0].hex;
    }
    const selectedItem = displayedHistory.find((item) => item.hex === selectedHistoryHex);
    updateColorHistoryInspector(selectedItem);

    displayedHistory.forEach((item, index) => {
        const colorBlock = document.createElement('button');
        colorBlock.type = 'button';
        colorBlock.className = 'history-color';
        colorBlock.style.backgroundColor = item.color;
        colorBlock.title = `${item.hex} · ${item.context || '历史颜色'}`;
        colorBlock.dataset.historyHex = item.hex;
        colorBlock.classList.toggle('is-selected', item.hex === selectedHistoryHex);
        colorBlock.setAttribute('aria-pressed', item.hex === selectedHistoryHex ? 'true' : 'false');
        colorBlock.setAttribute('aria-label', `查看最近第 ${index + 1} 张色卡：${item.hex}`);
        colorBlock.addEventListener('click', () => {
            selectColorHistoryItem(item);
        });

        elements.colorHistory.appendChild(colorBlock);
    });

    const visibleSlotCount = Math.min(
        MAX_COLOR_HISTORY,
        Math.max(10, Math.ceil(historyCount / 10) * 10)
    );
    for (let index = historyCount; index < visibleSlotCount; index++) {
        const emptySlot = document.createElement('span');
        emptySlot.className = 'palette-slot-empty';
        emptySlot.setAttribute('aria-hidden', 'true');
        elements.colorHistory.appendChild(emptySlot);
    }
}

function updateColorHistoryInspector(item) {
    elements.paletteInspectorSwatch.style.backgroundColor = item.color;
    elements.paletteInspectorHex.textContent = item.hex;
    elements.paletteInspectorRgb.textContent = item.rgbText;
    elements.paletteInspectorHsl.textContent = item.hslText;
    elements.paletteInspectorContext.textContent = item.context || '历史颜色';
}

function selectColorHistoryItem(item) {
    selectedHistoryHex = item.hex;
    updateColorHistoryInspector(item);
    elements.colorHistory.querySelectorAll('.history-color').forEach((colorBlock) => {
        const isSelected = colorBlock.dataset.historyHex === selectedHistoryHex;
        colorBlock.classList.toggle('is-selected', isSelected);
        colorBlock.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
}

// ============ 颜色复现模式函数 ============

// 开始一轮颜色复现
function startColorRecallRound() {
    gameState.recallRoundSubmitted = false;
    gameState.recallLastRoundScore = 0;
    gameState.recallLastRoundDistance = 0;
    elements.nextRecallBtn.textContent = '下一轮';
    updateDisplays();
    configureRecallControlPanel();

    // 生成随机目标颜色
    const targetColor = generateColor(gameState.recallRound);
    const generatedRgb = parseColorToRgb(targetColor);
    const targetHsl = rgbToHsl(generatedRgb);
    const targetRgb = gameState.recallDifficulty === 'basic'
        ? hslToRgb(targetHsl.h, targetHsl.s, targetHsl.l)
        : generatedRgb;
    gameState.recallTargetHSL = targetHsl;
    gameState.recallTargetRGB = targetRgb;
    
    // 设置目标颜色显示
    elements.recallTargetColor.style.backgroundColor = rgbToCss(targetRgb);
    
    // 显示目标区域，隐藏控制和结果区域
    showScreen(elements.colorRecallScreen);
    showRecallSection(elements.recallTargetSection);
    
    // 重置用户颜色
    gameState.recallUserHSL = { h: 0, s: 100, l: 50 };
    gameState.recallUserRGB = { r: 128, g: 128, b: 128 };
    elements.hueSlider.value = 0;
    elements.saturationSlider.value = 100;
    elements.lightnessSlider.value = 50;
    elements.lightnessValue.textContent = '50%';
    elements.redSlider.value = 128;
    elements.greenSlider.value = 128;
    elements.blueSlider.value = 128;
    updateHSLPointerPosition();
    updateRecallUserColor();
    
    runCountdown({
        counter: elements.recallCountdown,
        progressBar: elements.recallProgressBar,
        durationMs: OBSERVATION_DURATION_MS,
        onComplete: () => {
            showRecallSection(elements.recallControlSection);
            requestAnimationFrame(updateHSLPointerPosition);
        }
    });
}

// 更新HSL色轮指针位置
function updateHSLPointerPosition(wheelRect) {
    const wheel = elements.hslWheel;
    const rect = wheelRect || wheel.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = centerX;
    
    // 将H转换为弧度，S决定距离中心的距离
    const angle = (gameState.recallUserHSL.h - 90) * (Math.PI / 180);
    const distance = (gameState.recallUserHSL.s / 100) * radius;
    
    const x = centerX + distance * Math.cos(angle);
    const y = centerY + distance * Math.sin(angle);
    
    elements.hslWheelPointer.style.left = `${x}px`;
    elements.hslWheelPointer.style.top = `${y}px`;
}

function configureRecallControlPanel() {
    const config = recallDifficultyConfig[gameState.recallDifficulty];
    const usesHsl = gameState.recallDifficulty === 'basic';

    elements.recallControlTitle.textContent = `${config.name}模式：你的复现`;
    elements.hslControlPanel.classList.toggle('hidden', !usesHsl);
    elements.rgbControlPanel.classList.toggle('hidden', usesHsl);
    elements.recallPreviewPanel.classList.toggle('hidden', !config.preview);
}

function getRecallUserRGB() {
    if (gameState.recallDifficulty === 'basic') {
        const { h, s, l } = gameState.recallUserHSL;
        return hslToRgb(h, s, l);
    }

    return { ...gameState.recallUserRGB };
}

// 更新用户复现颜色
function updateRecallUserColor() {
    const { h, s, l } = gameState.recallUserHSL;
    const { r, g, b } = gameState.recallUserRGB;

    elements.hueSlider.value = h;
    elements.saturationSlider.value = s;
    elements.hueValue.textContent = `${h}°`;
    elements.saturationValue.textContent = `${s}%`;
    elements.lightnessValue.textContent = `${l}%`;
    elements.saturationSlider.style.backgroundImage = `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
    elements.redValue.textContent = r;
    elements.greenValue.textContent = g;
    elements.blueValue.textContent = b;

    if (gameState.recallDifficulty === 'basic') {
        elements.recallUserColor.style.backgroundColor = `hsl(${h}, ${s}%, ${l}%)`;
        elements.recallUserCodeDisplay.textContent = `hsl(${h}, ${s}%, ${l}%)`;
        return;
    }

    elements.recallUserColor.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    elements.recallUserCodeDisplay.textContent = `rgb(${r}, ${g}, ${b})`;
}

function getRecallFeedback(score, round = 1) {
    const safeScore = Math.max(0, Math.min(10, Number(score) || 0));
    const tier = recallFeedbackTiers.find(({ minScore }) => safeScore >= minScore)
        || recallFeedbackTiers[recallFeedbackTiers.length - 1];
    const messageIndex = (Math.max(1, Number(round) || 1) - 1) % tier.messages.length;
    return tier.messages[messageIndex];
}

function getScoreBracket(distance) {
    const safeDistance = Math.max(0, Number(distance) || 0);
    const exactAnchor = OKLAB_SCORE_ANCHORS.find((anchor) => (
        Math.abs(anchor.distance - safeDistance) < 1e-9
    ));
    if (exactAnchor) return { lower: exactAnchor, upper: exactAnchor };

    for (let index = 1; index < OKLAB_SCORE_ANCHORS.length; index++) {
        const upper = OKLAB_SCORE_ANCHORS[index];
        if (safeDistance < upper.distance) {
            return { lower: OKLAB_SCORE_ANCHORS[index - 1], upper };
        }
    }

    const lastAnchor = OKLAB_SCORE_ANCHORS[OKLAB_SCORE_ANCHORS.length - 1];
    return { lower: lastAnchor, upper: null };
}

function updateScoreInfoDialog() {
    const score = gameState.recallLastRoundScore;
    const distance = gameState.recallLastRoundDistance;
    const { lower, upper } = getScoreBracket(distance);

    elements.scoreInfoTitle.textContent = `这 ${score.toFixed(2)} 分是怎么来的？`;
    elements.scoreInfoScore.textContent = `${score.toFixed(2)} / 10`;
    elements.scoreInfoDistance.textContent = distance.toFixed(1);

    if (!upper) {
        elements.scoreInfoRange.textContent = `本轮色差 ${distance.toFixed(1)}，超过最后一个评分锚点 ${lower.distance}。`;
        elements.scoreInfoInterpolation.textContent = `色差达到 ${lower.distance} 或更高时，本轮得分为 ${score.toFixed(2)}。`;
        return;
    }

    if (lower === upper) {
        elements.scoreInfoRange.textContent = `本轮色差 ${distance.toFixed(1)}，正好落在评分锚点上。`;
        elements.scoreInfoInterpolation.textContent = `这个锚点对应 ${lower.score.toFixed(1)} 分，本轮最终得分为 ${score.toFixed(2)}。`;
        return;
    }

    elements.scoreInfoRange.textContent = `本轮色差 ${distance.toFixed(1)}，位于 ${lower.distance} 和 ${upper.distance} 之间。`;
    elements.scoreInfoInterpolation.textContent = `对应分数从 ${lower.score.toFixed(1)} 到 ${upper.score.toFixed(1)} 线性换算，本轮最终得分为 ${score.toFixed(2)}。`;
}

function openScoreInfoDialog() {
    updateScoreInfoDialog();
    scoreInfoReturnFocus = elements.scoreInfoButton;
    elements.scoreInfoDialog.classList.remove('hidden');
    elements.scoreInfoDialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    elements.scoreInfoClose.focus();
}

function closeScoreInfoDialog() {
    if (elements.scoreInfoDialog.classList.contains('hidden')) return;
    elements.scoreInfoDialog.classList.add('hidden');
    elements.scoreInfoDialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (scoreInfoReturnFocus?.isConnected) scoreInfoReturnFocus.focus();
    scoreInfoReturnFocus = undefined;
}

function handleScoreInfoDialogKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        closeScoreInfoDialog();
        return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [elements.scoreInfoClose, elements.scoreInfoConfirm];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

// 提交颜色复现答案
function submitRecallAnswer() {
    if (gameState.recallRoundSubmitted) return;

    const target = gameState.recallTargetRGB;
    const user = getRecallUserRGB();
    const distance = calculatePerceptualDistance(target, user);
    const scoreCenti = Math.round(calculatePerceptualScore(target, user) * 100);
    const score = scoreCenti / 100;
    addToColorHistory(`rgb(${target.r}, ${target.g}, ${target.b})`);
    
    // 累计得分
    gameState.recallTotalScoreCenti += scoreCenti;
    gameState.recallTotalScore = gameState.recallTotalScoreCenti / 100;
    gameState.recallRoundSubmitted = true;
    gameState.recallLastRoundScore = score;
    gameState.recallLastRoundDistance = distance;
    
    // 显示结果
    showRecallSection(elements.recallResultSection);
    
    // 显示本轮得分
    elements.recallRoundScore.textContent = score.toFixed(2);
    elements.recallRoundFeedback.textContent = getRecallFeedback(score, gameState.recallRound);
    
    // 显示目标颜色和用户复现
    elements.recallResultTarget.style.backgroundColor = `rgb(${target.r}, ${target.g}, ${target.b})`;
    elements.recallResultUser.style.backgroundColor = `rgb(${user.r}, ${user.g}, ${user.b})`;
    
    // 显示色码
    elements.recallTargetCode.textContent = `rgb(${target.r}, ${target.g}, ${target.b})`;
    elements.recallUserCode.textContent = `rgb(${user.r}, ${user.g}, ${user.b})`;
    
    // 更新显示
    updateDisplays();
    
    // 检查是否完成所有轮次
    if (gameState.recallRound >= gameState.recallTotalRounds) {
        elements.nextRecallBtn.textContent = '查看结果';
    }

    playSound('correct');
}

// 下一轮或结束
function nextRecallRoundOrEnd() {
    if (!gameState.isGameActive || !gameState.recallRoundSubmitted) return;

    if (gameState.recallRound >= gameState.recallTotalRounds) {
        showColorRecallResult();
        return;
    }

    gameState.recallRound++;
    elements.nextRecallBtn.textContent = '下一轮';
    startColorRecallRound();
}

// 显示颜色复现游戏结果
function showColorRecallResult() {
    gameState.isGameActive = false;
    showRecallFinalLayout();
    showScreen(elements.resultScreen);
    resetResultColorBlocks();
    elements.resultDetail.innerHTML = '';
    elements.resultDetail.classList.add('hidden');
    const config = recallDifficultyConfig[gameState.recallDifficulty];
    
    // 检查是否是新纪录
    const previousBest = gameState.recallBestScores[gameState.recallDifficulty];
    const isNewRecord = gameState.recallTotalScore > previousBest;
    if (isNewRecord) {
        gameState.recallBestScores[gameState.recallDifficulty] = gameState.recallTotalScore;
        setStorageItem(config.storageKey, gameState.recallTotalScore.toString());
        updateBestOverviews();
    }
    
    elements.resultIcon.className = 'text-6xl mb-4 text-primary';
    elements.resultIcon.innerHTML = iconMarkup('paint-brush');
    elements.resultText.textContent = `${config.name}颜色复现完成！`;
    elements.resultText.className = 'text-3xl font-bold mb-6 text-primary';

    const totalScore = gameState.recallTotalScore;
    const bestScore = gameState.recallBestScores[gameState.recallDifficulty];
    const averageScore = totalScore / gameState.recallTotalRounds;

    elements.recallFinalScore.textContent = totalScore.toFixed(2);
    elements.recallFinalMax.textContent = `/ ${gameState.recallTotalRounds * 10}`;
    elements.recallFinalAverage.textContent = averageScore.toFixed(2);
    elements.recallFinalBest.textContent = bestScore.toFixed(2);
    elements.recallFinalRounds.textContent = gameState.recallTotalRounds;

    if (isNewRecord && previousBest > 0) {
        elements.recallFinalRecordNote.textContent = `刷新本机最佳，比上次提高 ${(totalScore - previousBest).toFixed(2)} 分`;
    } else if (isNewRecord) {
        elements.recallFinalRecordNote.textContent = '首次完成，已记录为本机最佳';
    } else if (totalScore === previousBest) {
        elements.recallFinalRecordNote.textContent = '追平本机最佳';
    } else {
        elements.recallFinalRecordNote.textContent = `距离本机最佳还差 ${(previousBest - totalScore).toFixed(2)} 分`;
    }

    updateDisplays();
    elements.continueButton.classList.add('hidden');
    elements.restartButton.classList.remove('hidden');
    requestAnimationFrame(() => elements.resultText.focus({ preventScroll: true }));
}

// 设置HSL色轮交互
function setupHSLWheelInteraction() {
    let isDragging = false;
    let wheelRect;
    let pendingPoint;
    let moveFrameId;

    const applyPoint = ({ clientX, clientY }) => {
        const rect = wheelRect || elements.hslWheel.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let x = clientX - centerX;
        let y = clientY - centerY;

        // 计算角度（色调）
        let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
        if (angle < 0) angle += 360;
        gameState.recallUserHSL.h = Math.round(angle) % 360;

        // 计算距离（饱和度）
        const distance = Math.sqrt(x * x + y * y);
        const maxDistance = rect.width / 2;
        gameState.recallUserHSL.s = Math.min(100, Math.round((distance / maxDistance) * 100));

        updateHSLPointerPosition(rect);
        updateRecallUserColor();
    };

    const queueMove = (event) => {
        if (event.cancelable) event.preventDefault();
        const point = event.touches ? event.touches[0] : event;
        if (!point) return;
        pendingPoint = { clientX: point.clientX, clientY: point.clientY };
        if (moveFrameId) return;
        moveFrameId = requestAnimationFrame(() => {
            moveFrameId = undefined;
            const nextPoint = pendingPoint;
            pendingPoint = undefined;
            if (nextPoint) applyPoint(nextPoint);
        });
    };

    const startDragging = (event) => {
        isDragging = true;
        wheelRect = elements.hslWheel.getBoundingClientRect();
        queueMove(event);
    };

    const stopDragging = (event) => {
        if (moveFrameId) {
            cancelAnimationFrame(moveFrameId);
            moveFrameId = undefined;
        }
        const finalPoint = pendingPoint;
        pendingPoint = undefined;
        if (event?.type !== 'touchcancel' && finalPoint) applyPoint(finalPoint);
        isDragging = false;
        wheelRect = undefined;
    };

    elements.hslWheel.addEventListener('mousedown', (e) => {
        startDragging(e);
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) queueMove(e);
    });

    document.addEventListener('mouseup', stopDragging);

    // 触摸支持
    elements.hslWheel.addEventListener('touchstart', (e) => {
        startDragging(e);
    }, { passive: false });

    elements.hslWheel.addEventListener('touchmove', (e) => {
        if (isDragging) queueMove(e);
    }, { passive: false });

    elements.hslWheel.addEventListener('touchend', stopDragging);
    elements.hslWheel.addEventListener('touchcancel', stopDragging);
    
    // 亮度滑块
    const syncHslSliders = () => {
        gameState.recallUserHSL.h = parseInt(elements.hueSlider.value);
        gameState.recallUserHSL.s = parseInt(elements.saturationSlider.value);
        updateHSLPointerPosition();
        updateRecallUserColor();
    };
    elements.hueSlider.addEventListener('input', syncHslSliders);
    elements.saturationSlider.addEventListener('input', syncHslSliders);

    elements.lightnessSlider.addEventListener('input', (e) => {
        gameState.recallUserHSL.l = parseInt(e.target.value);
        updateRecallUserColor();
    });

    const syncRgbSlider = () => {
        gameState.recallUserRGB = {
            r: parseInt(elements.redSlider.value),
            g: parseInt(elements.greenSlider.value),
            b: parseInt(elements.blueSlider.value)
        };
        updateRecallUserColor();
    };
    elements.redSlider.addEventListener('input', syncRgbSlider);
    elements.greenSlider.addEventListener('input', syncRgbSlider);
    elements.blueSlider.addEventListener('input', syncRgbSlider);
    
    // 提交按钮
    elements.submitRecallBtn.addEventListener('click', submitRecallAnswer);
    
    // 下一轮按钮
    elements.nextRecallBtn.addEventListener('click', nextRecallRoundOrEnd);
}

function handleClearHistoryRequest() {
    if (!elements.clearHistoryBtn.classList.contains('is-confirming')) {
        elements.clearHistoryBtn.classList.add('is-confirming');
        elements.clearHistoryBtn.textContent = '确认清空';
        elements.clearHistoryCancel.classList.remove('hidden');
        clearHistoryConfirmationTimeoutId = setTimeout(resetClearHistoryConfirmation, 5000);
        return;
    }

    clearGlobalColorHistory();
}

function resetClearHistoryConfirmation() {
    const shouldReturnFocus = document.activeElement === elements.clearHistoryCancel;
    clearTimeout(clearHistoryConfirmationTimeoutId);
    clearHistoryConfirmationTimeoutId = undefined;
    elements.clearHistoryBtn.classList.remove('is-confirming');
    elements.clearHistoryBtn.textContent = '清空全部色卡';
    elements.clearHistoryCancel.classList.add('hidden');
    if (shouldReturnFocus) elements.clearHistoryBtn.focus();
}

function clearGlobalColorHistory() {
    gameState.colorHistory = [];
    selectedHistoryHex = undefined;
    removeStorageItem(COLOR_HISTORY_STORAGE_KEY);
    updateColorHistoryDisplay();
    requestAnimationFrame(() => elements.colorHistoryTitle.focus({ preventScroll: true }));
}

function disableAudioAfterFailure() {
    audioContext = undefined;
}

function playSound(soundName) {
    const notes = soundPatterns[soundName];
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!notes || !AudioContext) return;

    try {
        if (!audioContext) audioContext = new AudioContext();
    } catch {
        disableAudioAfterFailure();
        return;
    }

    const playNotes = () => {
        try {
            const now = audioContext.currentTime;
            notes.forEach((frequency, index) => {
                const start = now + index * 0.1;
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                oscillator.type = soundName === 'wrong' ? 'triangle' : 'sine';
                oscillator.frequency.setValueAtTime(frequency, start);
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start(start);
                oscillator.stop(start + 0.15);
            });
        } catch {
            disableAudioAfterFailure();
        }
    };

    if (audioContext.state === 'suspended') {
        try {
            Promise.resolve(audioContext.resume()).then(playNotes).catch(disableAudioAfterFailure);
        } catch {
            disableAudioAfterFailure();
        }
    } else {
        playNotes();
    }
}

// 初始化游戏
window.addEventListener('DOMContentLoaded', initGame);


