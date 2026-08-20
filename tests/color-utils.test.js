const test = require('node:test');
const assert = require('node:assert/strict');

const {
    OKLAB_SCORE_ANCHORS,
    calculatePerceptualDistance,
    calculatePerceptualScore,
    calculateRecallDistance,
    calculateRecallDistanceDetails,
    calculateRecallScore,
    generateColor,
    generatePerceptualDistractors,
    getMatchDistanceBand,
    oklabToRgb,
    parseColorToRgb,
    rgbToHex,
    rgbToOklab,
    scoreFromPerceptualDistance
} = require('../color-utils.js');

function approximately(actual, expected, tolerance = 1e-7) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `Expected ${actual} to be within ${tolerance} of ${expected}`
    );
}

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

test('sRGB primary colors match Oklab reference vectors', () => {
    const red = rgbToOklab({ r: 255, g: 0, b: 0 });
    approximately(red.l, 0.6279553606);
    approximately(red.a, 0.2248630611);
    approximately(red.b, 0.1258462985);

    const green = rgbToOklab({ r: 0, g: 255, b: 0 });
    approximately(green.l, 0.8664396115);
    approximately(green.a, -0.2338875742);
    approximately(green.b, 0.1794984799);

    const blue = rgbToOklab({ r: 0, g: 0, b: 255 });
    approximately(blue.l, 0.4520137184);
    approximately(blue.a, -0.0324569842);
    approximately(blue.b, -0.3115281477);
});

test('Oklab conversion round-trips rendered RGB colors', () => {
    const colors = [
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
        { r: 94, g: 200, b: 194 },
        { r: 243, g: 111, b: 99 },
        { r: 28, g: 79, b: 132 }
    ];

    colors.forEach((color) => {
        assert.deepEqual(oklabToRgb(rgbToOklab(color)), color);
    });
});

test('score mapping preserves every configured anchor', () => {
    OKLAB_SCORE_ANCHORS.forEach(({ distance, score }) => {
        approximately(scoreFromPerceptualDistance(distance), score, 1e-12);
    });
});

test('perceptual score is symmetric, bounded, and decreases with distance', () => {
    const black = { r: 0, g: 0, b: 0 };
    const samples = [
        black,
        { r: 16, g: 16, b: 16 },
        { r: 64, g: 64, b: 64 },
        { r: 255, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 }
    ];
    const scores = samples.map((color) => calculatePerceptualScore(black, color));

    approximately(scores[0], 10, 1e-12);
    assert.ok(scores.every((score) => score >= 0 && score <= 10));
    for (let index = 1; index < scores.length; index++) {
        assert.ok(scores[index] <= scores[index - 1]);
    }
    approximately(
        calculatePerceptualDistance(black, samples[3]),
        calculatePerceptualDistance(samples[3], black),
        1e-12
    );
    assert.ok(calculatePerceptualScore(black, samples[3]) < 1.1);
});

test('recall scoring penalizes a colored target reproduced as gray', () => {
    const grayAttempt = calculateRecallDistanceDetails(
        { r: 62, g: 124, b: 127 },
        { r: 128, g: 128, b: 128 }
    );
    const sameHueAttempt = calculateRecallDistanceDetails(
        { r: 118, g: 59, b: 135 },
        { r: 189, g: 97, b: 193 }
    );

    approximately(grayAttempt.baseDistance, 8.345652804580233);
    approximately(grayAttempt.neutralPenalty, 10.256917866624654);
    approximately(grayAttempt.distance, 18.602570671204887);
    assert.ok(grayAttempt.neutralAmount > 0.99999);
    assert.ok(grayAttempt.neutralFactor > 0.99999);
    approximately(sameHueAttempt.baseDistance, 18.043781400018073);
    approximately(sameHueAttempt.neutralPenalty, 0);
    approximately(sameHueAttempt.neutralAmount, 0);
    approximately(sameHueAttempt.neutralFactor, 0);
    approximately(calculateRecallScore({ r: 62, g: 124, b: 127 }, { r: 128, g: 128, b: 128 }), 6.737562985895169);
    approximately(calculateRecallScore({ r: 118, g: 59, b: 135 }, { r: 189, g: 97, b: 193 }), 6.832557161996927);
    assert.ok(sameHueAttempt.distance < grayAttempt.distance);
});

test('recall distance remains symmetric and exact matches keep full score', () => {
    const first = { r: 62, g: 124, b: 127 };
    const second = { r: 128, g: 128, b: 128 };

    approximately(calculateRecallDistance(first, second), calculateRecallDistance(second, first));
    approximately(calculateRecallDistance(first, first), 0);
    approximately(calculateRecallScore(first, first), 10);
    approximately(calculatePerceptualDistance(first, second), 8.345652804580233);
});

test('default gray is not a high-scoring recall baseline', () => {
    const random = seededRandom(20260821);
    const scores = Array.from({ length: 5000 }, (_, index) => (
        calculateRecallScore(generateColor(index + 1, random), { r: 128, g: 128, b: 128 })
    )).sort((first, second) => first - second);
    const highScores = scores.filter((score) => score >= 8).length / scores.length;

    assert.ok(scores[Math.floor(scores.length / 2)] <= 5.5);
    assert.ok(highScores < 0.01);
});

test('visually identical HSL strings resolve to the same canonical RGB', () => {
    assert.equal(rgbToHex('hsl(0, 30%, 30%)'), '#633636');
    assert.equal(rgbToHex('hsl(359, 30%, 30%)'), '#633636');
});

test('generated Oklch targets are valid, non-neutral sRGB colors', () => {
    const random = seededRandom(20260819);
    for (let index = 0; index < 100; index++) {
        const color = generateColor(index + 1, random);
        const rgb = parseColorToRgb(color);
        assert.ok(rgb);
        assert.ok([rgb.r, rgb.g, rgb.b].every((channel) => channel >= 0 && channel <= 255));
        assert.notEqual(Math.max(rgb.r, rgb.g, rgb.b), Math.min(rgb.r, rgb.g, rgb.b));
    }
});

test('matching palettes respect target and pairwise perceptual distances', () => {
    const scenarios = [
        { difficulty: 'basic', level: 1, count: 8 },
        { difficulty: 'basic', level: 10, count: 8 },
        { difficulty: 'advanced', level: 1, count: 15 },
        { difficulty: 'advanced', level: 10, count: 15 },
        { difficulty: 'master', level: 1, count: 15 },
        { difficulty: 'master', level: 25, count: 15 },
        { difficulty: 'master', level: 100, count: 15 }
    ];

    scenarios.forEach((scenario, scenarioIndex) => {
        const random = seededRandom(1000 + scenarioIndex);
        const target = generateColor(scenario.level, random);
        const colors = generatePerceptualDistractors(target, scenario.count, {
            difficulty: scenario.difficulty,
            level: scenario.level,
            random
        });
        const band = getMatchDistanceBand(scenario.difficulty, scenario.level);
        const canonical = [target, ...colors].map(rgbToHex);

        assert.equal(colors.length, scenario.count);
        assert.equal(new Set(canonical).size, canonical.length);
        colors.forEach((color, colorIndex) => {
            const targetDistance = calculatePerceptualDistance(target, color);
            assert.ok(targetDistance >= band.min);
            assert.ok(targetDistance <= band.max);
            colors.slice(0, colorIndex).forEach((previous) => {
                assert.ok(
                    calculatePerceptualDistance(previous, color) >= band.minPairDistance
                );
            });
        });
    });
});

test('distractor generation fails in a bounded way when randomness cannot make a palette', () => {
    assert.throws(
        () => generatePerceptualDistractors('rgb(128, 128, 128)', 2, {
            difficulty: 'basic',
            level: 1,
            random: () => 0.5,
            maxAttempts: 10
        }),
        /Unable to generate 2 perceptually separated distractors/
    );
});
