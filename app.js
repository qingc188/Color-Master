// 游戏状态
const COLOR_HISTORY_STORAGE_KEY = 'colorMemoryGlobalColorHistory';
const THEME_STORAGE_KEY = 'colorMemoryInterfaceTheme';
const MAX_COLOR_HISTORY = 100;
const MAX_SESSION_ROUNDS = 100;
const MAX_RECAP_ROUNDS = 12;
const OBSERVATION_DURATION_MS = 5000;
const THEME_ROTATION_MS = 520;
const THEME_SWAP_DELAY_MS = 260;
const RECAP_TURN_MS = 240;
const LOCAL_RECORD_HINT_DURATION_MS = 5000;
const THEME_ORDER = ['cyan', 'amethyst', 'ivory'];
const THEME_CONFIG = {
    cyan: { name: '青橙', themeColor: '#071820' },
    amethyst: { name: '星夜紫金', themeColor: '#100B25' },
    ivory: { name: '雾蓝柔粉', themeColor: '#151B2C' }
};
let storageAvailable = true;

function markStorageUnavailable() {
    storageAvailable = false;
    const storageStatus = document.getElementById('storage-status');
    if (storageStatus) storageStatus.classList.remove('hidden');
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
let localRecordHintTimeoutId;
document.documentElement.dataset.theme = THEME_ORDER[activeThemeIndex];

const gameState = {
    level: 1,
    score: 0,
    currentTargetColor: null,
    isGameActive: false,
    colorHistory: loadColorHistory(),
    sessionRounds: [],
    // 新模式相关状态
    gameMode: null, // 'colorMatch' 或 'colorRecall'
    matchDifficulty: 'basic',
    matchBestScores: {
        basic: Number(getStorageItem('colorMemoryBestMatchScore_basic')) || 0,
        advanced: Number(getStorageItem('colorMemoryBestMatchScore_advanced')) || 0,
        master: Number(getStorageItem('colorMemoryBestMatchScore_master') || getStorageItem('colorMemoryBestScore')) || 0
    },
    lives: 3, // 仅用于颜色匹配大师模式
    totalLevels: 10, // 仅用于固定关卡的颜色匹配模式
    correctAnswers: 0, // 用于计算正确率
    totalAnswers: 0, // 用于计算正确率
    matchRoundSubmitted: false,
    matchLastAnswerCorrect: false,
    matchRoundCompletesGame: false,
    // 颜色复现模式专用
    recallDifficulty: 'basic',
    recallTotalScore: 0, // 累计得分
    recallTotalScoreCenti: 0,
    recallBestScores: {
        basic: Number(getStorageItem('colorMemoryBestRecallScore_basic_oklab_v4')) || 0,
        advanced: Number(getStorageItem('colorMemoryBestRecallScore_advanced_oklab_v4')) || 0,
        master: Number(getStorageItem('colorMemoryBestRecallScore_master_oklab_v4')) || 0
    },
    recallTargetHSL: null, // 目标HSL颜色
    recallTargetRGB: null,
    recallUserHSL: { h: 0, s: 100, l: 50 }, // 用户当前HSL颜色
    recallUserRGB: { r: 128, g: 128, b: 128 },
    recallRound: 1, // 当前轮次
    recallRoundSubmitted: false,
    recallTotalRounds: 10 // 总轮次
};

const recapState = {
    rounds: [],
    page: 0,
    selectedIndex: 0,
    sample: 'target',
    touchX: null,
    touchY: null,
    turnTimer: undefined
};

// DOM 元素
const elements = {
    themeColorMeta: document.getElementById('theme-color-meta'),
    themeCubeButton: document.getElementById('theme-cube-button'),
    themeCube: document.getElementById('theme-cube'),
    themeStatus: document.getElementById('theme-status'),
    themeDots: document.querySelectorAll('[data-theme-dot]'),
    brandHeader: document.getElementById('brand-header'),
    siteFooter: document.getElementById('site-footer'),
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
    matchRoundTitle: document.getElementById('match-round-title'),
    matchRoundIcon: document.getElementById('match-round-icon'),
    matchRoundIconUse: document.getElementById('match-round-icon-use'),
    matchRoundMessage: document.getElementById('match-round-message'),
    matchRoundActions: document.getElementById('match-round-actions'),
    matchContinueButton: document.getElementById('match-continue-button'),
    matchRestartButton: document.getElementById('match-restart-button'),
    colorRecallScreen: document.getElementById('color-recall-screen'),
    gameInfoAnchor: document.getElementById('game-info-anchor'),
    gameInfoBar: document.getElementById('game-info-bar'),
    gameStatsPanel: document.getElementById('game-stats-panel'),
    modeBestOverview: document.getElementById('mode-best-overview'),
    localRecordHint: document.getElementById('local-record-hint'),
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
    resultEyebrow: document.getElementById('result-eyebrow'),
    resultText: document.getElementById('result-text'),
    finalPrimaryLabel: document.getElementById('final-primary-label'),
    finalPrimaryValue: document.getElementById('final-primary-value'),
    finalPrimaryUnit: document.getElementById('final-primary-unit'),
    finalStatOneLabel: document.getElementById('final-stat-one-label'),
    finalStatOneValue: document.getElementById('final-stat-one-value'),
    finalStatTwoLabel: document.getElementById('final-stat-two-label'),
    finalStatTwoValue: document.getElementById('final-stat-two-value'),
    finalRecordNote: document.getElementById('final-record-note'),
    sessionRecap: document.getElementById('session-recap'),
    recapShowTarget: document.getElementById('recap-show-target'),
    recapShowAnswer: document.getElementById('recap-show-answer'),
    recapCubeViewport: document.getElementById('session-recap-cube-viewport'),
    recapCubeStage: document.getElementById('session-recap-cube-stage'),
    recapCube: document.getElementById('session-recap-cube'),
    recapFaces: document.querySelectorAll('[data-recap-face]'),
    recapPrevious: document.getElementById('recap-previous'),
    recapNext: document.getElementById('recap-next'),
    recapFaceRange: document.getElementById('recap-face-range'),
    recapFaceIndex: document.getElementById('recap-face-index'),
    recapRoundList: document.getElementById('recap-round-list'),
    recapDetailRound: document.getElementById('recap-detail-round'),
    recapDetailResult: document.getElementById('recap-detail-result'),
    recapDetailTargetSwatch: document.getElementById('recap-detail-target-swatch'),
    recapDetailTargetHex: document.getElementById('recap-detail-target-hex'),
    recapDetailAnswerSwatch: document.getElementById('recap-detail-answer-swatch'),
    recapDetailAnswerHex: document.getElementById('recap-detail-answer-hex'),
    recapDetailGuidance: document.getElementById('recap-detail-guidance'),
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
    recallRoundGuidance: document.getElementById('recall-round-guidance'),
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

const MATCH_FAILURE_MESSAGES = [
    '匹配错误，再试试吧！',
    '匹配错误，慢慢来！',
    '匹配错误，别灰心!',
    '匹配错误，再靠近一点点!',
    '匹配错误，已经很接近了!'
];

const MATCH_FINAL_FAILURE_MESSAGES = [
    '匹配错误，别灰心!',
    '匹配错误，已经很接近了!'
];

const recallDifficultyConfig = {
    basic: {
        name: '基础',
        controlName: 'HSL 控制',
        preview: true,
        storageKey: 'colorMemoryBestRecallScore_basic_oklab_v4',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '5 秒后目标颜色隐藏，进入复现环节',
            '使用 HSL 色轮或色相、饱和度、明度滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '每轮比较色相、饱和度和明度，满分 10 分，共 10 轮'
        ]
    },
    advanced: {
        name: '进阶',
        controlName: 'RGB 控制',
        preview: true,
        storageKey: 'colorMemoryBestRecallScore_advanced_oklab_v4',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '5 秒后目标颜色隐藏，进入复现环节',
            '使用 R、G、B 三个滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '每轮比较色相、饱和度和明度，满分 10 分，共 10 轮'
        ]
    },
    master: {
        name: '大师',
        controlName: 'RGB 盲调',
        preview: false,
        storageKey: 'colorMemoryBestRecallScore_master_oklab_v4',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '5 秒后目标颜色隐藏，进入复现环节',
            '只使用 R、G、B 三个滑杆调整参数',
            '调整时不会显示实时颜色预览',
            '每轮比较色相、饱和度和明度，满分 10 分，共 10 轮'
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
    if (elements.themeColorMeta) elements.themeColorMeta.setAttribute('content', config.themeColor);
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
    if (elements.themeCubeButton) {
        elements.themeCubeButton.classList.remove('is-turning');
        elements.themeCubeButton.removeAttribute('aria-busy');
    }
}

function switchTheme() {
    if (themeSwitching) return;

    const nextThemeIndex = (activeThemeIndex + 1) % THEME_ORDER.length;
    const nextTheme = THEME_ORDER[nextThemeIndex];
    const reduceMotion = Boolean(window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const supports3d = Boolean(window.CSS
        && window.CSS.supports
        && window.CSS.supports('transform-style', 'preserve-3d'));

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
    if (elements.themeCubeButton) elements.themeCubeButton.addEventListener('click', switchTheme);
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
    const isFinalScreen = screen === elements.resultScreen;
    const isImmersiveScreen = isActiveGameScreen || isFinalScreen;
    elements.brandHeader.classList.toggle('hidden', screen === elements.landingScreen || isImmersiveScreen);
    elements.siteFooter.classList.toggle('hidden', isImmersiveScreen);
    document.body.classList.toggle('is-immersive-screen', isImmersiveScreen);
}

function showRecallSection(section) {
    recallSections.forEach((item) => {
        item.classList.toggle('hidden', item !== section);
    });
    const sectionTitle = section.querySelector('h2');
    if (sectionTitle) sectionTitle.focus({ preventScroll: true });
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
    gameState.recallUserHSL = { h: 0, s: 100, l: 50 };
    gameState.recallUserRGB = { r: 128, g: 128, b: 128 };
    elements.nextRecallBtn.textContent = '下一轮';
    updateDisplays();
}

function resetSessionRecap() {
    recapState.rounds = [];
    recapState.page = 0;
    recapState.selectedIndex = 0;
    recapState.sample = 'target';
    clearTimeout(recapState.turnTimer);
    elements.sessionRecap.classList.add('hidden');
    delete elements.sessionRecap.dataset.mode;
    elements.recapFaces.forEach((face) => {
        face.textContent = '';
    });
    elements.recapRoundList.textContent = '';
    elements.recapCube.style.transform = 'rotateY(0deg)';
}

function showMatchResultLayout() {
    elements.resultScreen.dataset.resultMode = 'match';
    elements.resultChangeDifficulty.classList.remove('hidden');
    elements.restartButton.textContent = '再玩一次';
}

function resetMatchRoundFeedback() {
    elements.matchRoundMessage.textContent = '找出与目标颜色相同的方块';
    elements.matchRoundIcon.classList.add('hidden');
    elements.matchRoundTitle.classList.remove('is-success', 'is-failure');
    elements.matchRoundActions.classList.add('hidden');
    elements.matchContinueButton.textContent = '下一关';
    gameState.matchRoundCompletesGame = false;
}

function getMatchFailureMessage(isFinalRound) {
    const messages = isFinalRound ? MATCH_FINAL_FAILURE_MESSAGES : MATCH_FAILURE_MESSAGES;
    return messages[Math.floor(Math.random() * messages.length)];
}

function addMatchCardResult(card, label, stateClass, iconName) {
    if (!card) return;
    card.classList.add(stateClass);
    card.setAttribute('aria-label', `${card.getAttribute('aria-label')}，${label}`);
    const resultLabel = document.createElement('span');
    resultLabel.className = 'match-card-result';
    resultLabel.setAttribute('aria-hidden', 'true');
    resultLabel.innerHTML = iconMarkup(iconName);
    card.appendChild(resultLabel);
}

function showMatchRoundFeedback(selectedCard, isCorrect, isFinalRound) {
    const cards = Array.from(elements.colorGrid.querySelectorAll('.color-card'));
    const targetHex = rgbToHex(gameState.currentTargetColor);
    const targetCard = cards.find((card) => rgbToHex(card.style.backgroundColor) === targetHex);

    cards.forEach((card) => {
        card.disabled = true;
        const colorCode = rgbToHex(card.style.backgroundColor);
        card.setAttribute('aria-label', `${card.getAttribute('aria-label')}，色号 ${colorCode}`);
        const codeLabel = document.createElement('code');
        codeLabel.className = 'match-card-code';
        codeLabel.setAttribute('aria-hidden', 'true');
        codeLabel.textContent = colorCode;
        card.appendChild(codeLabel);
        if (card !== selectedCard && card !== targetCard) card.classList.add('is-match-muted');
    });

    if (isCorrect) {
        addMatchCardResult(selectedCard, '正确选择', 'is-match-correct', 'check');
        elements.matchRoundIconUse.setAttribute('href', '#icon-check-circle');
        elements.matchRoundMessage.textContent = '完美匹配！';
        elements.matchRoundTitle.classList.add('is-success');
    } else {
        addMatchCardResult(selectedCard, '你的选择', 'is-match-selected-wrong', 'x');
        addMatchCardResult(targetCard, '正确答案', 'is-match-correct', 'check');
        elements.matchRoundIconUse.setAttribute('href', '#icon-x-circle');
        elements.matchRoundMessage.textContent = getMatchFailureMessage(isFinalRound);
        elements.matchRoundTitle.classList.add('is-failure');
    }

    elements.matchRoundIcon.classList.remove('hidden');
    elements.matchRoundActions.classList.remove('hidden');
    elements.matchRoundTitle.focus({ preventScroll: true });
}

function showRecallFinalLayout() {
    elements.resultScreen.dataset.resultMode = 'recall';
    elements.resultChangeDifficulty.classList.remove('hidden');
    elements.restartButton.textContent = '再玩一次';
}

function setFinalSummary({
    primaryLabel,
    primaryValue,
    primaryUnit,
    stats,
    recordNote = ''
}) {
    elements.finalPrimaryLabel.textContent = primaryLabel;
    elements.finalPrimaryValue.textContent = primaryValue;
    elements.finalPrimaryUnit.textContent = primaryUnit;
    elements.finalStatOneLabel.textContent = stats[0].label;
    elements.finalStatOneValue.textContent = stats[0].value;
    elements.finalStatTwoLabel.textContent = stats[1].label;
    elements.finalStatTwoValue.textContent = stats[1].value;
    elements.finalRecordNote.textContent = recordNote;
    elements.finalRecordNote.classList.toggle('hidden', !recordNote);
}

function appendSessionRound(round) {
    gameState.sessionRounds.push(round);
    if (gameState.sessionRounds.length > MAX_SESSION_ROUNDS) {
        gameState.sessionRounds.splice(0, gameState.sessionRounds.length - MAX_SESSION_ROUNDS);
    }
}

function getRecapRoundNumber(round, index = 0) {
    return Number(round.attempt || round.round || index + 1);
}

function formatRecapRound(round, index = 0) {
    return `R${String(getRecapRoundNumber(round, index)).padStart(2, '0')}`;
}

function getRecapResultText(round) {
    if (round.mode === 'colorMatch') return round.correct ? '正确' : '未命中';
    return `${round.score.toFixed(2)} 分`;
}

function getRecapTileResult(round) {
    if (round.mode === 'colorMatch') return round.correct ? '✓' : '×';
    return round.score.toFixed(1);
}

function createRecapRoundTile(round, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-recap-tile';
    button.dataset.recapRound = String(getRecapRoundNumber(round, index));
    button.dataset.recapIndex = String(index);
    button.dataset.targetHex = round.targetHex;
    button.dataset.answerHex = round.answerHex;
    button.dataset.outcome = getRecapResultText(round);
    button.style.backgroundColor = recapState.sample === 'target' ? round.targetHex : round.answerHex;
    button.setAttribute('aria-label', `${formatRecapRound(round, index)}，${getRecapResultText(round)}`);
    button.addEventListener('click', () => updateRecapDetail(index));
    return button;
}

function createRecapEmptyTile() {
    const tile = document.createElement('i');
    tile.className = 'session-recap-tile session-recap-tile--empty';
    tile.setAttribute('aria-hidden', 'true');
    return tile;
}

function renderRecapFaces() {
    elements.recapFaces.forEach((face, page) => {
        face.textContent = '';
        const startIndex = page * 4;
        for (let offset = 0; offset < 4; offset++) {
            const index = startIndex + offset;
            face.appendChild(index < recapState.rounds.length
                ? createRecapRoundTile(recapState.rounds[index], index)
                : createRecapEmptyTile());
        }
    });
}

function renderRecapRoundList() {
    elements.recapRoundList.textContent = '';
    const startIndex = recapState.page * 4;
    const endIndex = Math.min(startIndex + 4, recapState.rounds.length);
    for (let index = startIndex; index < endIndex; index++) {
        const round = recapState.rounds[index];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recap-round-button';
        button.dataset.recapRound = String(getRecapRoundNumber(round, index));
        button.dataset.recapIndex = String(index);
        button.dataset.targetHex = round.targetHex;
        button.dataset.answerHex = round.answerHex;
        button.setAttribute('aria-label', `${formatRecapRound(round, index)}，${getRecapResultText(round)}`);

        const swatch = document.createElement('i');
        swatch.style.backgroundColor = recapState.sample === 'target' ? round.targetHex : round.answerHex;
        swatch.setAttribute('aria-hidden', 'true');
        const number = document.createElement('span');
        number.textContent = formatRecapRound(round, index);
        const result = document.createElement('strong');
        result.textContent = getRecapTileResult(round);
        button.append(swatch, number, result);
        button.addEventListener('click', () => updateRecapDetail(index));
        elements.recapRoundList.appendChild(button);
    }
}

function updateRecapSample(sample) {
    recapState.sample = sample;
    elements.recapShowTarget.setAttribute('aria-pressed', sample === 'target' ? 'true' : 'false');
    elements.recapShowAnswer.setAttribute('aria-pressed', sample === 'answer' ? 'true' : 'false');
    elements.sessionRecap.querySelectorAll('[data-recap-index]').forEach((button) => {
        const round = recapState.rounds[Number(button.dataset.recapIndex)];
        const swatch = button.classList.contains('recap-round-button') ? button.querySelector('i') : button;
        swatch.style.backgroundColor = sample === 'target' ? round.targetHex : round.answerHex;
    });
}

function updateRecapDetail(index) {
    const round = recapState.rounds[index];
    if (!round) return;
    recapState.selectedIndex = index;
    elements.sessionRecap.querySelectorAll('[data-recap-index]').forEach((button) => {
        const active = Number(button.dataset.recapIndex) === index;
        button.classList.toggle('is-active', active);
        if (active) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    });

    elements.recapDetailRound.textContent = formatRecapRound(round, index);
    elements.recapDetailResult.textContent = getRecapResultText(round);
    elements.recapDetailResult.classList.toggle('is-failure', round.mode === 'colorMatch' && !round.correct);
    elements.recapDetailTargetSwatch.style.backgroundColor = round.targetHex;
    elements.recapDetailTargetHex.textContent = round.targetHex;
    elements.recapDetailAnswerSwatch.style.backgroundColor = round.answerHex;
    elements.recapDetailAnswerHex.textContent = round.answerHex;
    const guidance = round.mode === 'colorRecall' ? round.guidance : '';
    elements.recapDetailGuidance.textContent = guidance;
    elements.recapDetailGuidance.classList.toggle('hidden', !guidance);
}

function updateRecapPage(page, selectFirst = true, animate = false) {
    const pageCount = Math.max(1, Math.ceil(recapState.rounds.length / 4));
    const nextPage = Math.max(0, Math.min(pageCount - 1, page));
    recapState.page = nextPage;
    const reduceMotion = Boolean(window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const supports3d = Boolean(window.CSS
        && window.CSS.supports
        && window.CSS.supports('transform-style', 'preserve-3d'));

    elements.recapCubeStage.classList.toggle('is-flat', !supports3d);
    clearTimeout(recapState.turnTimer);
    elements.recapCube.classList.remove('is-turning');
    if (animate && !reduceMotion && supports3d) {
        elements.recapCube.classList.add('is-turning');
        recapState.turnTimer = setTimeout(() => {
            elements.recapCube.classList.remove('is-turning');
        }, RECAP_TURN_MS + 20);
    }
    elements.recapCube.style.transform = `rotateY(${-90 * nextPage}deg)`;

    elements.recapFaces.forEach((face, faceIndex) => {
        const active = faceIndex === nextPage;
        face.setAttribute('aria-hidden', active ? 'false' : 'true');
        face.querySelectorAll('button').forEach((button) => {
            button.tabIndex = active ? 0 : -1;
        });
    });

    elements.recapPrevious.disabled = nextPage === 0;
    elements.recapNext.disabled = nextPage === pageCount - 1;
    const startIndex = nextPage * 4;
    const endIndex = Math.min(startIndex + 4, recapState.rounds.length) - 1;
    elements.recapFaceRange.textContent = `${formatRecapRound(recapState.rounds[startIndex], startIndex)}–${formatRecapRound(recapState.rounds[endIndex], endIndex)}`;
    elements.recapFaceIndex.textContent = `${nextPage + 1}/${pageCount}`;
    renderRecapRoundList();
    updateRecapSample(recapState.sample);
    if (selectFirst) updateRecapDetail(startIndex);
    else updateRecapDetail(recapState.selectedIndex);
}

function renderSessionRecap() {
    recapState.rounds = gameState.sessionRounds.slice(-MAX_RECAP_ROUNDS);
    if (!recapState.rounds.length) {
        resetSessionRecap();
        return;
    }
    recapState.page = 0;
    recapState.selectedIndex = 0;
    recapState.sample = 'target';
    const isRecall = recapState.rounds[0].mode === 'colorRecall';
    elements.sessionRecap.dataset.mode = isRecall ? 'recall' : 'match';
    elements.recapShowTarget.textContent = '目标颜色';
    elements.recapShowAnswer.textContent = isRecall ? '复现颜色' : '选择颜色';
    elements.recapShowTarget.parentElement.setAttribute(
        'aria-label',
        isRecall ? '切换目标颜色或复现颜色' : '切换目标颜色或选择颜色'
    );
    elements.sessionRecap.classList.remove('hidden');
    renderRecapFaces();
    updateRecapPage(0);
}

function setupSessionRecapInteraction() {
    elements.recapShowTarget.addEventListener('click', () => updateRecapSample('target'));
    elements.recapShowAnswer.addEventListener('click', () => updateRecapSample('answer'));
    elements.recapPrevious.addEventListener('click', () => updateRecapPage(recapState.page - 1, true, true));
    elements.recapNext.addEventListener('click', () => updateRecapPage(recapState.page + 1, true, true));
    elements.recapCubeViewport.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            updateRecapPage(recapState.page - 1);
            if (event.target !== elements.recapCubeViewport) {
                elements.recapCubeViewport.focus({ preventScroll: true });
            }
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            updateRecapPage(recapState.page + 1);
            if (event.target !== elements.recapCubeViewport) {
                elements.recapCubeViewport.focus({ preventScroll: true });
            }
        }
    });
    elements.recapCubeViewport.addEventListener('touchstart', (event) => {
        if (!event.touches || event.touches.length !== 1) return;
        recapState.touchX = event.touches[0].clientX;
        recapState.touchY = event.touches[0].clientY;
    }, { passive: true });
    elements.recapCubeViewport.addEventListener('touchend', (event) => {
        if (recapState.touchX === null || !event.changedTouches || event.changedTouches.length !== 1) return;
        const deltaX = event.changedTouches[0].clientX - recapState.touchX;
        const deltaY = event.changedTouches[0].clientY - recapState.touchY;
        recapState.touchX = null;
        recapState.touchY = null;
        if (Math.abs(deltaX) < 36 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
        updateRecapPage(recapState.page + (deltaX < 0 ? 1 : -1), true, true);
    }, { passive: true });
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
    const isFinalResult = screen === elements.resultScreen && !gameState.isGameActive;

    document.body.classList.toggle('is-difficulty-screen', isDifficultyScreen);
    elements.gameInfoAnchor.after(elements.gameInfoBar);
    elements.gameInfoBar.classList.toggle('hidden', isMainMenu || isPreparationScreen || isFinalResult);
    elements.gameStatsPanel.classList.toggle('hidden', isMainMenu || isDifficultyScreen);
    elements.modeBestOverview.classList.toggle('hidden', !isDifficultyScreen);
    elements.localRecordHint.classList.toggle('hidden', !isDifficultyScreen);
    elements.localRecordNote.classList.toggle('hidden', !isDifficultyScreen);
    if (!isDifficultyScreen) hideLocalRecordHint(true);
    elements.gameInfoBar.style.gridTemplateColumns = '1fr';
    elements.gameInfoBar.style.justifyContent = 'stretch';
}

function showLocalRecordHint(autoHide = false) {
    clearTimeout(localRecordHintTimeoutId);
    localRecordHintTimeoutId = undefined;
    elements.localRecordNote.classList.add('is-visible');
    elements.localRecordHint.setAttribute('aria-expanded', 'true');

    if (!autoHide) return;
    localRecordHintTimeoutId = setTimeout(() => {
        localRecordHintTimeoutId = undefined;
        hideLocalRecordHint(true);
    }, LOCAL_RECORD_HINT_DURATION_MS);
}

function hideLocalRecordHint(force = false) {
    if (localRecordHintTimeoutId && !force) return;
    clearTimeout(localRecordHintTimeoutId);
    localRecordHintTimeoutId = undefined;
    elements.localRecordNote.classList.remove('is-visible');
    elements.localRecordHint.setAttribute('aria-expanded', 'false');
}

function setupLocalRecordHint() {
    elements.localRecordHint.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') showLocalRecordHint();
    });
    elements.localRecordHint.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse') hideLocalRecordHint();
    });
    elements.localRecordHint.addEventListener('focus', () => {
        if (elements.localRecordHint.matches(':focus-visible')) showLocalRecordHint();
    });
    elements.localRecordHint.addEventListener('blur', () => hideLocalRecordHint());
    elements.localRecordHint.addEventListener('click', (event) => {
        const isTap = event.pointerType === 'touch'
            || event.pointerType === 'pen'
            || (event.detail > 0
                && window.matchMedia
                && window.matchMedia('(hover: none)').matches);
        if (!isTap) {
            showLocalRecordHint(true);
            return;
        }
        if (elements.localRecordHint.getAttribute('aria-expanded') === 'true') {
            hideLocalRecordHint(true);
        } else {
            showLocalRecordHint();
        }
    });
    elements.localRecordHint.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        hideLocalRecordHint(true);
    });
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
    const reduceMotion = Boolean(window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
    setupSessionRecapInteraction();
    setupLocalRecordHint();
    
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
    elements.restartButton.addEventListener('click', handleRestartButton);
    elements.matchContinueButton.addEventListener('click', handleMatchContinue);
    elements.matchRestartButton.addEventListener('click', restartCurrentMatchDifficulty);
    elements.restartRecallBtn.addEventListener('click', restartCurrentRecallDifficulty);
    elements.backButtons.forEach((button) => {
        button.addEventListener('click', () => handleBackNavigation(button.dataset.backTarget));
    });
    elements.clearHistoryBtn.addEventListener('click', handleClearHistoryRequest);
    elements.clearHistoryCancel.addEventListener('click', () => {
        resetClearHistoryConfirmation();
        elements.clearHistoryBtn.focus();
    });
    elements.resultChangeDifficulty.addEventListener('click', returnToDifficultySelection);
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
    gameState.matchRoundCompletesGame = false;
    resetSessionRecap();
    updateDisplays();
    showScreen(elements.startScreen);
}

function restartCurrentRecallDifficulty() {
    stopActiveCountdown();
    gameState.isGameActive = false;
    gameState.gameMode = 'colorRecall';
    resetSessionRecap();
    resetRecallAttemptState();
    showScreen(elements.startScreen);
}

function returnToDifficultySelection() {
    stopActiveCountdown();
    gameState.isGameActive = false;
    resetSessionRecap();
    if (gameState.gameMode === 'colorRecall') {
        resetRecallAttemptState();
        showDifficultyScreen(elements.recallDifficultyScreen, 'colorRecall');
        return;
    }
    showDifficultyScreen(elements.matchDifficultyScreen, 'colorMatch');
}

function handleRestartButton() {
    if (gameState.gameMode === 'colorRecall' || gameState.gameMode === 'colorMatch') {
        startGame();
        return;
    }
    restartGame();
}

// 开始游戏
function startGame() {
    gameState.isGameActive = true;
    gameState.sessionRounds = [];
    gameState.level = 1;
    gameState.score = 0;
    gameState.correctAnswers = 0;
    gameState.totalAnswers = 0;
    resetSessionRecap();
    
    // 根据模式初始化状态
    if (gameState.gameMode === 'colorMatch') {
        const config = matchDifficultyConfig[gameState.matchDifficulty];
        gameState.totalLevels = config.totalLevels;
        gameState.lives = config.endless ? 3 : 0;
        gameState.matchRoundCompletesGame = false;
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
    gameState.matchLastAnswerCorrect = false;
    gameState.matchRoundCompletesGame = false;
    
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
    resetMatchRoundFeedback();
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
        colorBlock.addEventListener('click', () => checkColorSelection(color, colorBlock));
        elements.colorGrid.appendChild(colorBlock);
    });
}

// 检查颜色选择
function checkColorSelection(selectedColor, selectedCard) {
    if (gameState.matchRoundSubmitted) return;
    gameState.matchRoundSubmitted = true;
    addToColorHistory(gameState.currentTargetColor);
    const targetHex = rgbToHex(gameState.currentTargetColor);
    const selectedHex = rgbToHex(selectedColor);
    gameState.totalAnswers++;
    const isCorrect = selectedHex === targetHex;
    const config = matchDifficultyConfig[gameState.matchDifficulty];
    gameState.matchLastAnswerCorrect = isCorrect;
    appendSessionRound({
        mode: 'colorMatch',
        attempt: gameState.totalAnswers,
        round: gameState.level,
        targetHex,
        answerHex: selectedHex,
        correct: isCorrect
    });
    
    // 判断选择是否正确
    if (isCorrect) {
        // 选择正确
        playSound('correct');
        gameState.score++;
        gameState.correctAnswers++;
    } else {
        // 选择错误
        playSound('wrong');

        // 处理大师无尽模式的生命值
        if (config.endless) {
            gameState.lives--;
        }
    }

    const isFinalRound = config.endless
        ? !isCorrect && gameState.lives <= 0
        : gameState.level >= config.totalLevels;
    gameState.matchRoundCompletesGame = isFinalRound;

    if (isFinalRound) {
        elements.matchContinueButton.textContent = '查看结果';
    } else if (!config.endless) {
        elements.matchContinueButton.textContent = '下一关';
    } else if (isCorrect) {
        // 大师模式只有做对才进入下一关
        elements.matchContinueButton.textContent = '下一关';
    } else {
        elements.matchContinueButton.textContent = '继续本关';
    }

    showMatchRoundFeedback(selectedCard, isCorrect, isFinalRound);
    updateDisplays();
}

function handleMatchContinue() {
    if (gameState.matchRoundCompletesGame) {
        showGameEnd();
        return;
    }

    nextLevel();
}

// 进入下一关
function nextLevel() {
    if (gameState.gameMode === 'colorMatch') {
        const config = matchDifficultyConfig[gameState.matchDifficulty];
        if (!config.endless || gameState.matchLastAnswerCorrect) gameState.level++;
    }
    showTargetColor();
}

// 显示游戏结束
function showGameEnd() {
    gameState.isGameActive = false;
    showMatchResultLayout();
    showScreen(elements.resultScreen);
    const config = matchDifficultyConfig[gameState.matchDifficulty];
    const isNewRecord = gameState.score > gameState.matchBestScores[gameState.matchDifficulty];
    if (isNewRecord) {
        gameState.matchBestScores[gameState.matchDifficulty] = gameState.score;
        setStorageItem(config.storageKey, gameState.score.toString());
        updateBestOverviews();
    }

    elements.resultEyebrow.textContent = '本局完成';
    elements.resultIcon.innerHTML = iconMarkup(config.endless ? 'star' : 'check-circle');
    elements.resultText.textContent = `${config.name} · 颜色匹配`;

    if (!config.endless) {
        const accuracy = gameState.totalAnswers > 0
            ? Math.round((gameState.correctAnswers / gameState.totalAnswers) * 100)
            : 0;
        setFinalSummary({
            primaryLabel: '正确率',
            primaryValue: String(accuracy),
            primaryUnit: '%',
            stats: [
                { label: '答对', value: `${gameState.correctAnswers} / ${gameState.totalAnswers}` },
                { label: '本机最佳', value: String(gameState.matchBestScores[gameState.matchDifficulty]) }
            ],
            recordNote: isNewRecord ? '新纪录！！' : ''
        });
    } else {
        setFinalSummary({
            primaryLabel: '得分',
            primaryValue: String(gameState.score),
            primaryUnit: '分',
            stats: [
                { label: '最高关', value: String(gameState.level) },
                { label: '本机最佳', value: String(gameState.matchBestScores.master) }
            ],
            recordNote: isNewRecord ? '新纪录！！' : ''
        });
    }

    renderSessionRecap();
    updateDisplays();
    elements.resultText.focus({ preventScroll: true });
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
    
    resetSessionRecap();
}

// 更新显示
function updateDisplays() {
    const isRecallMode = gameState.gameMode === 'colorRecall';
    elements.levelLabel.textContent = isRecallMode ? '当前轮次' : '当前关卡';
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
    elements.colorHistory.textContent = '';
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

    elements.recallControlTitle.textContent = '你的复现';
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

function getRecallDifferenceFeedback(details) {
    const lightnessDifference = Math.abs(details.lightnessDelta);
    const saturationDifference = Math.abs(details.chromaDelta);
    const lightnessDirection = details.lightnessDelta > 0 ? '偏亮' : '偏暗';
    const saturationDirection = details.chromaDelta > 0 ? '偏高' : '偏低';
    const lightnessIssue = lightnessDifference > 10
        ? `明度明显${lightnessDirection}`
        : `明度稍微${lightnessDirection}`;

    if (details.userChroma < 0.02 && details.targetChroma - details.userChroma >= 0.025) {
        if (lightnessDifference <= 7) {
            return '明度接近，但饱和度明显偏低';
        }
        return `饱和度明显偏低，同时${lightnessIssue}`;
    }

    if (details.targetChroma < 0.02 && details.userChroma - details.targetChroma >= 0.025) {
        if (lightnessDifference <= 7) {
            return '明度接近，但饱和度明显偏高';
        }
        return `饱和度明显偏高，同时${lightnessIssue}`;
    }

    if ((details.hueDifference === null || details.hueDifference <= 5)
        && saturationDifference < 2
        && lightnessDifference < 3) {
        return '色相、饱和度和明度都很接近';
    }

    const closeParts = [];
    const issueParts = [];
    if (details.hueDifference !== null) {
        if (details.hueDifference <= 12) {
            closeParts.push('色相很接近');
        } else if (details.hueDifference <= 30) {
            issueParts.push('色相稍有偏差');
        } else {
            issueParts.push('色相偏差较大');
        }
    }
    if (saturationDifference >= 4) {
        issueParts.push(`饱和度${saturationDifference > 8 ? '明显' : '稍微'}${saturationDirection}`);
    }
    if (lightnessDifference >= 4.5) {
        issueParts.push(lightnessIssue);
    }

    if (!issueParts.length) {
        return closeParts.length ? `${closeParts.join('、')}，饱和度和明度也很接近` : '饱和度和明度都很接近';
    }
    return closeParts.length
        ? `${closeParts.join('、')}，但${issueParts.join('、')}`
        : issueParts.join('、');
}

// 提交颜色复现答案
function submitRecallAnswer() {
    if (gameState.recallRoundSubmitted) return;

    const target = gameState.recallTargetRGB;
    const user = getRecallUserRGB();
    const distanceDetails = calculateRecallDistanceDetails(target, user);
    const distance = distanceDetails.distance;
    const scoreCenti = Math.round(scoreFromPerceptualDistance(distance) * 100);
    const score = scoreCenti / 100;
    const guidance = getRecallDifferenceFeedback(distanceDetails);
    addToColorHistory(`rgb(${target.r}, ${target.g}, ${target.b})`);
    
    // 累计得分
    gameState.recallTotalScoreCenti += scoreCenti;
    gameState.recallTotalScore = gameState.recallTotalScoreCenti / 100;
    gameState.recallRoundSubmitted = true;
    appendSessionRound({
        mode: 'colorRecall',
        attempt: gameState.recallRound,
        round: gameState.recallRound,
        targetHex: rgbToHex(target),
        answerHex: rgbToHex(user),
        score,
        perceptualDistance: distance,
        guidance
    });
    
    // 显示结果
    showRecallSection(elements.recallResultSection);
    
    // 显示本轮得分
    elements.recallRoundScore.textContent = score.toFixed(2);
    elements.recallRoundFeedback.textContent = `“${getRecallFeedback(score, gameState.recallRound)}”`;
    elements.recallRoundGuidance.textContent = guidance;
    
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
    const config = recallDifficultyConfig[gameState.recallDifficulty];
    
    // 检查是否是新纪录
    const previousBest = gameState.recallBestScores[gameState.recallDifficulty];
    const isNewRecord = gameState.recallTotalScore > previousBest;
    if (isNewRecord) {
        gameState.recallBestScores[gameState.recallDifficulty] = gameState.recallTotalScore;
        setStorageItem(config.storageKey, gameState.recallTotalScore.toString());
        updateBestOverviews();
    }
    
    elements.resultEyebrow.textContent = '本局完成';
    elements.resultIcon.innerHTML = iconMarkup('paint-brush');
    elements.resultText.textContent = `${config.name} · 颜色复现`;

    const totalScore = gameState.recallTotalScore;
    const bestScore = gameState.recallBestScores[gameState.recallDifficulty];
    const averageScore = totalScore / gameState.recallTotalRounds;

    let recordNote = '';
    if (isNewRecord && previousBest > 0) {
        recordNote = `新纪录！！ 提高了${(totalScore - previousBest).toFixed(2)}分`;
    } else if (isNewRecord) {
        recordNote = '首次完成，已记录为本机最佳';
    } else if (totalScore === previousBest) {
        recordNote = '追平本机最佳';
    } else {
        recordNote = `距离本机最佳还差 ${(previousBest - totalScore).toFixed(2)} 分`;
    }

    setFinalSummary({
        primaryLabel: '总分',
        primaryValue: totalScore.toFixed(2),
        primaryUnit: `/ ${gameState.recallTotalRounds * 10}`,
        stats: [
            { label: '平均得分', value: `${averageScore.toFixed(2)} / 10` },
            { label: '本机最佳', value: bestScore.toFixed(2) }
        ],
        recordNote
    });
    renderSessionRecap();
    updateDisplays();
    elements.resultText.focus({ preventScroll: true });
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
        if ((!event || event.type !== 'touchcancel') && finalPoint) applyPoint(finalPoint);
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
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initGame);
} else {
    initGame();
}


