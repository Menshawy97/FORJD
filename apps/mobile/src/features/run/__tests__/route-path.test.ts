// The run share card's route line (docs/product/run-share-card-plan.md; replica approved 2026-10-14): the GPS track
// as an SVG path fitted to the card, its shape kept, with no map under it.
import { routeLinePath } from '../route-path';

describe('routeLinePath', () => {
  it('draws a north-to-south route as a vertical line, centred, top to bottom', () => {
    const line = routeLinePath(
      [
        { latitude: 30.02, longitude: 31.2 },
        { latitude: 30.0, longitude: 31.2 },
      ],
      200,
      120,
      10,
    );

    expect(line).not.toBeNull();
    expect(line!.start).toEqual({ x: 100, y: 10 });
    expect(line!.end).toEqual({ x: 100, y: 110 });
    expect(line!.d).toBe('M100 10 L100 110');
  });

  it('keeps the shape: a square route stays square inside a wide card', () => {
    // At the equator a degree of longitude equals a degree of latitude.
    const line = routeLinePath(
      [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0.01 },
        { latitude: 0.01, longitude: 0.01 },
      ],
      200,
      120,
      10,
    )!;

    // Fitted to the 100-unit height: 100 wide, centred in the 200 width.
    expect(line.start).toEqual({ x: 50, y: 110 });
    expect(line.end).toEqual({ x: 150, y: 10 });
  });

  it('draws nothing for fewer than two distinct points', () => {
    expect(routeLinePath([], 200, 120)).toBeNull();
    expect(routeLinePath([{ latitude: 30, longitude: 31 }], 200, 120)).toBeNull();
    expect(
      routeLinePath(
        [
          { latitude: 30, longitude: 31 },
          { latitude: 30, longitude: 31 },
        ],
        200,
        120,
      ),
    ).toBeNull();
  });
});
