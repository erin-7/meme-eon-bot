// lib/cardImage.js
// 카카오 basicCard 썸네일로 쓸 이미지를 그린다.
// - renderPhotoCard : 실제 사진(위키피디아 인물 사진 등)을 배경으로 깔고 그 위에 자막을 입힌다
//                      (예: 소크라테스 흉상 사진 + "너 자신을 알라" 자막)
// - renderRawPhoto   : 이미 자막이 박제된 이미지(직접 넣은 방송 캡처짤 등)를 그대로 리사이즈만 해서 낸다
// - renderQuoteCard  : 사진이 아예 없을 때 쓰는 자체 제작 컬러 카드 (fallback)

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Pretendard-Regular.otf'), 'Pretendard');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Pretendard-Bold.otf'), 'Pretendard-Bold');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Pretendard-ExtraBold.otf'), 'Pretendard-ExtraBold');

const WIDTH = 800;
const HEIGHT = 450;

// ---------- 공용 유틸 --------------------------------------------------------

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  const pushHardWrapped = (word) => {
    let chunk = '';
    for (const ch of word) {
      const test = chunk + ch;
      if (ctx.measureText(test).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = test;
      }
    }
    return chunk;
  };

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
      continue;
    }
    if (current) lines.push(current);
    if (ctx.measureText(word).width > maxWidth) {
      current = pushHardWrapped(word);
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 예능 자막 느낌의 삐죽삐죽한 말풍선(burst) 경로
function burstPath(ctx, cx, cy, w, h, spikes = 14) {
  const outerRx = w / 2;
  const outerRy = h / 2;
  const innerRx = outerRx * 0.9;
  const innerRy = outerRy * 0.82;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (Math.PI * i) / spikes;
    const rx = i % 2 === 0 ? outerRx : innerRx;
    const ry = i % 2 === 0 ? outerRy : innerRy;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// 이미지를 캔버스에 "cover" 방식으로 꽉 채워 그리기 (크롭 발생)
function drawCover(ctx, img, dx, dy, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function outlinedText(ctx, text, x, y, { fillStyle = '#fff', strokeStyle = '#000', lineWidth = 8 } = {}) {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillStyle;
  ctx.fillText(text, x, y);
}

// ---------- 자체 제작 컬러 카드 (사진이 없을 때 fallback) ----------------------

function renderQuoteCard({ bg = '333333', fg = 'FFFFFF', label = '오늘의 밈언', quote = '', source = '' }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = `#${bg}`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = `#${fg}`;
  ctx.lineWidth = 2;
  for (let x = -HEIGHT; x < WIDTH; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + HEIGHT, HEIGHT);
    ctx.stroke();
  }
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '32px Pretendard-Bold';
  const chipText = `오늘의 밈언 · ${label}`;
  const chipPadX = 20;
  const chipWidth = ctx.measureText(chipText).width + chipPadX * 2;
  ctx.fillStyle = `#${fg}`;
  ctx.globalAlpha = 0.16;
  roundRect(ctx, 28, 28, chipWidth, 52, 26);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = `#${fg}`;
  ctx.fillText(chipText, 28 + chipPadX, 28 + 26);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const quoteText = `"${quote}"`;
  ctx.font = '52px Pretendard-ExtraBold';
  const maxTextWidth = WIDTH - 100;
  let lines = wrapText(ctx, quoteText, maxTextWidth);
  let lineHeight = 64;
  if (lines.length > 4) {
    ctx.font = '38px Pretendard-ExtraBold';
    lines = wrapText(ctx, quoteText, maxTextWidth);
    lineHeight = 50;
  }
  const startY = HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2 + 6;
  ctx.fillStyle = `#${fg}`;
  lines.forEach((line, i) => ctx.fillText(line, WIDTH / 2, startY + i * lineHeight));

  ctx.font = '26px Pretendard';
  ctx.textAlign = 'right';
  ctx.globalAlpha = 0.85;
  ctx.fillText(`- ${source}`, WIDTH - 32, HEIGHT - 32);
  ctx.globalAlpha = 1;

  return canvas.toBuffer('image/png');
}

// ---------- 사진 + 자막 합성 (위키피디아 인물 사진 등) --------------------------

/**
 * captionStyle:
 *  - 'burst' : 예능 자막처럼 삐죽삐죽한 말풍선 안에 텍스트 (재미있는 컨셉용)
 *  - 'bar'   : 하단에 반투명 그라데이션 바 + 굵은 흰 글씨 (일반 자막용)
 *  - 'plain' : 배경 사진 위에 바로 외곽선 있는 글씨만 (엄숙한 인물 명언용, 소크라테스 스타일)
 */
async function renderPhotoCard({ backgroundBuffer, quote, source, captionStyle = 'bar' }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const img = await loadImage(backgroundBuffer);
  drawCover(ctx, img, 0, 0, WIDTH, HEIGHT);

  const quoteText = `"${quote}"`;

  if (captionStyle === 'burst') {
    ctx.font = '34px Pretendard-ExtraBold';
    const maxTextWidth = WIDTH * 0.62;
    let lines = wrapText(ctx, quoteText, maxTextWidth);
    if (lines.length > 3) {
      ctx.font = '28px Pretendard-ExtraBold';
      lines = wrapText(ctx, quoteText, maxTextWidth);
    }
    const lineHeight = 40;
    const boxW = Math.min(WIDTH - 60, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 90);
    const boxH = lines.length * lineHeight + 70;
    const cx = WIDTH / 2;
    const cy = HEIGHT - boxH / 2 - 26;

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 14;
    burstPath(ctx, cx, cy, boxW, boxH, 16);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
  } else if (captionStyle === 'plain') {
    ctx.font = '46px Pretendard-ExtraBold';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const maxTextWidth = WIDTH - 90;
    let lines = wrapText(ctx, quoteText, maxTextWidth);
    let lineHeight = 56;
    if (lines.length > 3) {
      ctx.font = '34px Pretendard-ExtraBold';
      lines = wrapText(ctx, quoteText, maxTextWidth);
      lineHeight = 44;
    }
    const startY = HEIGHT - 46 - (lines.length - 1) * lineHeight;
    lines.forEach((line, i) => {
      outlinedText(ctx, line, WIDTH / 2, startY + i * lineHeight, { lineWidth: 9 });
    });
  } else {
    // 'bar'
    const barHeight = 150;
    const gradient = ctx.createLinearGradient(0, HEIGHT - barHeight, 0, HEIGHT);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.35, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, HEIGHT - barHeight, WIDTH, barHeight);

    ctx.font = '36px Pretendard-ExtraBold';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const maxTextWidth = WIDTH - 90;
    let lines = wrapText(ctx, quoteText, maxTextWidth);
    let lineHeight = 44;
    if (lines.length > 2) {
      ctx.font = '28px Pretendard-ExtraBold';
      lines = wrapText(ctx, quoteText, maxTextWidth);
      lineHeight = 34;
    }
    const startY = HEIGHT - 56 - (lines.length - 1) * lineHeight;
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => ctx.fillText(line, WIDTH / 2, startY + i * lineHeight));
  }

  // 출처 워터마크 (작게, 우하단)
  ctx.font = '20px Pretendard';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  outlinedText(ctx, `- ${source}`, WIDTH - 20, HEIGHT - 14, { lineWidth: 4 });

  return canvas.toBuffer('image/png');
}

// ---------- 이미 자막이 박제된 이미지(직접 넣은 캡처짤)는 리사이즈만 -------------

async function renderRawPhoto(backgroundBuffer) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const img = await loadImage(backgroundBuffer);
  drawCover(ctx, img, 0, 0, WIDTH, HEIGHT);
  return canvas.toBuffer('image/png');
}

module.exports = { renderQuoteCard, renderPhotoCard, renderRawPhoto };
