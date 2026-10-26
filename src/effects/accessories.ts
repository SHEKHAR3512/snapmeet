import type { SpriteRenderer } from './sprites';
import type { EffectFrame } from './types';

/** Face landmarks remain in camera space; the real face stays visible under the props. */
export function drawAccessory(sprites: SpriteRenderer, f: EffectFrame, kind: 'glasses' | 'suit' | 'hat', alpha: number): void {
  const face = f.inputs.face;
  if (!face) return;
  const aspect = f.inputs.width / f.inputs.height;
  const common = { outAspect: aspect, alpha, rotation: face.rotation };
  if (kind === 'glasses') {
    const art = sprites.art('respect-glasses', 600, 180, c => {
      c.fillStyle = '#080808';
      c.beginPath(); c.roundRect(18, 20, 240, 125, 24); c.roundRect(342, 20, 240, 125, 24); c.fill();
      c.fillRect(245, 38, 110, 25); c.fillRect(0, 28, 25, 24); c.fillRect(575, 28, 25, 24);
      c.strokeStyle = '#656575'; c.lineWidth = 9;
      for (const x of [55, 380]) { c.beginPath(); c.moveTo(x, 45); c.lineTo(x + 70, 110); c.stroke(); }
    });
    const drop = f.reducedMotion ? 0 : Math.max(0, 1 - f.elapsed / 420) * face.height;
    sprites.draw(art, { ...common, x: face.eyes[0], y: face.eyes[1] - drop, height: face.width * 0.32 });
  } else if (kind === 'suit') {
    const art = sprites.art('cinema-suit', 800, 700, c => {
      const poly = (fill: string, points: number[]) => {
        c.fillStyle = fill; c.beginPath(); c.moveTo(points[0]!, points[1]!);
        for (let i = 2; i < points.length; i += 2) c.lineTo(points[i]!, points[i + 1]!);
        c.closePath(); c.fill();
      };
      const shade = c.createLinearGradient(0, 0, 800, 650); shade.addColorStop(0, '#323238'); shade.addColorStop(0.5, '#121216'); shade.addColorStop(1, '#29292e');
      c.fillStyle = shade; c.beginPath(); c.moveTo(300, 25); c.lineTo(100, 100); c.quadraticCurveTo(10, 145, 0, 700); c.lineTo(800, 700); c.quadraticCurveTo(790, 145, 700, 100); c.lineTo(500, 25); c.lineTo(400, 190); c.closePath(); c.fill();
      poly('#dddde0', [300, 25, 400, 100, 500, 25, 460, 390, 340, 390]);
      poly('#f9f9fa', [300, 25, 400, 100, 355, 175, 320, 95]);
      poly('#f9f9fa', [500, 25, 400, 100, 445, 175, 480, 95]);
      poly('#252528', [380, 110, 420, 110, 431, 155, 415, 190, 442, 390, 400, 435, 358, 390, 385, 190, 369, 155]);
      poly('#45454a', [300, 25, 340, 250, 400, 470, 245, 245, 275, 190, 230, 150]);
      poly('#39393f', [500, 25, 460, 250, 400, 470, 555, 245, 525, 190, 570, 150]);
      c.fillStyle = '#777'; c.beginPath(); c.arc(410, 530, 6, 0, Math.PI * 2); c.fill();
    });
    const candidate = f.inputs.body;
    const body = candidate && Math.abs(candidate.shoulders[0] - face.chin[0]) * aspect < face.width * 1.5 ? candidate : null;
    const height = body ? body.width * 1.45 : face.width * 2.7;
    const rotation = body?.rotation ?? face.rotation * 0.2;
    // Artwork shoulder seam is at 100/700 of its height; anchor it to shoulders,
    // independently of the face so the jacket does not sway when you turn your head.
    const offset = height * (0.5 - 100 / 700);
    const x = body ? body.shoulders[0] + Math.sin(rotation) * offset / aspect : face.chin[0];
    const y = body ? body.shoulders[1] + Math.cos(rotation) * offset : face.chin[1] + height * 0.46;
    sprites.draw(art, { ...common, rotation, x, y, height, holes: f.inputs.hands });
  } else {
    const art = sprites.art('fine-hat', 480, 240, c => {
      c.fillStyle = '#ae7946'; c.beginPath(); c.roundRect(110, 0, 260, 190, 60); c.fill();
      c.fillStyle = '#543725'; c.fillRect(110, 120, 260, 45);
      c.fillStyle = '#c39659'; c.beginPath(); c.ellipse(240, 190, 235, 40, 0, 0, Math.PI * 2); c.fill();
    });
    sprites.draw(art, { ...common, x: face.forehead[0], y: face.forehead[1] - face.width * 0.16, height: face.width * 0.6 });
    const table = sprites.art('fine-table', 800, 100, c => {
      c.fillStyle = '#573828'; c.fillRect(0, 30, 800, 70);
      c.fillStyle = '#b97c43'; c.beginPath(); c.ellipse(400, 30, 400, 28, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#34231d'; c.lineWidth = 8; c.stroke();
    });
    const tableY = Math.min(0.95, Math.max(0.8, face.chin[1] + face.height));
    sprites.draw(table, { x: 0.5, y: tableY, height: 0.13, maxWidth: 1, outAspect: aspect, alpha });
    const mug = sprites.art('fine-coffee', 240, 200, c => {
      c.strokeStyle = '#fff8e5'; c.lineWidth = 22; c.beginPath(); c.arc(180, 100, 42, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#fff8e5'; c.beginPath(); c.roundRect(20, 35, 160, 150, 22); c.fill();
      c.fillStyle = '#553723'; c.beginPath(); c.ellipse(100, 40, 80, 15, 0, 0, Math.PI * 2); c.fill();
    });
    sprites.draw(mug, { ...common, rotation: 0, x: Math.min(0.85, Math.max(0.15, face.chin[0] + face.width / aspect)), y: tableY - face.width * 0.3, height: face.width * 0.65 });
  }
}
