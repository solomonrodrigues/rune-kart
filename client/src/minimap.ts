// Top-down minimap: the track drawn once onto an offscreen canvas, then karts as dots each frame.
import type { Track } from 'shared/track';

export interface MapKart { x: number; z: number; yaw: number; color: number; me: boolean }

const SIZE = 168; // CSS pixels
const PAD = 14;

export class Minimap {
  private canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private base = document.createElement('canvas');
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private dpr = Math.min(devicePixelRatio, 2);

  constructor(track: Track) {
    const xs = track.samples.map(s => s.x), zs = track.samples.map(s => s.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    this.scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ);
    // Centre the track in the square.
    this.ox = PAD + ((SIZE - PAD * 2) - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oz = PAD + ((SIZE - PAD * 2) - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
    for (const c of [this.canvas, this.base]) { c.width = c.height = SIZE * this.dpr; }
    this.drawTrack(track);
  }

  /** World (x, z) → map pixels. Mirrored in x so the map matches the view from above (three.js +x is left). */
  private at(x: number, z: number): [number, number] {
    return [SIZE - (x * this.scale + this.ox), SIZE - (z * this.scale + this.oz)];
  }

  private drawTrack(track: Track) {
    const g = this.base.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    g.lineJoin = g.lineCap = 'round';
    const path = new Path2D();
    track.samples.forEach((s, i) => { const [px, py] = this.at(s.x, s.z); i ? path.lineTo(px, py) : path.moveTo(px, py); });
    path.closePath();
    const road = Math.max(4, track.def.width * this.scale);
    g.strokeStyle = '#0b0a0e'; g.lineWidth = road + 4; g.stroke(path);   // dark edge
    g.strokeStyle = '#5c5866'; g.lineWidth = road; g.stroke(path);       // road
    g.strokeStyle = '#a77bff55'; g.lineWidth = 1.2; g.stroke(path);      // faint rune line down the middle
    // Start line: a short glowing bar across the road at sample 0.
    const s0 = track.samples[0], [sx, sy] = this.at(s0.x, s0.z);
    g.save();
    g.translate(sx, sy);
    g.rotate(-s0.yaw);
    g.fillStyle = '#c9a8ff';
    g.shadowColor = '#a77bff'; g.shadowBlur = 6;
    g.fillRect(-road / 2 - 1, -1.5, road + 2, 3);
    g.restore();
  }

  draw(karts: MapKart[]) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    g.scale(this.dpr, this.dpr);
    // Others first, you on top.
    for (const k of [...karts].sort((a, b) => Number(a.me) - Number(b.me))) {
      const [px, py] = this.at(k.x, k.z);
      const hex = `#${k.color.toString(16).padStart(6, '0')}`;
      g.save();
      g.translate(px, py);
      if (k.me) {
        // An arrowhead pointing along your heading, outlined so it reads over anything.
        g.rotate(-k.yaw); // yaw 0 faces +z, which is up on the map
        g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath();
        g.fillStyle = hex; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
        g.shadowColor = hex; g.shadowBlur = 8;
        g.fill(); g.stroke();
      } else {
        g.beginPath(); g.arc(0, 0, 3.6, 0, Math.PI * 2);
        g.fillStyle = hex; g.strokeStyle = '#0b0a0e'; g.lineWidth = 1.5;
        g.fill(); g.stroke();
      }
      g.restore();
    }
  }
}
