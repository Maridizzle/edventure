import { describe, expect, it } from 'vitest';
import { PaintMask, PAINT_THRESHOLD } from './PaintMask';
import { AreaTransform } from '../core/AreaTransform';

describe('AreaTransform', () => {
  it('round-trips world <-> cell', () => {
    const t = AreaTransform.centered(100, 256);
    expect(t.cellX(t.originX)).toBeCloseTo(0, 10);
    expect(t.cellX(t.originX + t.worldSize)).toBeCloseTo(256, 10);
    expect(t.cellZ(t.originZ)).toBeCloseTo(0, 10);
    for (const wx of [-50, -13.7, 0, 4.2, 49.9]) {
      expect(t.worldX(t.cellX(wx))).toBeCloseTo(wx, 10);
    }
  });

  it('agrees with the shader uv mapping', () => {
    // The shader computes (world - uMaskOrigin) * uMaskInvSize and expects uv
    // in 0..1. If this drifts from cellX/cellZ, paint lands offset from the ball.
    const t = AreaTransform.centered(100, 192);
    const u = t.uniforms();
    for (const wx of [-50, -20, 0, 33.3, 50]) {
      const shaderUv = (wx - u.uMaskOrigin.x) * u.uMaskInvSize;
      expect(shaderUv).toBeCloseTo(t.cellX(wx) / t.cells, 10);
    }
  });

  it('converts brush radius from metres to cells', () => {
    const t = AreaTransform.centered(100, 256);
    expect(t.radiusCells(1.8)).toBeCloseTo(4.608, 5);
  });
});

describe('PaintMask', () => {
  it('starts empty', () => {
    const m = new PaintMask(64);
    m.setAllPaintable();
    expect(m.coverage).toBe(0);
    expect(m.paintableCount).toBe(64 * 64);
  });

  it('keeps the incremental counter equal to a full rescan', () => {
    const m = new PaintMask(64);
    m.setAllPaintable();
    for (let i = 0; i < 40; i++) {
      m.stamp(8 + i * 1.1, 20 + Math.sin(i) * 9, 5);
    }
    const incremental = m.paintedCount;
    expect(m.recountPainted()).toBe(incremental);
    expect(incremental).toBeGreaterThan(0);
  });

  it('is monotonic — paint never decreases', () => {
    const m = new PaintMask(64);
    m.setAllPaintable();
    m.stamp(32, 32, 8);
    const snapshot = Uint8Array.from(m.rg);
    const before = m.paintedCount;

    // A weaker overlapping stamp must not erode what is already there.
    m.stamp(34, 32, 3);
    for (let i = 0; i < m.rg.length; i += 2) {
      expect(m.rg[i]!).toBeGreaterThanOrEqual(snapshot[i]!);
    }
    expect(m.paintedCount).toBeGreaterThanOrEqual(before);
  });

  it('only counts cells that are paintable', () => {
    const m = new PaintMask(32);
    const paintable = new Uint8Array(32 * 32);
    // Only the left half is reachable.
    for (let z = 0; z < 32; z++) for (let x = 0; x < 16; x++) paintable[z * 32 + x] = 1;
    m.setPaintableFrom(paintable);
    expect(m.paintableCount).toBe(16 * 32);

    m.stamp(24, 16, 6); // entirely inside the unreachable half
    expect(m.paintedCount).toBe(0);
    expect(m.recountPainted()).toBe(0);

    m.stamp(6, 16, 5);
    expect(m.paintedCount).toBeGreaterThan(0);
  });

  it('reaches full coverage when the whole area is painted', () => {
    const m = new PaintMask(32);
    m.setAllPaintable();
    for (let z = 0; z < 32; z += 2) for (let x = 0; x < 32; x += 2) m.stamp(x, z, 4);
    expect(m.coverage).toBeCloseTo(1, 5);
  });

  it('leaves no gaps when sweeping a fast segment', () => {
    const m = new PaintMask(64);
    m.setAllPaintable();
    // A jump far larger than one frame of movement.
    m.stampSegment(4, 32, 60, 32, 3);
    for (let x = 6; x < 58; x++) {
      const i = 32 * 64 + x;
      expect(m.rg[i << 1]!).toBeGreaterThanOrEqual(PAINT_THRESHOLD);
    }
  });

  it('clamps stamps at the mask edge without wrapping', () => {
    const m = new PaintMask(32);
    m.setAllPaintable();
    m.stamp(0, 0, 6);
    // The opposite corner must be untouched — a wrap bug would paint it.
    expect(m.rg[(31 * 32 + 31) << 1]!).toBe(0);
  });

  it('decays freshness without touching paint amount', () => {
    const m = new PaintMask(32);
    m.setAllPaintable();
    m.stamp(16, 16, 5);
    const amount = m.rg[(16 * 32 + 16) << 1]!;
    for (let i = 0; i < 80; i++) m.decayPulse();
    expect(m.rg[(16 * 32 + 16) << 1]!).toBe(amount);
    expect(m.rg[((16 * 32 + 16) << 1) + 1]!).toBe(0);
  });
});
