/**
 * Neutral frame transmitted while SnapMeet must not reveal the camera (renderer failure
 * or camera restart while the user was vanished). Drawn with Canvas 2D only so it works
 * even when WebGL is unavailable or lost.
 */
export function drawSafeFrame(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#24272b');
  g.addColorStop(1, '#17191c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 ${Math.round(h * 0.035)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Video paused', w / 2, h / 2);
}
