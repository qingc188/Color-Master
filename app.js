// 游戏状态
const gameState = {
    level: 1,
    score: 0,
    bestScore: Number(localStorage.getItem('colorMemoryBestScore')) || 0,
    currentTargetColor: null,
    isGameActive: false,
    isSoundEnabled: localStorage.getItem('colorMemorySound') !== 'false',
    colorHistory: [],
    // 新模式相关状态
    gameMode: null, // 'tenLevel' 或 'endless' 或 'colorRecall'
    lives: 3, // 仅用于无尽模式
    totalLevels: 10, // 仅用于10关模式
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
    modeSelectionScreen: document.getElementById('mode-selection-screen'),
    tenLevelMode: document.getElementById('ten-level-mode'),
    endlessMode: document.getElementById('endless-mode'),
    colorRecallMode: document.getElementById('color-recall-mode'),
    recallDifficultyScreen: document.getElementById('recall-difficulty-screen'),
    recallDifficultyCards: document.querySelectorAll('[data-recall-difficulty]'),
    startScreen: document.getElementById('start-screen'),
    targetColorScreen: document.getElementById('target-color-screen'),
    colorGridScreen: document.getElementById('color-grid-screen'),
    colorRecallScreen: document.getElementById('color-recall-screen'),
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
    resultLevel: document.getElementById('result-level'),
    resultScore: document.getElementById('result-score'),
    resultTargetColor: document.getElementById('result-target-color'),
    resultSelectedColor: document.getElementById('result-selected-color'),
    colorHistory: document.getElementById('color-history'),
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

// 音效
const sounds = {
    correct: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-correct-answer-tone-2870.mp3'),
    wrong: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-wrong-answer-fail-notification-946.mp3'),
    levelUp: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-achievement-bell-600.mp3')
};

const mainScreens = [
    elements.modeSelectionScreen,
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

const recallDifficultyConfig = {
    basic: {
        name: '基础',
        controlName: 'HSL 控制',
        preview: true,
        storageKey: 'colorMemoryBestRecallScore_basic',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '6秒后目标颜色隐藏，进入复现环节',
            '使用 HSL 色轮和亮度滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '共10轮，累计得分并保存基础模式最佳纪录'
        ]
    },
    advanced: {
        name: '进阶',
        controlName: 'RGB 控制',
        preview: true,
        storageKey: 'colorMemoryBestRecallScore_advanced',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '6秒后目标颜色隐藏，进入复现环节',
            '使用 R、G、B 三个滑杆调整颜色',
            '调整时可以实时看到当前复现颜色',
            '共10轮，累计得分并保存进阶模式最佳纪录'
        ]
    },
    master: {
        name: '大师',
        controlName: 'RGB 盲调',
        preview: false,
        storageKey: 'colorMemoryBestRecallScore_master',
        rules: [
            '每轮将显示一个目标颜色，观察并记住它',
            '6秒后目标颜色隐藏，进入复现环节',
            '只使用 R、G、B 三个滑杆调整参数',
            '调整时不会显示实时颜色预览',
            '共10轮，累计得分并保存大师模式最佳纪录'
        ]
    }
};

function showScreen(screen) {
    mainScreens.forEach((item) => {
        item.classList.toggle('hidden', item !== screen);
    });
}

function showRecallSection(section) {
    recallSections.forEach((item) => {
        item.classList.toggle('hidden', item !== section);
    });
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

function undoRecallRoundSubmission() {
    if (!gameState.recallRoundSubmitted) return;

    gameState.recallTotalScore = Math.max(0, gameState.recallTotalScore - gameState.recallLastRoundScore);
    gameState.recallRoundSubmitted = false;
    gameState.recallLastRoundScore = 0;
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

// 初始化游戏
function initGame() {
    // 更新最佳分数显示
    elements.bestScoreDisplay.textContent = gameState.bestScore;
    
    // 设置HSL色轮交互
    setupHSLWheelInteraction();
    
    // 设置音效状态
    updateSoundIcon();
    
    // 绑定事件监听器
    elements.tenLevelMode.addEventListener('click', () => selectGameMode('tenLevel'));
    elements.endlessMode.addEventListener('click', () => selectGameMode('endless'));
    elements.colorRecallMode.addEventListener('click', () => showScreen(elements.recallDifficultyScreen));
    elements.recallDifficultyCards.forEach((card) => {
        card.addEventListener('click', () => selectRecallDifficulty(card.dataset.recallDifficulty));
    });
    elements.startButton.addEventListener('click', startGame);
    elements.continueButton.addEventListener('click', nextLevel);
    elements.restartButton.addEventListener('click', restartGame);
    elements.restartRecallBtn.addEventListener('click', restartCurrentRecallDifficulty);
    elements.backButtons.forEach((button) => {
        button.addEventListener('click', () => handleBackNavigation(button.dataset.backTarget));
    });
    elements.soundToggle.addEventListener('click', toggleSound);
    // 移除点击提前结束倒计时的功能，确保稳定的10秒倒计时
}

// 选择游戏模式
function selectGameMode(mode) {
    gameState.gameMode = mode;
    
    // 根据模式更新游戏规则
    if (mode === 'tenLevel') {
        elements.rulesList.innerHTML = `
            <li><i class="fa fa-circle text-xs mr-2"></i> 每关将显示一个目标颜色，观察并记住它</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 6秒后，屏幕上将出现16个不同的颜色方块</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 从这些方块中找出与目标颜色完全相同的那个</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 无论对错都会进入下一关</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 完成10关后统计正确率</li>
        `;
    } else {
        elements.rulesList.innerHTML = `
            <li><i class="fa fa-circle text-xs mr-2"></i> 每关将显示一个目标颜色，观察并记住它</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 6秒后，屏幕上将出现16个不同的颜色方块</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 从这些方块中找出与目标颜色完全相同的那个</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 选择正确进入下一关，连续得分+1</li>
            <li><i class="fa fa-circle text-xs mr-2"></i> 选择错误游戏重置，重新开始挑战</li>
        `;
    }
    
    showScreen(elements.startScreen);
}

function selectRecallDifficulty(difficulty) {
    const config = recallDifficultyConfig[difficulty];
    gameState.gameMode = 'colorRecall';
    gameState.recallDifficulty = difficulty;
    gameState.recallTotalScore = 0;
    gameState.recallRound = 1;
    elements.rulesList.innerHTML = config.rules
        .map((rule) => `<li><i class="fa fa-circle text-xs mr-2"></i> ${rule}</li>`)
        .join('');
    updateDisplays();
    showScreen(elements.startScreen);
}

function handleBackNavigation(target) {
    stopActiveCountdown();

    if (target === 'mode-selection') {
        showScreen(elements.modeSelectionScreen);
        gameState.gameMode = null;
        updateDisplays();
        return;
    }

    if (target === 'mode-selection-or-difficulty') {
        if (gameState.gameMode === 'colorRecall') {
            showScreen(elements.recallDifficultyScreen);
        } else {
            showScreen(elements.modeSelectionScreen);
            gameState.gameMode = null;
        }
        updateDisplays();
        return;
    }

    if (target === 'start') {
        showScreen(elements.startScreen);
        updateDisplays();
        return;
    }

    if (target === 'target') {
        showTargetColor();
        return;
    }

    if (target === 'recall-target') {
        showRecallSection(elements.recallTargetSection);
        runCountdown({
            counter: elements.recallCountdown,
            progressBar: elements.recallProgressBar,
            durationMs: 6000,
            onComplete: () => showRecallSection(elements.recallControlSection)
        });
        return;
    }

    if (target === 'recall-control') {
        undoRecallRoundSubmission();
        showRecallSection(elements.recallControlSection);
        return;
    }

    if (target === 'result') {
        if (gameState.gameMode === 'colorRecall') {
            restartCurrentRecallDifficulty();
            return;
        }
        showScreen(elements.startScreen);
    }
}

function restartCurrentRecallDifficulty() {
    stopActiveCountdown();
    gameState.gameMode = 'colorRecall';
    resetResultColorBlocks();
    resetRecallAttemptState();
    showScreen(elements.startScreen);
}

// 开始游戏
function startGame() {
    gameState.isGameActive = true;
    gameState.level = 1;
    gameState.score = 0;
    gameState.colorHistory = [];
    gameState.correctAnswers = 0;
    gameState.totalAnswers = 0;
    
    // 根据模式初始化状态
    if (gameState.gameMode === 'endless') {
        gameState.lives = 3;
    } else if (gameState.gameMode === 'colorRecall') {
        // 初始化颜色复现模式
        resetRecallAttemptState();
    }
    
    updateDisplays();
    clearColorHistory();
    
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
    
    // 清空颜色网格
    elements.colorGrid.innerHTML = '';
    
    // 生成16个颜色，其中一个是目标颜色
    const colors = [gameState.currentTargetColor];
    
    // 生成其他15个不同的颜色
    while (colors.length < 16) {
        const newColor = generateSimilarColor(gameState.currentTargetColor, gameState.level);
        if (!colors.includes(newColor)) {
            colors.push(newColor);
        }
    }
    
    // 随机打乱颜色顺序
    shuffleArray(colors);
    
    // 创建颜色方块
    colors.forEach((color, index) => {
        const colorBlock = document.createElement('div');
        colorBlock.className = 'color-card w-full aspect-square rounded-xl shadow-lg cursor-pointer transition-all transform hover:scale-105 hover:shadow-xl animate-scale-in';
        colorBlock.style.backgroundColor = color;
        colorBlock.style.animationDelay = `${index * 0.05}s`;
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
    
    // 记录选择的颜色到历史
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
    
    // 判断选择是否正确
    if (selectedColor === gameState.currentTargetColor) {
        // 选择正确
        playSound('correct');
        gameState.score++;
        gameState.correctAnswers++;
        
        elements.resultIcon.className = 'text-6xl mb-4 text-success';
        elements.resultIcon.innerHTML = '<i class="fa fa-check-circle"></i>';
        elements.resultText.textContent = '太棒了！';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-success';
        
        // 更新最佳分数
        if (gameState.score > gameState.bestScore) {
            gameState.bestScore = gameState.score;
            localStorage.setItem('colorMemoryBestScore', gameState.bestScore);
            elements.bestScoreDisplay.textContent = gameState.bestScore;
        }
        
        // 如果得分是5的倍数，播放升级音效
        if (gameState.score % 5 === 0) {
            playSound('levelUp');
        }
    } else {
        // 选择错误
        playSound('wrong');
        
        elements.resultIcon.className = 'text-6xl mb-4 text-danger';
        elements.resultIcon.innerHTML = '<i class="fa fa-times-circle"></i>';
        elements.resultText.textContent = '再接再厉！';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-danger';
        
        // 添加抖动动画
        elements.resultSelectedColor.classList.add('animate-shake');
        
        // 处理无尽模式的生命值
        if (gameState.gameMode === 'endless') {
            gameState.lives--;
            
            // 检查是否游戏结束
            if (gameState.lives <= 0) {
                showGameEnd();
                return;
            }
        } else {
            // 传统模式，答错重置
            if (gameState.gameMode !== 'tenLevel') {
                gameState.level = 1;
                gameState.score = 0;
                gameState.correctAnswers = 0;
                gameState.totalAnswers = 0;
            }
        }
    }
    
    // 挑战模式无论对错都进入下一关
    if (gameState.gameMode === 'tenLevel') {
        // 检查是否达到挑战模式的结束条件
        if (gameState.level >= gameState.totalLevels) {
            // 挑战模式结束
            showGameEnd();
            return;
        }
        gameState.level++;
    } else if (gameState.gameMode === 'endless' && selectedColor === gameState.currentTargetColor) {
        // 无尽模式只有做对才进入下一关
        gameState.level++;
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
    showScreen(elements.resultScreen);
    resetResultColorBlocks();
    elements.resultDetail.classList.add('hidden');
    elements.resultDetail.innerHTML = '';
    
    // 根据游戏模式显示不同的结束信息
    if (gameState.gameMode === 'tenLevel') {
        // 挑战模式结束
        const accuracy = gameState.totalAnswers > 0
            ? Math.round((gameState.correctAnswers / gameState.totalAnswers) * 100)
            : 0;
        
        elements.resultIcon.className = 'text-6xl mb-4 text-primary';
        elements.resultIcon.innerHTML = '<i class="fa fa-trophy"></i>';
        elements.resultText.textContent = '挑战完成！';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-primary';
        
        elements.resultDetail.innerHTML = `
            <p class="text-xl font-semibold mb-2">正确率: <span class="text-success">${accuracy}%</span></p>
            <div class="w-full bg-gray-700 rounded-full h-2.5">
                <div class="bg-success h-2.5 rounded-full" style="width: ${accuracy}%"></div>
            </div>
            <p class="text-sm text-gray-400 mt-2">答对: ${gameState.correctAnswers} / 总题数: ${gameState.totalAnswers}</p>
        `;
        elements.resultDetail.classList.remove('hidden');
    } else if (gameState.gameMode === 'endless') {
        // 无尽模式结束
        elements.resultIcon.className = 'text-6xl mb-4 text-secondary';
        elements.resultIcon.innerHTML = '<i class="fa fa-star"></i>';
        elements.resultText.textContent = '游戏结束！';
        elements.resultText.className = 'text-3xl font-bold mb-6 text-secondary';
        
        elements.resultDetail.innerHTML = `
            <p class="text-xl font-semibold mb-2">最高关卡: <span class="text-secondary">${gameState.level}</span></p>
            <p class="text-sm text-gray-400">你坚持到了第 ${gameState.level} 关！</p>
        `;
        elements.resultDetail.classList.remove('hidden');
    }
    
    // 更新结果显示
    elements.resultLevel.textContent = gameState.level;
    elements.resultScore.textContent = gameState.score;
    
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
    elements.scoreLabel.textContent = '连续得分';
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
    } else {
        elements.scoreLabel.textContent = '连续得分';
        elements.bestScoreLabel.textContent = '最佳记录';
        elements.scoreDisplay.textContent = gameState.score;
        elements.bestScoreDisplay.textContent = gameState.bestScore;
    }
    
    // 根据游戏模式显示或隐藏生命值
    if (gameState.gameMode === 'endless') {
        elements.livesDisplay.classList.remove('hidden');
        elements.lives.textContent = gameState.lives;
    } else {
        elements.livesDisplay.classList.add('hidden');
    }
}

// 添加颜色到历史记录
function addToColorHistory(color) {
    // 保存当前关卡信息
    gameState.colorHistory.push({
        color: color,
        level: gameState.level
    });
    
    // 最多显示10个历史颜色
    if (gameState.colorHistory.length > 10) {
        gameState.colorHistory.shift();
    }
    
    updateColorHistoryDisplay();
}

// 更新颜色历史显示
function updateColorHistoryDisplay() {
    elements.colorHistory.innerHTML = '';
    
    gameState.colorHistory.forEach((item, index) => {
        const colorBlock = document.createElement('div');
        colorBlock.className = 'w-8 h-8 rounded-full shadow-md cursor-pointer transition-transform hover:scale-110';
        colorBlock.style.backgroundColor = item.color;
        const level = item.level;
        const hexCode = rgbToHex(item.color);
        colorBlock.title = `关卡 ${level}: ${hexCode}`;
        
        // 点击显示颜色代码
        colorBlock.addEventListener('click', () => {
            showColorCodeTooltip(colorBlock, hexCode, level);
        });
        
        elements.colorHistory.appendChild(colorBlock);
    });
}

// 显示颜色代码提示
function showColorCodeTooltip(element, hexCode, level) {
    // 检查是否已存在提示框
    let tooltip = document.getElementById('color-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
    
    // 创建新的提示框
    tooltip = document.createElement('div');
    tooltip.id = 'color-tooltip';
    tooltip.className = 'absolute z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 animate-fade-in';
    tooltip.style.left = `${element.getBoundingClientRect().left + window.scrollX - 50}px`;
    tooltip.style.top = `${element.getBoundingClientRect().top + window.scrollY - 80}px`;
    
    // 提示框内容
    tooltip.innerHTML = `
        <div class="flex items-center space-x-3">
            <div class="w-6 h-6 rounded-full" style="background-color: ${element.style.backgroundColor}"></div>
            <div>
                <p class="text-xs text-gray-400">关卡 ${level}</p>
                <p class="font-mono text-sm">${hexCode}</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(tooltip);
    
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
    }
    
    elements.resultIcon.className = 'text-6xl mb-4 text-primary';
    elements.resultIcon.innerHTML = '<i class="fa fa-palette"></i>';
    elements.resultText.textContent = `${config.name}颜色复现完成！`;
    elements.resultText.className = 'text-3xl font-bold mb-6 text-primary';
    
    elements.resultLevel.textContent = gameState.recallTotalRounds;
    elements.resultScore.textContent = gameState.recallTotalScore.toFixed(2);
    
    elements.resultTargetColor.style.backgroundColor = 'transparent';
    elements.resultTargetColor.style.border = '2px solid #6366f1';
    elements.resultTargetColor.classList.add('flex', 'flex-col', 'items-center', 'justify-center');
    elements.resultTargetColor.innerHTML = `<p class="text-sm">累计得分</p><p class="text-2xl font-bold text-primary">${gameState.recallTotalScore.toFixed(2)}</p>`;
    document.getElementById('target-color-code').textContent = '';
    
    elements.resultSelectedColor.style.backgroundColor = 'transparent';
    elements.resultSelectedColor.style.border = '2px solid #10b981';
    elements.resultSelectedColor.classList.add('flex', 'flex-col', 'items-center', 'justify-center');
    elements.resultSelectedColor.innerHTML = `<p class="text-sm">${isNewRecord ? '🎉 新纪录！' : `${config.name}最佳`}</p><p class="text-2xl font-bold text-success">${gameState.recallBestScores[gameState.recallDifficulty].toFixed(2)}</p>`;
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

// 清空颜色历史
function clearColorHistory() {
    gameState.colorHistory = [];
    elements.colorHistory.innerHTML = '';
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
}

// 播放音效
function playSound(soundName) {
    if (gameState.isSoundEnabled && sounds[soundName]) {
        sounds[soundName].currentTime = 0;
        sounds[soundName].play().catch(e => console.log('Error playing sound:', e));
    }
}

// 初始化游戏
window.addEventListener('DOMContentLoaded', initGame);


