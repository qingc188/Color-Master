// 游戏状态
const COLOR_HISTORY_STORAGE_KEY = 'colorMemoryGlobalColorHistory';
const MAX_COLOR_HISTORY = 50;

const gameState = {
    level: 1,
    score: 0,
    currentTargetColor: null,
    isGameActive: false,
    isSoundEnabled: localStorage.getItem('colorMemorySound') !== 'false',
    colorHistory: loadColorHistory(),
    // 新模式相关状态
    gameMode: null, // 'colorMatch' 或 'colorRecall'
    matchDifficulty: 'basic',
    matchBestScores: {
        basic: Number(localStorage.getItem('colorMemoryBestMatchScore_basic')) || 0,
        advanced: Number(localStorage.getItem('colorMemoryBestMatchScore_advanced')) || 0,
        master: Number(localStorage.getItem('colorMemoryBestMatchScore_master') ?? localStorage.getItem('colorMemoryBestScore')) || 0
    },
    lives: 3, // 仅用于颜色匹配大师模式
    totalLevels: 10, // 仅用于固定关卡的颜色匹配模式
    correctAnswers: 0, // 用于计算正确率
    totalAnswers: 0, // 用于计算正确率
    // 颜色复现模式专用
    recallDifficulty: 'basic',
    recallTotalScore: 0, // 累计得分
    recallBestScores: {
        basic: Number(localStorage.getItem('colorMemoryBestRecallScore_basic') ?? localStorage.getItem('colorMemoryBestRecallScore')) || 0,
        advanced: Number(localStorage.getItem('colorMemoryBestRecallScore_advanced')) || 0,
        master: Number(localStorage.getItem('colorMemoryBestRecallScore_master')) || 0
    },
    recallTargetHSL: null, // 目标HSL颜色
    recallTargetRGB: null,
    recallUserHSL: { h: 0, s: 100, l: 50 }, // 用户当前HSL颜色
    recallUserRGB: { r: 128, g: 128, b: 128 },
    recallRound: 1, // 当前轮次
    recallRoundSubmitted: false,
    recallLastRoundScore: 0,
    recallTotalRounds: 10 // 总轮次
};

// DOM 元素
const elements = {
    brandHeader: document.getElementById('brand-header'),
    landingScreen: document.getElementById('landing-screen'),
    enterGameButton: document.getElementById('enter-game-button'),
    supportingContent: document.getElementById('supporting-content'),
    modeSelectionScreen: document.getElementById('mode-selection-screen'),
    colorMatchMode: document.getElementById('color-match-mode'),
    matchDifficultyScreen: document.getElementById('match-difficulty-screen'),
    matchDifficultyCards: document.querySelectorAll('[data-match-difficulty]'),
    colorRecallMode: document.getElementById('color-recall-mode'),
    recallDifficultyScreen: document.getElementById('recall-difficulty-screen'),
    recallDifficultyCards: document.querySelectorAll('[data-recall-difficulty]'),
    startScreen: document.getElementById('start-screen'),
    targetColorScreen: document.getElementById('target-color-screen'),
    colorGridScreen: document.getElementById('color-grid-screen'),
    colorRecallScreen: document.getElementById('color-recall-screen'),
    gameInfoBar: document.getElementById('game-info-bar'),
    gameStatsPanel: document.getElementById('game-stats-panel'),
    modeBestOverview: document.getElementById('mode-best-overview'),
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
    masterPreviewNote: document.getElementById('master-preview-note'),
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
    resultLevelLabel: document.getElementById('result-level-label'),
    resultLevel: document.getElementById('result-level'),
    resultScore: document.getElementById('result-score'),
    resultTargetColor: document.getElementById('result-target-color'),
    resultSelectedColor: document.getElementById('result-selected-color'),
    colorHistory: document.getElementById('color-history'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    soundToggle: document.getElementById('sound-toggle'),
    soundIcon: document.getElementById('sound-icon'),
    // 颜色复现模式元素
    recallCountdown: document.getElementById('recall-countdown'),
    recallProgressBar: document.getElementById('recall-progress-bar'),
    recallTargetColor: document.getElementById('recall-target-color'),
    recallUserColor: document.getElementById('recall-user-color'),
    recallUserCodeDisplay: document.getElementById('recall-user-code-display'),
    hslWheel: document.getElementById('hsl-wheel'),
    hslWheelPointer: document.getElementById('hsl-wheel-pointer'),
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
    recallResultTarget: document.getElementById('recall-result-target'),
    recallResultUser: document.getElementById('recall-result-user'),
    recallTargetCode: document.getElementById('recall-target-code'),
    recallUserCode: document.getElementById('recall-user-code')
};

const soundPatterns = {
    correct: [660, 880],
    wrong: [220, 165],
    levelUp: [523, 659, 784]
};

const mainScreens = [
    elements.landingScreen,
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
let audioContext;

const matchDifficultyConfig = {
    basic: {
        name: '基础',
        gridSize: 3,
        totalLevels: 10,
        endless: false,
        storageKey: 'colorMemoryBestMatchScore_basic',
        rules: [
            '每关将显示一个目标颜色，观察并记住它',
            '6 秒后，屏幕上将出现 3×3 共 9 个颜色方块',
            '从这些方块中找出与目标颜色完全相同的那个',
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
            '6 秒后，屏幕上将出现 4×4 共 16 个颜色方块',
            '从更多干扰色中找出与目标颜色完全相同的那个',
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
            '6 秒后，屏幕上将出现 4×4 共 16 个颜色方块',
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
        storageKey: 'colorMemoryBestRecallScore_basic',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '6 秒后目标颜色隐藏，进入复现环节',
            '使用 HSL 色轮和明度滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '每轮满分 10 分，共 10 轮；按总分保存基础模式最佳纪录'
        ]
    },
    advanced: {
        name: '进阶',
        controlName: 'RGB 控制',
        preview: true,
        storageKey: 'colorMemoryBestRecallScore_advanced',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '6 秒后目标颜色隐藏，进入复现环节',
            '使用 R、G、B 三个滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '每轮满分 10 分，共 10 轮；按总分保存进阶模式最佳纪录'
        ]
    },
    master: {
        name: '大师',
        controlName: 'RGB 盲调',
        preview: false,
        storageKey: 'colorMemoryBestRecallScore_master',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '6 秒后目标颜色隐藏，进入复现环节',
            '只使用 R、G、B 三个滑杆调整参数',
            '调整时不会显示实时颜色预览',
            '每轮满分 10 分，共 10 轮；按总分保存大师模式最佳纪录'
        ]
    }
};

function showScreen(screen) {
    mainScreens.forEach((item) => {
        item.classList.toggle('hidden', item !== screen);
    });
    updateBrandState(screen);
    updateStatsVisibility(screen);
    updateSupportingVisibility(screen);
    window.scrollTo(0, 0);
}

function updateBrandState(screen) {
    const isActiveGameScreen = screen === elements.targetColorScreen
        || screen === elements.colorGridScreen
        || screen === elements.colorRecallScreen;
    elements.brandHeader.classList.toggle('hidden', screen === elements.landingScreen || isActiveGameScreen);
}

function updateSupportingVisibility(screen) {
    const isFinalResult = screen === elements.resultScreen && !gameState.isGameActive;
    const shouldShow = screen === elements.landingScreen
        || screen === elements.modeSelectionScreen
        || isFinalResult;
    elements.supportingContent.classList.toggle('hidden', !shouldShow);
}

function showRecallSection(section) {
    recallSections.forEach((item) => {
        item.classList.toggle('hidden', item !== section);
    });
    requestAnimationFrame(() => section.scrollIntoView({ block: 'start' }));
}

function stopActiveCountdown() {
    activeCountdownId++;
}

function resetRecallAttemptState() {
    gameState.recallTotalScore = 0;
    gameState.recallRound = 1;
    gameState.recallRoundSubmitted = false;
    gameState.recallLastRoundScore = 0;
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
    elements.resultSelectedColor.classList.remove('animate-shake');
    elements.resultSelectedColor.classList.remove('flex', 'flex-col', 'items-center', 'justify-center');
    elements.resultSelectedColor.innerHTML = '';
}

function loadColorHistory() {
    try {
        const savedHistory = JSON.parse(localStorage.getItem(COLOR_HISTORY_STORAGE_KEY) || '[]');
        return Array.isArray(savedHistory) ? savedHistory.slice(-MAX_COLOR_HISTORY) : [];
    } catch {
        return [];
    }
}

function saveColorHistory() {
    localStorage.setItem(COLOR_HISTORY_STORAGE_KEY, JSON.stringify(gameState.colorHistory));
}

function updateStatsVisibility(screen) {
    const isMainMenu = screen === elements.landingScreen
        || screen === elements.modeSelectionScreen;
    const isDifficultyScreen = screen === elements.matchDifficultyScreen
        || screen === elements.recallDifficultyScreen;

    elements.gameInfoBar.classList.toggle('hidden', isMainMenu);
    elements.gameStatsPanel.classList.toggle('hidden', isMainMenu || isDifficultyScreen);
    elements.modeBestOverview.classList.toggle('hidden', !isDifficultyScreen);
    elements.gameInfoBar.style.gridTemplateColumns = '1fr auto';
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

    function update(now) {
        if (countdownId !== activeCountdownId) return;

        const elapsed = now - startTime;
        const remaining = Math.max(0, durationMs - elapsed);
        const secondsLeft = Math.ceil(remaining / 1000);

        counter.textContent = secondsLeft;
        progressBar.style.width = `${(remaining / durationMs) * 100}%`;

        if (remaining > 0) {
            requestAnimationFrame(update);
            return;
        }

        onComplete();
    }

    counter.textContent = Math.ceil(durationMs / 1000);
    progressBar.style.width = '100%';
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
    // 更新最佳分数显示
    updateBrandState(elements.landingScreen);
    updateStatsVisibility(elements.landingScreen);
    updateSupportingVisibility(elements.landingScreen);
    updateBestOverviews();
    updateDisplays();
    updateColorHistoryDisplay();
    
    // 设置HSL色轮交互
    setupHSLWheelInteraction();
    
    // 设置音效状态
    updateSoundIcon();
    
    // 绑定事件监听器
    elements.enterGameButton.addEventListener('click', () => showScreen(elements.modeSelectionScreen));
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
    elements.clearHistoryBtn.addEventListener('click', clearGlobalColorHistory);
    elements.soundToggle.addEventListener('click', toggleSound);
    // 倒计时期间不允许点击跳过，确保每轮观察时间一致。
}

function renderRules(rules) {
    elements.rulesList.innerHTML = rules
        .map((rule) => `<li><i class="fa fa-circle text-xs mr-2"></i> ${rule}</li>`)
        .join('');
}

function showDifficultyScreen(screen, type = gameState.gameMode) {
    updateBestOverviews(type);
    showScreen(screen);
}

function selectMatchDifficulty(difficulty) {
    const config = matchDifficultyConfig[difficulty];
    gameState.gameMode = 'colorMatch';
    gameState.matchDifficulty = difficulty;
    gameState.totalLevels = config.totalLevels;
    renderRules(config.rules);
    updateDisplays();
    showScreen(elements.startScreen);
}

function selectRecallDifficulty(difficulty) {
    const config = recallDifficultyConfig[difficulty];
    gameState.gameMode = 'colorRecall';
    gameState.recallDifficulty = difficulty;
    gameState.recallTotalScore = 0;
    gameState.recallRound = 1;
    renderRules(config.rules);
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
        gameState.gameMode = null;
        showScreen(elements.landingScreen);
        updateDisplays();
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

function handleRestartButton() {
    if (gameState.gameMode === 'colorRecall') {
        restartCurrentRecallDifficulty();
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
    
    // 生成目标颜色
    gameState.currentTargetColor = generateColor(gameState.level);
    
    // 设置目标颜色显示
    elements.targetColor.style.backgroundColor = gameState.currentTargetColor;
    
    runCountdown({
        counter: elements.countdown,
        progressBar: elements.progressBar,
        durationMs: 6000,
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
    
    // 生成颜色，其中一个是目标颜色
    const colors = [gameState.currentTargetColor];
    
    // 生成其他不同的颜色
    while (colors.length < gridTotal) {
        const newColor = generateSimilarColor(gameState.currentTargetColor, gameState.level);
        if (!colors.includes(newColor)) {
            colors.push(newColor);
        }
    }
    
    // 随机打乱颜色顺序
    shuffleArray(colors);

    // 创建颜色方块
    colors.forEach((color, index) => {
        const colorBlock = document.createElement('button');
        colorBlock.type = 'button';
        colorBlock.className = 'color-card w-full aspect-square rounded-xl shadow-lg cursor-pointer transition-all transform hover:scale-105 hover:shadow-xl animate-scale-in';
        colorBlock.style.backgroundColor = color;
        colorBlock.style.animationDelay = `${index * 0.05}s`;
        colorBlock.setAttribute('aria-label', `颜色选项 ${index + 1}`);
        colorBlock.addEventListener('click', () => checkColorSelection(color));
        elements.colorGrid.appendChild(colorBlock);
    });
}

// 检查颜色选择
function checkColorSelection(selectedColor) {
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
    const isCorrect = selectedColor === gameState.currentTargetColor;
    const config = matchDifficultyConfig[gameState.matchDifficulty];
    
    // 判断选择是否正确
    if (isCorrect) {
        // 选择正确
        playSound('correct');
        gameState.score++;
        gameState.correctAnswers++;
        
        elements.resultIcon.className = 'text-6xl mb-4 text-success';
        elements.resultIcon.innerHTML = '<i class="fa fa-check-circle"></i>';
        elements.resultText.textContent = '回答正确';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-success';
        
        // 如果得分是5的倍数，播放升级音效
        if (gameState.score % 5 === 0) {
            playSound('levelUp');
        }
    } else {
        // 选择错误
        playSound('wrong');
        
        elements.resultIcon.className = 'text-6xl mb-4 text-danger';
        elements.resultIcon.innerHTML = '<i class="fa fa-times-circle"></i>';
        elements.resultText.textContent = '没有选中目标色';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-danger';
        
        // 添加抖动动画
        elements.resultSelectedColor.classList.add('animate-shake');
        
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
    showScreen(elements.resultScreen);
    elements.resultDetail.classList.add('hidden');
    elements.resultDetail.innerHTML = '';
    const config = matchDifficultyConfig[gameState.matchDifficulty];
    const isNewRecord = gameState.score > gameState.matchBestScores[gameState.matchDifficulty];
    if (isNewRecord) {
        gameState.matchBestScores[gameState.matchDifficulty] = gameState.score;
        localStorage.setItem(config.storageKey, gameState.score.toString());
        updateBestOverviews();
    }
    
    // 根据游戏模式显示不同的结束信息
    if (!config.endless) {
        // 固定关卡匹配模式结束
        const accuracy = gameState.totalAnswers > 0
            ? Math.round((gameState.correctAnswers / gameState.totalAnswers) * 100)
            : 0;
        
        elements.resultIcon.className = 'text-6xl mb-4 text-primary';
        elements.resultIcon.innerHTML = '<i class="fa fa-trophy"></i>';
        elements.resultText.textContent = `${config.name}颜色匹配完成！`;
        elements.resultText.className = 'text-3xl font-bold mb-6 text-primary';
        
        elements.resultDetail.innerHTML = `
            <p class="text-xl font-semibold mb-2">正确率: <span class="text-success">${accuracy}%</span></p>
            <div class="w-full bg-gray-700 rounded-full h-2.5">
                <div class="bg-success h-2.5 rounded-full" style="width: ${accuracy}%"></div>
            </div>
            <p class="text-sm text-gray-400 mt-2">答对: ${gameState.correctAnswers} / 总题数: ${gameState.totalAnswers}</p>
            <p class="text-sm text-gray-400 mt-1">${isNewRecord ? '新纪录！' : `${config.name}最佳：${gameState.matchBestScores[gameState.matchDifficulty]}`}</p>
        `;
        elements.resultDetail.classList.remove('hidden');
    } else {
        // 大师无尽模式结束
        elements.resultIcon.className = 'text-6xl mb-4 text-secondary';
        elements.resultIcon.innerHTML = '<i class="fa fa-star"></i>';
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
    
    // 最多显示50个历史颜色，满了按遇到顺序替换最旧的颜色。
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
    elements.colorHistory.innerHTML = '';
    
    gameState.colorHistory.forEach((item, index) => {
        const colorBlock = document.createElement('button');
        colorBlock.type = 'button';
        colorBlock.className = 'history-color w-11 h-11 rounded-full shadow-md cursor-pointer transition-transform hover:scale-110';
        colorBlock.style.backgroundColor = item.color;
        colorBlock.title = `${item.hex} · ${item.context || '历史颜色'}`;
        colorBlock.setAttribute('aria-label', `查看历史颜色 ${index + 1}：${item.hex}`);
        
        // 点击显示颜色代码
        colorBlock.addEventListener('click', () => {
            showColorCodeTooltip(colorBlock, item);
        });
        
        elements.colorHistory.appendChild(colorBlock);
    });
}

// 显示颜色代码提示
function showColorCodeTooltip(element, item) {
    // 检查是否已存在提示框
    let tooltip = document.getElementById('color-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
    
    // 创建新的提示框
    tooltip = document.createElement('div');
    tooltip.id = 'color-tooltip';
    tooltip.className = 'fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 animate-fade-in';
    
    // 提示框内容
    tooltip.innerHTML = `
        <div class="flex items-center space-x-3">
            <div class="w-6 h-6 rounded-full" style="background-color: ${element.style.backgroundColor}"></div>
            <div>
                <p class="text-xs text-gray-400">${item.context || '历史颜色'}</p>
                <p class="font-mono text-sm">${item.hex}</p>
                <p class="font-mono text-xs text-gray-300">${item.rgbText}</p>
                <p class="font-mono text-xs text-gray-300">${item.hslText}</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(tooltip);
    const elementRect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const centeredLeft = elementRect.left + (elementRect.width - tooltipRect.width) / 2;
    const maxLeft = Math.max(8, window.innerWidth - tooltipRect.width - 8);
    const left = Math.min(Math.max(8, centeredLeft), maxLeft);
    const preferredTop = elementRect.top - tooltipRect.height - 8;
    const top = preferredTop >= 8 ? preferredTop : elementRect.bottom + 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    
    // 点击其他地方关闭提示框
    setTimeout(() => {
        document.addEventListener('click', function closeTooltip(e) {
            if (!tooltip.contains(e.target) && e.target !== element) {
                tooltip.remove();
                document.removeEventListener('click', closeTooltip);
            }
        });
    }, 100);
}

// ============ 颜色复现模式函数 ============

// 开始一轮颜色复现
function startColorRecallRound() {
    gameState.recallRoundSubmitted = false;
    gameState.recallLastRoundScore = 0;
    elements.nextRecallBtn.textContent = '下一轮';
    updateDisplays();
    configureRecallControlPanel();

    // 生成随机目标颜色
    const targetColor = generateColor(gameState.recallRound);
    const [, h, s, l] = targetColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/).map(Number);
    gameState.recallTargetHSL = { h, s, l };
    gameState.recallTargetRGB = hslToRgb(h, s, l);
    
    // 设置目标颜色显示
    elements.recallTargetColor.style.backgroundColor = targetColor;
    
    // 显示目标区域，隐藏控制和结果区域
    showScreen(elements.colorRecallScreen);
    showRecallSection(elements.recallTargetSection);
    
    // 重置用户颜色
    gameState.recallUserHSL = { h: 0, s: 100, l: 50 };
    gameState.recallUserRGB = { r: 128, g: 128, b: 128 };
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
        durationMs: 6000,
        onComplete: () => showRecallSection(elements.recallControlSection)
    });
}

// 更新HSL色轮指针位置
function updateHSLPointerPosition() {
    const wheel = elements.hslWheel;
    const rect = wheel.getBoundingClientRect();
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
    elements.masterPreviewNote.classList.toggle('hidden', config.preview);
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

    elements.lightnessValue.textContent = `${l}%`;
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

// 提交颜色复现答案
function submitRecallAnswer() {
    if (gameState.recallRoundSubmitted) return;

    const target = gameState.recallTargetRGB;
    const user = getRecallUserRGB();
    const score = parseFloat(calculateRgbSimilarity(target, user));
    addToColorHistory(`rgb(${target.r}, ${target.g}, ${target.b})`);
    
    // 累计得分
    gameState.recallTotalScore += score;
    gameState.recallRoundSubmitted = true;
    gameState.recallLastRoundScore = score;
    
    // 显示结果
    showRecallSection(elements.recallResultSection);
    
    // 显示本轮得分
    elements.recallRoundScore.textContent = score.toFixed(2);
    
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
    
    // 播放音效
    playSound('correct');
}

// 下一轮或结束
function nextRecallRoundOrEnd() {
    gameState.recallRound++;
    
    if (gameState.recallRound > gameState.recallTotalRounds) {
        // 游戏结束
        showColorRecallResult();
    } else {
        // 下一轮
        elements.nextRecallBtn.textContent = '下一轮';
        startColorRecallRound();
    }
}

// 显示颜色复现游戏结果
function showColorRecallResult() {
    gameState.isGameActive = false;
    showScreen(elements.resultScreen);
    resetResultColorBlocks();
    elements.resultDetail.innerHTML = '';
    elements.resultDetail.classList.add('hidden');
    const config = recallDifficultyConfig[gameState.recallDifficulty];
    
    // 检查是否是新纪录
    const isNewRecord = gameState.recallTotalScore > gameState.recallBestScores[gameState.recallDifficulty];
    if (isNewRecord) {
        gameState.recallBestScores[gameState.recallDifficulty] = gameState.recallTotalScore;
        localStorage.setItem(config.storageKey, gameState.recallTotalScore.toString());
        updateBestOverviews();
    }
    
    elements.resultIcon.className = 'text-6xl mb-4 text-primary';
    elements.resultIcon.innerHTML = '<i class="fa fa-palette"></i>';
    elements.resultText.textContent = `${config.name}颜色复现完成！`;
    elements.resultText.className = 'text-3xl font-bold mb-6 text-primary';
    
    elements.resultLevel.textContent = gameState.recallTotalRounds;
    elements.resultLevelLabel.textContent = '完成轮数';
    elements.resultScore.textContent = gameState.recallTotalScore.toFixed(2);
    
    elements.resultTargetColor.style.backgroundColor = 'transparent';
    elements.resultTargetColor.style.border = '2px solid #5ec8c2';
    elements.resultTargetColor.classList.add('flex', 'flex-col', 'items-center', 'justify-center');
    elements.resultTargetColor.innerHTML = `<p class="text-sm">累计得分</p><p class="text-2xl font-bold text-primary">${gameState.recallTotalScore.toFixed(2)}</p>`;
    document.getElementById('target-color-code').textContent = '';
    
    elements.resultSelectedColor.style.backgroundColor = 'transparent';
    elements.resultSelectedColor.style.border = '2px solid #f36f63';
    elements.resultSelectedColor.classList.add('flex', 'flex-col', 'items-center', 'justify-center');
    elements.resultSelectedColor.innerHTML = `<p class="text-sm">${isNewRecord ? '新纪录' : `${config.name}最佳`}</p><p class="text-2xl font-bold text-success">${gameState.recallBestScores[gameState.recallDifficulty].toFixed(2)}</p>`;
    document.getElementById('selected-color-code').textContent = '';
    
    elements.continueButton.classList.add('hidden');
}

// 设置HSL色轮交互
function setupHSLWheelInteraction() {
    let isDragging = false;
    
    const handleMove = (e) => {
        if (!isDragging && e.type === 'click') return;
        if (e.cancelable) e.preventDefault();
        
        const rect = elements.hslWheel.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
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
        
        updateHSLPointerPosition();
        updateRecallUserColor();
    };
    
    elements.hslWheel.addEventListener('mousedown', (e) => {
        isDragging = true;
        handleMove(e);
    });
    
    elements.hslWheel.addEventListener('click', handleMove);
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) handleMove(e);
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    // 触摸支持
    elements.hslWheel.addEventListener('touchstart', (e) => {
        isDragging = true;
        handleMove(e);
    }, { passive: false });
    
    elements.hslWheel.addEventListener('touchmove', (e) => {
        if (isDragging) handleMove(e);
    }, { passive: false });
    
    elements.hslWheel.addEventListener('touchend', () => {
        isDragging = false;
    });
    elements.hslWheel.addEventListener('touchcancel', () => {
        isDragging = false;
    });
    
    // 亮度滑块
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

function clearGlobalColorHistory() {
    gameState.colorHistory = [];
    localStorage.removeItem(COLOR_HISTORY_STORAGE_KEY);
    updateColorHistoryDisplay();
    const tooltip = document.getElementById('color-tooltip');
    if (tooltip) tooltip.remove();
}

// 切换音效
function toggleSound() {
    gameState.isSoundEnabled = !gameState.isSoundEnabled;
    localStorage.setItem('colorMemorySound', gameState.isSoundEnabled);
    updateSoundIcon();
}

// 更新音效图标
function updateSoundIcon() {
    elements.soundIcon.className = gameState.isSoundEnabled ? 'fa fa-volume-up text-xl' : 'fa fa-volume-off text-xl';
    elements.soundToggle.setAttribute('aria-label', gameState.isSoundEnabled ? '关闭音效' : '开启音效');
}

// 播放音效
function playSound(soundName) {
    const notes = soundPatterns[soundName];
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!gameState.isSoundEnabled || !notes || !AudioContext) return;

    if (!audioContext) audioContext = new AudioContext();

    const playNotes = () => {
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
    };

    if (audioContext.state === 'suspended') {
        audioContext.resume().then(playNotes).catch(() => {});
    } else {
        playNotes();
    }
}

// 初始化游戏
window.addEventListener('DOMContentLoaded', initGame);


