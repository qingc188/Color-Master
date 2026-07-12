// 颜色生成、转换和评分工具
// 生成随机颜色
function generateColor(level) {
    // 目标色覆盖更宽的饱和度和亮度范围，避免题目过于集中。
    const hue = Math.floor(Math.random() * 360);
    const saturation = 30 + Math.floor(Math.random() * 71); // 30-100%
    const lightness = 30 + Math.floor(Math.random() * 51); // 30-80%
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// 生成与目标颜色相似的颜色
function generateSimilarColor(targetColor, level) {
    // 解析目标颜色的HSL值
    const hslMatch = targetColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!hslMatch) return generateColor(level);
    
    const [, targetHue, targetSaturation, targetLightness] = hslMatch;
    
    // 随着关卡提升，颜色差异减小
    const variation = Math.max(5, 30 - level * 2); // 5-30的差异范围
    
    // 生成相似但不同的颜色
    const hue = (parseInt(targetHue) + Math.floor(Math.random() * variation * 2) - variation + 360) % 360;
    const saturation = Math.max(0, Math.min(100, parseInt(targetSaturation) + Math.floor(Math.random() * variation * 2) - variation));
    const lightness = Math.max(0, Math.min(100, parseInt(targetLightness) + Math.floor(Math.random() * variation * 2) - variation));
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// 打乱数组
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 将RGB或HSL颜色转换为十六进制
function rgbToHex(color) {
    // 如果是对象格式（来自hslToRgb）
    if (typeof color === 'object' && color.r !== undefined) {
        return '#' + ((1 << 24) + (color.r << 16) + (color.g << 8) + color.b).toString(16).slice(1).toUpperCase();
    }
    
    // 处理HSL颜色
    if (typeof color === 'string' && color.startsWith('hsl')) {
        const hslMatch = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (hslMatch) {
            const [, h, s, l] = hslMatch;
            const rgb = hslToRgb(parseInt(h), parseInt(s), parseInt(l));
            return '#' + ((1 << 24) + (rgb.r << 16) + (rgb.g << 8) + rgb.b).toString(16).slice(1).toUpperCase();
        }
    }
    
    // 处理RGB颜色
    if (typeof color === 'string') {
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            const [, r, g, b] = rgbMatch;
            return '#' + ((1 << 24) + (parseInt(r) << 16) + (parseInt(g) << 8) + parseInt(b)).toString(16).slice(1).toUpperCase();
        }
        
        // 如果已经是十六进制，直接返回
        if (color.startsWith('#')) {
            return color.toUpperCase();
        }
    }
    
    return color;
}

// HSL转RGB
function hslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;
    
    let r, g, b;
    
    if (s === 0) {
        r = g = b = l; // 灰色
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

// 计算颜色相似度得分
function calculateColorSimilarity(target, user) {
    // HSL颜色差异计算
    let hDiff = Math.abs(target.h - user.h);
    // 处理色相环绕
    if (hDiff > 180) hDiff = 360 - hDiff;
    hDiff = hDiff / 180; // 归一化到0-1
    
    const sDiff = Math.abs(target.s - user.s) / 100;
    const lDiff = Math.abs(target.l - user.l) / 100;
    
    // 加权计算总差异
    const totalDiff = Math.sqrt(hDiff * hDiff + sDiff * sDiff + lDiff * lDiff) / Math.sqrt(3);
    
    // 转换为0-10的得分
    const score = Math.max(0, 10 - totalDiff * 10);
    return score.toFixed(2);
}

function calculateRgbSimilarity(target, user) {
    const rDiff = Math.abs(target.r - user.r) / 255;
    const gDiff = Math.abs(target.g - user.g) / 255;
    const bDiff = Math.abs(target.b - user.b) / 255;
    const totalDiff = Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff) / Math.sqrt(3);
    const score = Math.max(0, 10 - totalDiff * 10);
    return score.toFixed(2);
}

