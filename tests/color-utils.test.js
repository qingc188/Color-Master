const test = require('node:test');
const assert = require('node:assert/strict');

const {
    OKLAB_SCORE_ANCHORS,
    calculatePerceptualDistance,
    calculatePerceptualScore,
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
