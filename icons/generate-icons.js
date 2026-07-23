/* ================================================================
   PWA 图标生成器
   使用方法: node generate-icons.js
   生成 192x192 和 512x512 的 PNG 图标
   ================================================================ */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/**
 * 创建简单的纯色 PNG 图标（带书本图案）
 * @param {number} size - 图标尺寸
 * @param {string} filename - 输出文件名
 */
function generateIcon(size, filename) {
    // 创建像素数据（RGBA 格式，每像素4字节）
    const pixels = Buffer.alloc(size * size * 4);

    const center = size / 2;
    const bgColor = [26, 26, 46, 255];    // 背景色：深蓝黑 #1a1a2e
    const accentColor = [233, 69, 96, 255]; // 主色：红色 #e94560
    const white = [255, 255, 255, 255];

    // 填充背景
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;

            // 绘制圆角方形背景
            const cornerRadius = size * 0.15;
            let inRoundedRect = true;

            // 简单的圆角检测
            const halfSize = size * 0.38;
            const cx = center, cy = center;

            // 绘制简化的书本形状
            // 书本左页
            const bookLeft = cx - halfSize;
            const bookRight = cx + halfSize;
            const bookTop = cy - halfSize * 1.1;
            const bookBottom = cy + halfSize * 1.1;
            const spineX = cx;

            const inBook =
                x >= bookLeft && x <= bookRight &&
                y >= bookTop && y <= bookBottom;

            // 书脊线
            const isSpine = Math.abs(x - spineX) < Math.max(1, size * 0.008) &&
                           y >= bookTop && y <= bookBottom;

            // 装饰横线
            const lineCount = 5;
            const lineSpacing = (bookBottom - bookTop) / (lineCount + 2);
            let isLine = false;
            for (let i = 1; i <= lineCount; i++) {
                const lineY = bookTop + lineSpacing * i;
                const lineStart = bookLeft + (x < spineX ? halfSize * 0.2 : halfSize * 0.15);
                const lineEnd = (x < spineX ? spineX : bookRight) - halfSize * 0.2;
                if (Math.abs(y - lineY) < Math.max(1, size * 0.012) &&
                    x >= lineStart && x <= lineEnd) {
                    isLine = true;
                }
            }

            if (isSpine) {
                pixels[idx] = white[0];
                pixels[idx + 1] = white[1];
                pixels[idx + 2] = white[2];
                pixels[idx + 3] = white[3];
            } else if (isLine) {
                pixels[idx] = accentColor[0];
                pixels[idx + 1] = accentColor[1];
                pixels[idx + 2] = accentColor[2];
                pixels[idx + 3] = accentColor[3];
            } else if (inBook) {
                // 左页浅色，右页深色
                if (x < spineX) {
                    pixels[idx] = 240;
                    pixels[idx + 1] = 240;
                    pixels[idx + 2] = 245;
                    pixels[idx + 3] = 255;
                } else {
                    pixels[idx] = 220;
                    pixels[idx + 1] = 225;
                    pixels[idx + 2] = 235;
                    pixels[idx + 3] = 255;
                }
            } else {
                pixels[idx] = bgColor[0];
                pixels[idx + 1] = bgColor[1];
                pixels[idx + 2] = bgColor[2];
                pixels[idx + 3] = bgColor[3];
            }

            // 圆角处理（四个角变暗/透明）
            const cornerDist = Math.min(
                Math.sqrt((x - cornerRadius) ** 2 + (y - cornerRadius) ** 2),
                Math.sqrt((x - (size - cornerRadius)) ** 2 + (y - cornerRadius) ** 2),
                Math.sqrt((x - cornerRadius) ** 2 + (y - (size - cornerRadius)) ** 2),
                Math.sqrt((x - (size - cornerRadius)) ** 2 + (y - (size - cornerRadius)) ** 2)
            );
            if (cornerDist < cornerRadius * 0.3) {
                // 让圆角区域匹配背景色
                const alpha = Math.min(1, cornerDist / (cornerRadius * 0.3));
                pixels[idx + 3] = Math.round(255 * alpha);
            }
        }
    }

    // 创建 PNG 文件
    const png = createPNG(size, size, pixels);
    fs.writeFileSync(path.join(__dirname, filename), png);
    console.log(`✅ 已生成: ${filename} (${size}x${size})`);
}

/**
 * 创建有效的 PNG 文件（使用 Node.js zlib）
 */
function createPNG(width, height, rgbaData) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // color type: RGBA
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    const ihdr = createChunk('IHDR', ihdrData);

    // IDAT chunk - 压缩像素数据
    // 每行前加一个 filter byte (0 = None)
    const rawData = Buffer.alloc(width * height * 4 + height);
    for (let y = 0; y < height; y++) {
        rawData[y * (width * 4 + 1)] = 0; // filter byte
        rgbaData.copy(rawData, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    const compressed = zlib.deflateSync(rawData);
    const idat = createChunk('IDAT', compressed);

    // IEND chunk
    const iend = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * 创建 PNG chunk
 */
function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeBuffer = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeBuffer, data]));

    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc, 0);

    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * CRC32 校验
 */
function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >>> 1) ^ 0xEDB88320;
            } else {
                crc = crc >>> 1;
            }
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 生成两种尺寸的图标
console.log('🎨 正在生成 PWA 图标...\n');
generateIcon(192, 'icon-192.png');
generateIcon(512, 'icon-512.png');
console.log('\n📱 图标生成完成！');
