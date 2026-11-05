/**
 * Uppskattar kamerans egen rörelse (handhållen telefon) genom att jämföra två små gråskalebilder.
 * Ger bildinnehållets förflyttning i videopixlar/sekund, så att objektens fart kan räknas relativt omgivningen.
 */
export type CamState = 'stilla' | 'rör sig' | 'snabb rörelse';

const W = 64;
const H = 48;
const R = 5; // sökradie i småbildspixlar

export class EgoMotion {
  private prev: Float32Array | null = null;
  private prevT = 0;
  private canvas = document.createElement('canvas');
  vx = 0; // innehållets rörelse, videopixlar/s
  vy = 0;
  state: CamState = 'stilla';

  reset() {
    this.prev = null;
    this.vx = this.vy = 0;
    this.state = 'stilla';
  }

  update(video: HTMLVideoElement, t: number) {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !video.videoWidth) return;
    this.canvas.width = W;
    this.canvas.height = H;
    ctx.drawImage(video, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const cur = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) cur[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

    if (this.prev && t > this.prevT) {
      const prev = this.prev;
      let best = Infinity, bx = 0, by = 0;
      for (let sy = -R; sy <= R; sy++) {
        for (let sx = -R; sx <= R; sx++) {
          let sad = 0, n = 0;
          for (let y = R; y < H - R; y += 2) {
            for (let x = R; x < W - R; x += 2) {
              sad += Math.abs(cur[y * W + x] - prev[(y - sy) * W + (x - sx)]);
              n++;
            }
          }
          sad /= n;
          if (sad < best) { best = sad; bx = sx; by = sy; }
        }
      }
      const dt = (t - this.prevT) / 1000;
      const scale = video.videoWidth / W;
      const a = 0.4;
      this.vx += a * ((bx * scale) / dt - this.vx);
      this.vy += a * ((by * scale) / dt - this.vy);
      const rel = Math.hypot(this.vx, this.vy) / video.videoWidth; // bildbredder per sekund
      this.state = rel < 0.04 ? 'stilla' : rel < 0.3 ? 'rör sig' : 'snabb rörelse';
    }
    this.prev = cur;
    this.prevT = t;
  }
}
