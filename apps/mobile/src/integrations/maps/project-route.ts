/**
 * Fits a run's GPS points into a fixed-size box, for drawing the route where there is no street map
 * (ADR-050): the striped fallback, and any place a route is drawn as a plain line.
 *
 * Pure arithmetic, no map SDK. The projection is equirectangular around the route's own middle
 * latitude: a degree of longitude is shortened by the cosine of that latitude, so the route keeps
 * its true shape (a run in Oslo is not drawn wider than the runner ran), and it is never stretched
 * to fill the box. North is up.
 */
export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface ProjectionBox {
  width: number;
  height: number;
  /** Kept clear on every side, so a marker at the edge is not clipped. */
  padding: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

const isFinitePoint = (point: RoutePoint): boolean =>
  Number.isFinite(point.latitude) && Number.isFinite(point.longitude);

/**
 * The points as box coordinates, in order. Points that are not finite numbers are left out, so the
 * result can be shorter than the input. A route that never moved lands every point in the centre.
 */
export function projectRoute(points: readonly RoutePoint[], box: ProjectionBox): ProjectedPoint[] {
  const usable = points.filter(isFinitePoint);
  const centreX = box.width / 2;
  const centreY = box.height / 2;
  if (usable.length === 0) {
    return [];
  }

  const latitudes = usable.map((point) => point.latitude);
  const longitudes = usable.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const midLat = (minLat + maxLat) / 2;
  const midLon = (minLon + maxLon) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  const spanX = (maxLon - minLon) * lonScale;
  const spanY = maxLat - minLat;
  const innerWidth = Math.max(0, box.width - box.padding * 2);
  const innerHeight = Math.max(0, box.height - box.padding * 2);

  const scaleX = spanX > 0 ? innerWidth / spanX : Infinity;
  const scaleY = spanY > 0 ? innerHeight / spanY : Infinity;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) {
    return usable.map(() => ({ x: centreX, y: centreY }));
  }

  return usable.map((point) => ({
    x: centreX + (point.longitude - midLon) * lonScale * scale,
    y: centreY - (point.latitude - midLat) * scale,
  }));
}
