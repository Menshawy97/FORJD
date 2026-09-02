import { computeRingGeometry } from '../concentric-rings';

describe('computeRingGeometry', () => {
  it('steps each ring inward from the previous by strokeWidth + gap', () => {
    const bands = [
      { key: 'calories', filled: 0, color: '#E9712F' },
      { key: 'protein', filled: 0, color: '#C98AD9' },
      { key: 'carbs', filled: 0, color: '#6F9AC9' },
      { key: 'fat', filled: 0, color: '#79B98A' },
    ];

    const geometry = computeRingGeometry(bands, 60, 6, 2);

    expect(geometry.map((ring) => ring.radius)).toEqual([60, 52, 44, 36]);
  });

  it('never overlaps, however many bands are passed', () => {
    const bands = Array.from({ length: 6 }, (_, i) => ({ key: `b${i}`, filled: 0, color: '#fff' }));

    const geometry = computeRingGeometry(bands, 60, 4, 1);

    for (let i = 1; i < geometry.length; i += 1) {
      expect(geometry[i - 1].radius - geometry[i].radius).toBe(5);
    }
  });

  it('computes each ring from its own circumference, not a shared one', () => {
    const bands = [
      { key: 'outer', filled: 0.5, color: '#000' },
      { key: 'inner', filled: 0.5, color: '#000' },
    ];

    const [outer, inner] = computeRingGeometry(bands, 40, 6, 2);

    expect(outer.circumference).toBeCloseTo(2 * Math.PI * 40, 6);
    expect(inner.circumference).toBeCloseTo(2 * Math.PI * 32, 6);
    // Same 50% fill, different radius -> different absolute dashoffset.
    expect(outer.dashoffset).toBeCloseTo(outer.circumference * 0.5, 6);
    expect(inner.dashoffset).toBeCloseTo(inner.circumference * 0.5, 6);
    expect(outer.dashoffset).not.toBeCloseTo(inner.dashoffset, 1);
  });

  it('dashoffset is the full circumference at 0% and 0 at 100%', () => {
    const [empty] = computeRingGeometry([{ key: 'a', filled: 0, color: '#000' }], 20, 4, 0);
    const [full] = computeRingGeometry([{ key: 'a', filled: 1, color: '#000' }], 20, 4, 0);

    expect(empty.dashoffset).toBeCloseTo(empty.circumference, 6);
    expect(full.dashoffset).toBeCloseTo(0, 6);
  });

  it('keeps each ring keyed by its band key, in the same order', () => {
    const bands = [
      { key: 'calories', filled: 0, color: '#a' },
      { key: 'protein', filled: 0, color: '#b' },
    ];

    const geometry = computeRingGeometry(bands, 30, 4, 1);

    expect(geometry.map((ring) => ring.key)).toEqual(['calories', 'protein']);
    expect(geometry.map((ring) => ring.color)).toEqual(['#a', '#b']);
  });
});
