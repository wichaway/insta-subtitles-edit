import type { SubtitleStyle } from './types';

function isHebrewStart(text: string): boolean {
  const m = text.match(/[^\s]/);
  if (!m) return false;
  const code = m[0].codePointAt(0) ?? 0;
  return code >= 0x0590 && code <= 0x05ff;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: SubtitleStyle,
  canvasW: number,
  canvasH: number
) {
  if (!text.trim()) return;
  const fontPx = (style.fontSize / 100) * canvasH;
  const weight = style.bold ? 700 : 500;
  ctx.font = `${weight} ${fontPx}px "${style.fontFamily}", sans-serif`;
  ctx.direction = isHebrewStart(text) ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = style.maxWidth * canvasW;
  const lines = wrapLines(ctx, text, maxWidth);
  const lineHeight = fontPx * 1.3;

  let anchorX = canvasW / 2;
  let anchorY: number;
  switch (style.position) {
    case 'top':
      anchorY = canvasH * 0.12;
      break;
    case 'center':
      anchorY = canvasH * 0.5;
      break;
    case 'custom':
      anchorX = style.x * canvasW;
      anchorY = style.y * canvasH;
      break;
    case 'bottom':
    default:
      anchorY = canvasH * 0.88;
  }

  const blockHeight = lineHeight * lines.length;
  const startY = anchorY - blockHeight / 2 + lineHeight / 2;

  if (style.backgroundOpacity > 0) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = fontPx * 0.5;
    const padY = fontPx * 0.28;
    const boxW = widest + padX * 2;
    const boxH = blockHeight + padY * 2;
    const boxX = anchorX - boxW / 2;
    const boxY = anchorY - boxH / 2;
    ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity);
    roundRect(ctx, boxX, boxY, boxW, boxH, fontPx * 0.25);
    ctx.fill();
  }

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    if (style.outline) {
      ctx.lineWidth = fontPx * 0.09;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, anchorX, y);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
