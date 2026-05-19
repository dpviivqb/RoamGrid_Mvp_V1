import { formatDistance, formatDuration, formatPercentage } from "@/lib/format";
import { t, type Language } from "@/lib/i18n";
import type { ExplorationResult } from "@/lib/types";

const WIDTH = 1200;
const HEIGHT = 1500;

export async function buildShareCardImage(
  result: ExplorationResult,
  language: Language,
  place: string
) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas is not supported.");
  }

  const claimedBlocks = result.newlyClaimedGridCount ?? result.discoveredGridIds.length;
  drawBackground(ctx);
  drawHeader(ctx, place);
  drawClaim(ctx, claimedBlocks, language);
  await drawMap(ctx, result.mapSnapshotDataUrl);
  drawStats(ctx, result, language);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to render share card."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#07101a");
  gradient.addColorStop(0.58, "#080b13");
  gradient.addColorStop(1, "#17120d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(580, 580, 30, 580, 580, 620);
  glow.addColorStop(0, "rgba(45, 212, 191, 0.24)");
  glow.addColorStop(1, "rgba(45, 212, 191, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawHeader(ctx: CanvasRenderingContext2D, place: string) {
  ctx.fillStyle = "#99f6e4";
  ctx.font = "900 42px Arial";
  ctx.letterSpacing = "8px";
  ctx.fillText("ROAMGRID", 76, 106);
  ctx.letterSpacing = "0px";

  const pillWidth = 420;
  const pillX = WIDTH - pillWidth - 76;
  drawRoundRect(ctx, pillX, 64, pillWidth, 62, 31, "rgba(45, 212, 191, 0.14)", "rgba(153, 246, 228, 0.45)");
  ctx.fillStyle = "#ccfbf1";
  ctx.font = "700 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(trimText(ctx, place, pillWidth - 44), pillX + pillWidth / 2, 95);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawClaim(ctx: CanvasRenderingContext2D, claimedBlocks: number, language: Language) {
  ctx.fillStyle = "#99f6e4";
  ctx.font = "900 190px Arial";
  ctx.textAlign = "center";
  ctx.fillText(`+${claimedBlocks}`, WIDTH / 2, 335);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 48px Arial";
  ctx.fillText(t(language, "newBlockClaimed").toUpperCase(), WIDTH / 2, 405);
  ctx.textAlign = "left";
}

async function drawMap(ctx: CanvasRenderingContext2D, snapshot?: string) {
  const x = 76;
  const y = 470;
  const width = WIDTH - 152;
  const height = 690;
  drawRoundRect(ctx, x, y, width, height, 24, "#020617", "rgba(255, 255, 255, 0.12)");

  ctx.save();
  roundedClip(ctx, x, y, width, height, 24);

  if (snapshot) {
    try {
      const image = await loadImage(snapshot);
      const scale = Math.max(width / image.width, height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    } catch {
      drawFallbackMap(ctx, x, y, width, height);
    }
  } else {
    drawFallbackMap(ctx, x, y, width, height);
  }

  const vignette = ctx.createRadialGradient(x + width / 2, y + height / 2, 60, x + width / 2, y + height / 2, 620);
  vignette.addColorStop(0, "rgba(2, 6, 23, 0)");
  vignette.addColorStop(1, "rgba(2, 6, 23, 0.58)");
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawFallbackMap(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = "#020617";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(45, 212, 191, 0.18)";
  ctx.lineWidth = 1;

  for (let gx = x; gx < x + width; gx += 68) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
    ctx.stroke();
  }
  for (let gy = y; gy < y + height; gy += 68) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + 250, y + 160);
  ctx.lineTo(x + 760, y + 470);
  ctx.stroke();

  ctx.fillStyle = "rgba(45, 212, 191, 0.24)";
  ctx.strokeStyle = "rgba(153, 246, 228, 0.85)";
  ctx.lineWidth = 3;
  [0, 1, 2, 3].forEach((index) => {
    const size = 120;
    const sx = x + 190 + index * 165;
    const sy = y + 150 + index * 105;
    ctx.fillRect(sx, sy, size, size);
    ctx.strokeRect(sx, sy, size, size);
  });
}

function drawStats(ctx: CanvasRenderingContext2D, result: ExplorationResult, language: Language) {
  const stats = [
    [formatDistance(result.distanceMeters), t(language, "shareDistance")],
    [formatDuration(result.durationSeconds), t(language, "shareTime")],
    [formatPercentage(result.explorationPercentage), t(language, "shareExplored")]
  ];

  const y = 1225;
  const gap = 24;
  const width = (WIDTH - 152 - gap * 2) / 3;
  stats.forEach(([value, label], index) => {
    const x = 76 + index * (width + gap);
    drawRoundRect(ctx, x, y, width, 170, 22, "rgba(0, 0, 0, 0.36)", "rgba(255, 255, 255, 0.12)");
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 40px Arial";
    ctx.textAlign = "center";
    ctx.fillText(value, x + width / 2, y + 68);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "800 24px Arial";
    ctx.fillText(label.toUpperCase(), x + width / 2, y + 118);
  });
  ctx.textAlign = "left";
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function roundedClip(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.clip();
}

function trimText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}...`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
