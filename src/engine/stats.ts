/** Counts events per second over a sliding window. */
export class RateMeter {
  private times: number[] = [];
  constructor(private windowMs = 2000) {}

  tick(now: number): void {
    this.times.push(now);
    this.trim(now);
  }

  rate(now: number): number {
    this.trim(now);
    return (this.times.length * 1000) / this.windowMs;
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.times.length && this.times[i]! < cutoff) i++;
    if (i) this.times.splice(0, i);
  }
}

/** Fixed-size ring buffer of samples with percentile queries. */
export class Samples {
  private buf: number[] = [];
  private i = 0;
  constructor(private size = 180) {}

  push(v: number): void {
    if (this.buf.length < this.size) this.buf.push(v);
    else this.buf[this.i] = v;
    this.i = (this.i + 1) % this.size;
  }

  percentile(p: number): number {
    if (!this.buf.length) return 0;
    const sorted = [...this.buf].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  }

  mean(): number {
    return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : 0;
  }

  clear(): void {
    this.buf = [];
    this.i = 0;
  }
}
