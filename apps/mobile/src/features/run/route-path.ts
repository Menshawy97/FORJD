/**
 * The run share card's route line (docs/product/run-share-card-plan.md; replica approved 2026-10-14): the GPS track as
 * an SVG path fitted inside a `width` × `height` box with `pad` on every side, its shape kept. Longitude is scaled by the
 * cosine of the route's mean latitude, so a square block draws square away from the equator too. North is up. Pure:
 * no map, so no street names reach the card.
 */
export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteLine {
  /** `M x y L x y …`, for an SVG `<Path d>`. */
  d: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** `null` when there are fewer than two distinct points: a dot is not a route. */
export function routeLinePath(points: readonly RoutePoint[], width: number, height: number, pad = 8): RouteLine | null {
  if (points.length < 2) return null;
  const meanLatitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const xScale = Math.cos((meanLatitude * Math.PI) / 180);
  const projected = points.map((point) => ({ x: point.longitude * xScale, y: point.latitude }));

  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = maxY - Math.min(...ys);
  if (spanX === 0 && spanY === 0) return null;

  const innerWidth = width - 2 * pad;
  const innerHeight = height - 2 * pad;
  const scale = Math.min(spanX > 0 ? innerWidth / spanX : Infinity, spanY > 0 ? innerHeight / spanY : Infinity);
  const offsetX = pad + (innerWidth - spanX * scale) / 2;
  const offsetY = pad + (innerHeight - spanY * scale) / 2;

  const drawn = projected.map((point) => ({
    x: round(offsetX + (point.x - minX) * scale),
    y: round(offsetY + (maxY - point.y) * scale),
  }));
  const d = drawn.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  return { d, start: drawn[0]!, end: drawn[drawn.length - 1]! };
}
