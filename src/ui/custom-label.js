import { GOVERNMENT_WARNING_TEXT } from '../app-state.js';

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let currentY = y;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line) ctx.fillText(line, x, currentY);
  return currentY + lineHeight;
}

function drawFrame(ctx, width, height) {
  ctx.fillStyle = '#fffdf4';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#1b211f';
  ctx.lineWidth = 10;
  ctx.strokeRect(60, 60, width - 120, height - 120);
}

function canvasToFile(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const file = new File([blob], filename, { type: 'image/png' });
      resolve({
        id: `${filename}-${crypto.randomUUID()}`,
        name: filename,
        type: 'image/png',
        size: file.size,
        file,
        url: URL.createObjectURL(file),
        source: 'generated',
      });
    }, 'image/png');
  });
}

function createFrontCanvas(expected) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  drawFrame(ctx, canvas.width, canvas.height);

  ctx.fillStyle = '#1b211f';
  ctx.textAlign = 'center';
  ctx.font = '800 72px Arial';
  wrapText(ctx, expected.brandName, 600, 180, 920, 82);
  ctx.font = '500 46px Arial';
  wrapText(ctx, expected.classType, 600, 360, 880, 58);
  ctx.font = '700 54px Arial';
  ctx.fillText(expected.alcoholContent, 600, 600);
  ctx.fillText(expected.netContents, 600, 700);
  ctx.font = '700 34px Arial';
  if (expected.producerName) {
    ctx.fillText(`BOTTLED BY ${expected.producerName}`.toUpperCase(), 600, 920);
  }
  ctx.font = '500 34px Arial';
  if (expected.countryOfOrigin) {
    ctx.fillText(`PRODUCT OF ${expected.countryOfOrigin}`.toUpperCase(), 600, 1000);
  }

  return canvas;
}

function createBackCanvas(expected) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  drawFrame(ctx, canvas.width, canvas.height);

  ctx.fillStyle = '#1b211f';
  ctx.textAlign = 'center';
  ctx.font = '800 62px Arial';
  wrapText(ctx, expected.brandName, 600, 150, 900, 72);
  ctx.font = '500 38px Arial';
  wrapText(ctx, expected.classType, 600, 310, 880, 50);

  ctx.textAlign = 'left';
  ctx.font = '800 38px Arial';
  ctx.fillText('GOVERNMENT WARNING:', 95, 520);
  ctx.font = '500 34px Arial';
  if (expected.governmentWarningRequired) {
    wrapText(ctx, GOVERNMENT_WARNING_TEXT.replace('GOVERNMENT WARNING:', ''), 95, 590, 1000, 48);
  } else {
    wrapText(ctx, 'No government warning text rendered for this custom packet.', 95, 590, 1000, 48);
  }

  ctx.textAlign = 'center';
  ctx.font = '700 38px Arial';
  if (expected.producerName) ctx.fillText(expected.producerName.toUpperCase(), 600, 1150);
  ctx.font = '500 34px Arial';
  if (expected.countryOfOrigin) ctx.fillText(`PRODUCT OF ${expected.countryOfOrigin}`.toUpperCase(), 600, 1230);

  return canvas;
}

export async function createCustomLabelImageEntries(expected) {
  const front = await canvasToFile(createFrontCanvas(expected), 'custom-label-front.png');
  const back = await canvasToFile(createBackCanvas(expected), 'custom-label-back.png');
  return [front, back];
}
