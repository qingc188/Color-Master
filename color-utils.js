// 颜色生成、转换和评分工具
const OKLAB_SCORE_ANCHORS = Object.freeze([
    { distance: 0, score: 10 },
    { distance: 2, score: 9.8 },
    { distance: 5, score: 9.3 },
    { distance: 10, score: 8.2 },
    { distance: 20, score: 6.5 },
    { distance: 40, score: 3.5 },
    { distance: 70, score: 0.8 },
    { distance: 100, score: 0 }
]);
const RECALL_NEUTRAL_CHROMA_THRESHOLD = 0.04;
const RECALL_NEUTRAL_PENALTY_WEIGHT = 1.6;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function rgbToCss({ r, g, b }) {
    return `rgb(${r}, ${g}, ${b})`;
}

// HSL 转 8 位 sRGB
function hslToRgb(h, s, l) {
    h = ((Number(h) % 360) + 360) % 360 / 360;
    s = clamp(Number(s), 0, 100) / 100;
    l = clamp(Number(l), 0, 100) / 100;

    let r;
    let g;
    let b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

function rgbToHsl({ r, g, b }) {
    r = clamp(Number(r), 0, 255) / 255;
    g = clamp(Number(g), 0, 255) / 255;
    b = clamp(Number(b), 0, 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;

    if (max !== min) {
        const delta = max - min;
        saturation = lightness > 0.5
            ? delta / (2 - max - min)
            : delta / (max + min);
        if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
        if (max === g) hue = (b - r) / delta + 2;
        if (max === b) hue = (r - g) / delta + 4;
        hue /= 6;
    }

    return {
        h: Math.round(hue * 360) % 360,
        s: Math.round(saturation * 100),
        l: Math.round(lightness * 100)
    };
}

function parseColorToRgb(color) {
    if (color && typeof color === 'object') {
        const channels = [color.r, color.g, color.b].map(Number);
        if (channels.every(Number.isFinite)) {
            return {
                r: Math.round(clamp(channels[0], 0, 255)),
                g: Math.round(clamp(channels[1], 0, 255)),
                b: Math.round(clamp(channels[2], 0, 255))
            };
        }
    }

    if (typeof color !== 'string') return null;

    const hslMatch = color.match(/^hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
    if (hslMatch) {
        return hslToRgb(Number(hslMatch[1]), Number(hslMatch[2]), Number(hslMatch[3]));
    }

    const rgbMatch = color.match(/^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
    if (rgbMatch) {
        return parseColorToRgb({
            r: Number(rgbMatch[1]),
            g: Number(rgbMatch[2]),
            b: Number(rgbMatch[3])
        });
    }

    const hexMatch = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!hexMatch) return null;
    const value = hexMatch[1].length === 3
        ? [...hexMatch[1]].map((digit) => digit + digit).join('')
        : hexMatch[1];
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
    };
}

function rgbToHex(color) {
    const rgb = parseColorToRgb(color);
    if (!rgb) return color;
    return `#${[rgb.r, rgb.g, rgb.b]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')}`.toUpperCase();
}

function srgbByteToLinear(channel) {
    const normalized = clamp(Number(channel), 0, 255) / 255;
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(channel) {
    const normalized = channel <= 0.0031308
        ? 12.92 * channel
        : 1.055 * (channel ** (1 / 2.4)) - 0.055;
    return Math.round(clamp(normalized, 0, 1) * 255);
}

function rgbToOklab(color) {
    const rgb = parseColorToRgb(color);
    if (!rgb) throw new TypeError('Expected an RGB, HSL, or hex color.');

    const r = srgbByteToLinear(rgb.r);
    const g = srgbByteToLinear(rgb.g);
    const b = srgbByteToLinear(rgb.b);
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const lRoot = Math.cbrt(l);
    const mRoot = Math.cbrt(m);
    const sRoot = Math.cbrt(s);

    return {
        l: 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
        a: 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
        b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot
    };
}

function oklabToLinearRgb({ l, a, b }) {
    const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
    const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
    const sRoot = l - 0.0894841775 * a - 1.2914855480 * b;
    const lValue = lRoot ** 3;
    const mValue = mRoot ** 3;
    const sValue = sRoot ** 3;

    return {
        r: 4.0767416621 * lValue - 3.3077115913 * mValue + 0.2309699292 * sValue,
        g: -1.2684380046 * lValue + 2.6097574011 * mValue - 0.3413193965 * sValue,
        b: -0.0041960863 * lValue - 0.7034186147 * mValue + 1.707614701 * sValue
    };
}

function isLinearRgbInGamut({ r, g, b }) {
    const epsilon = 1e-7;
    return r >= -epsilon && r <= 1 + epsilon
        && g >= -epsilon && g <= 1 + epsilon
        && b >= -epsilon && b <= 1 + epsilon;
}

function oklabToRgb(oklab) {
    const linear = oklabToLinearRgb(oklab);
    if (!isLinearRgbInGamut(linear)) return null;
    return {
        r: linearToSrgbByte(linear.r),
        g: linearToSrgbByte(linear.g),
        b: linearToSrgbByte(linear.b)
    };
}

function oklchToOklab({ l, c, h }) {
    const radians = h * Math.PI / 180;
    return {
        l,
        a: c * Math.cos(radians),
        b: c * Math.sin(radians)
    };
}

function findMaxOklchChroma(lightness, hue) {
    let low = 0;
    let high = 0.4;
    for (let index = 0; index < 14; index++) {
        const middle = (low + high) / 2;
        const linear = oklabToLinearRgb(oklchToOklab({ l: lightness, c: middle, h: hue }));
        if (isLinearRgbInGamut(linear)) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return low;
}

// 在 Oklch 中取样，让不同色相的目标色拥有更接近的感知亮度和彩度范围。
function generateColor(_level, random = Math.random) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const lightness = 0.4 + random() * 0.42;
        const hue = random() * 360;
        const maxChroma = findMaxOklchChroma(lightness, hue);
        const chroma = maxChroma * (0.32 + random() * 0.4);
        const rgb = oklabToRgb(oklchToOklab({ l: lightness, c: chroma, h: hue }));
        if (rgb) return rgbToCss(rgb);
    }

    return 'rgb(128, 128, 128)';
}

function calculateOklabDistance(first, second) {
    const color1 = rgbToOklab(first);
    const color2 = rgbToOklab(second);
    return Math.hypot(
        color2.l - color1.l,
        color2.a - color1.a,
        color2.b - color1.b
    );
}

// 使用放大 100 倍的 Oklab 距离，便于配置游戏难度和分数锚点。
function calculatePerceptualDistance(first, second) {
    return calculateOklabDistance(first, second) * 100;
}

function scoreFromPerceptualDistance(distance) {
    const safeDistance = Math.max(0, Number(distance));
    for (let index = 1; index < OKLAB_SCORE_ANCHORS.length; index++) {
        const upper = OKLAB_SCORE_ANCHORS[index];
        if (safeDistance > upper.distance) continue;
        const lower = OKLAB_SCORE_ANCHORS[index - 1];
        const progress = (safeDistance - lower.distance) / (upper.distance - lower.distance);
        return lower.score + (upper.score - lower.score) * progress;
    }
    return 0;
}

function calculatePerceptualScore(target, user) {
    return scoreFromPerceptualDistance(calculatePerceptualDistance(target, user));
}

// 复现模式额外惩罚“有颜色的目标被还原成灰色”，匹配模式仍使用纯 Oklab 距离。
function calculateRecallDistanceDetails(target, user) {
    const targetOklab = rgbToOklab(target);
    const userOklab = rgbToOklab(user);
    const targetChroma = Math.hypot(targetOklab.a, targetOklab.b);
    const userChroma = Math.hypot(userOklab.a, userOklab.b);
    const oklabDelta = {
        l: userOklab.l - targetOklab.l,
        a: userOklab.a - targetOklab.a,
        b: userOklab.b - targetOklab.b
    };
    const rawDistance = Math.hypot(oklabDelta.l, oklabDelta.a, oklabDelta.b);
    const baseDistance = rawDistance * 100;
    const neutralRawAmount = 1
        - Math.min(targetChroma, userChroma) / RECALL_NEUTRAL_CHROMA_THRESHOLD;
    const neutralAmount = clamp(neutralRawAmount, 0, 1);
    const smoothNeutralAmount = neutralAmount * neutralAmount * (3 - 2 * neutralAmount);
    const neutralPenalty = Math.abs(targetChroma - userChroma)
        * 100
        * RECALL_NEUTRAL_PENALTY_WEIGHT
        * smoothNeutralAmount;
    const targetHue = Math.atan2(targetOklab.b, targetOklab.a) * 180 / Math.PI;
    const userHue = Math.atan2(userOklab.b, userOklab.a) * 180 / Math.PI;
    const rawHueDifference = Math.abs(targetHue - userHue) % 360;

    return {
        rawDistance,
        baseDistance,
        neutralPenalty,
        neutralRawAmount,
        neutralAmount,
        neutralFactor: smoothNeutralAmount,
        distance: baseDistance + neutralPenalty,
        oklabDelta,
        lightnessDelta: (userOklab.l - targetOklab.l) * 100,
        chromaDelta: (userChroma - targetChroma) * 100,
        hueDifference: Math.min(targetChroma, userChroma) < 0.00001
            ? null
            : Math.min(rawHueDifference, 360 - rawHueDifference),
        targetChroma,
        userChroma
    };
}

function calculateRecallDistance(target, user) {
    return calculateRecallDistanceDetails(target, user).distance;
}

function calculateRecallScore(target, user) {
    return scoreFromPerceptualDistance(calculateRecallDistance(target, user));
}

function getMatchDistanceBand(difficulty, level) {
    const safeLevel = Math.max(1, Number(level) || 1);
    let center;

    if (difficulty === 'advanced') {
        const progress = clamp((safeLevel - 1) / 9, 0, 1);
        center = 10 - 5 * progress;
    } else if (difficulty === 'master') {
        center = Math.max(3.5, 9 * (0.94 ** (safeLevel - 1)));
    } else {
        const progress = clamp((safeLevel - 1) / 9, 0, 1);
        center = 14 - 6 * progress;
    }

    return {
        center,
        min: center * 0.85,
        max: center * 1.15,
        minPairDistance: Math.max(1.4, center * 0.38)
    };
}

function randomUnitVector(random) {
    const lightnessDirection = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const chromaDirection = Math.sqrt(1 - lightnessDirection ** 2);
    return {
        l: lightnessDirection,
        a: chromaDirection * Math.cos(angle),
        b: chromaDirection * Math.sin(angle)
    };
}

function generatePerceptualDistractors(targetColor, count, options = {}) {
    const difficulty = options.difficulty || 'basic';
    const level = options.level || 1;
    const random = options.random || Math.random;
    const maxAttempts = options.maxAttempts || 8000;
    const targetRgb = parseColorToRgb(targetColor);
    if (!targetRgb) throw new TypeError('Cannot generate distractors for an invalid target color.');

    const targetOklab = rgbToOklab(targetRgb);
    const targetHex = rgbToHex(targetRgb);
    const band = getMatchDistanceBand(difficulty, level);
    const minPairDistance = band.minPairDistance * (options.pairDistanceScale || 1);
    const distractors = [];
    const usedHex = new Set([targetHex]);

    for (let attempt = 0; attempt < maxAttempts && distractors.length < count; attempt++) {
        const direction = randomUnitVector(random);
        const requestedDistance = band.min + random() * (band.max - band.min);
        const scale = requestedDistance / 100;
        const candidateRgb = oklabToRgb({
            l: targetOklab.l + direction.l * scale,
            a: targetOklab.a + direction.a * scale,
            b: targetOklab.b + direction.b * scale
        });
        if (!candidateRgb) continue;

        const candidateHex = rgbToHex(candidateRgb);
        if (usedHex.has(candidateHex)) continue;
        const actualDistance = calculatePerceptualDistance(targetRgb, candidateRgb);
        if (actualDistance < band.min || actualDistance > band.max) continue;
        const isSeparated = distractors.every((color) => (
            calculatePerceptualDistance(color, candidateRgb) >= minPairDistance
        ));
        if (!isSeparated) continue;

        distractors.push(candidateRgb);
        usedHex.add(candidateHex);
    }

    if (distractors.length !== count) {
        throw new Error(`Unable to generate ${count} perceptually separated distractors.`);
    }

    return distractors.map(rgbToCss);
}

function shuffleArray(array, random = Math.random) {
    for (let index = array.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(random() * (index + 1));
        [array[index], array[randomIndex]] = [array[randomIndex], array[index]];
    }
    return array;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        OKLAB_SCORE_ANCHORS,
        RECALL_NEUTRAL_CHROMA_THRESHOLD,
        RECALL_NEUTRAL_PENALTY_WEIGHT,
        calculateOklabDistance,
        calculatePerceptualDistance,
        calculatePerceptualScore,
        calculateRecallDistance,
        calculateRecallDistanceDetails,
        calculateRecallScore,
        findMaxOklchChroma,
        generateColor,
        generatePerceptualDistractors,
        getMatchDistanceBand,
        hslToRgb,
        oklabToRgb,
        oklchToOklab,
        parseColorToRgb,
        rgbToCss,
        rgbToHex,
        rgbToHsl,
        rgbToOklab,
        scoreFromPerceptualDistance,
        shuffleArray,
        srgbByteToLinear
    };
}
