// The route is drawn from GPS points into a fixed-size box. This is the arithmetic: fit the route
// into the box with padding, keep its shape (never stretch), and shrink a degree of longitude by
// the cosine of the latitude so a route in Oslo is not drawn wider than the runner ran.
import { projectRoute } from '../project-route';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('projectRoute', () => {
  const box = { width: 340, height: 206, padding: 20 };

  it('projects nothing for no points', () => {
    expect(projectRoute([], box)).toEqual([]);
  });

  it('centres a single point', () => {
    expect(projectRoute([point(31.2, 29.9)], box)).toEqual([{ x: 170, y: 103 }]);
  });

  it('keeps every projected point inside the padded box', () => {
    const route = [point(31.2, 29.9), point(31.21, 29.92), point(31.205, 29.95), point(31.22, 29.93)];
    for (const { x, y } of projectRoute(route, box)) {
      expect(x).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(x).toBeLessThanOrEqual(340 - 20 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(y).toBeLessThanOrEqual(206 - 20 + 1e-9);
    }
  });

  it('puts north at the top: a point further north has a smaller y', () => {
    const [south, north] = projectRoute([point(31.2, 29.9), point(31.21, 29.9)], box);
    expect(north?.y).toBeLessThan(south?.y ?? 0);
  });

  it('puts east at the right: a point further east has a larger x', () => {
    const [west, east] = projectRoute([point(31.2, 29.9), point(31.2, 29.91)], box);
    expect(east?.x).toBeGreaterThan(west?.x ?? 0);
  });

  it('never stretches: a square patch of ground stays square', () => {
    // 0.01 degrees north is 1,112 m; at the equator 0.01 degrees east is the same.
    const [a, b, c] = projectRoute([point(0, 0), point(0.01, 0), point(0, 0.01)], box);
    const northSpan = Math.abs((a?.y ?? 0) - (b?.y ?? 0));
    const eastSpan = Math.abs((c?.x ?? 0) - (a?.x ?? 0));
    expect(northSpan).toBeCloseTo(eastSpan, 3);
  });

  it('shrinks longitude by the cosine of the latitude', () => {
    // At 60 degrees north a degree of longitude is half a degree of latitude on the ground.
    const [a, b, c] = projectRoute([point(60, 0), point(60.01, 0), point(60, 0.01)], box);
    const northSpan = Math.abs((a?.y ?? 0) - (b?.y ?? 0));
    const eastSpan = Math.abs((c?.x ?? 0) - (a?.x ?? 0));
    expect(eastSpan).toBeCloseTo(northSpan * 0.5, 1);
  });

  it('centres a route that is wider than it is tall, and vice versa', () => {
    const wide = projectRoute([point(0, 0), point(0, 0.02)], box);
    const ys = wide.map((p) => p.y);
    expect(ys[0]).toBeCloseTo(103, 6);
    expect(ys[1]).toBeCloseTo(103, 6);

    const tall = projectRoute([point(0, 0), point(0.02, 0)], box);
    const xs = tall.map((p) => p.x);
    expect(xs[0]).toBeCloseTo(170, 6);
  });

  it('handles a route that never moved: every point lands in the centre', () => {
    expect(projectRoute([point(31.2, 29.9), point(31.2, 29.9)], box)).toEqual([
      { x: 170, y: 103 },
      { x: 170, y: 103 },
    ]);
  });

  it('ignores points that are not finite numbers', () => {
    const projected = projectRoute([point(31.2, 29.9), point(NaN, 29.9), point(31.21, 29.92)], box);
    expect(projected).toHaveLength(2);
    expect(projected.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
