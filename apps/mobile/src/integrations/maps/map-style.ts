/**
 * A dark Google Maps style, so the street map sits inside the app's near-black surfaces instead of
 * shining out of them. Roads are a step lighter than the ground, water a cool dark blue, and every
 * label is muted: the route is what the screen is about, and it is drawn on top in the accent
 * colour. Kept in its own file because it is data, not behaviour.
 */
export interface MapStyleRule {
  featureType?: string;
  elementType?: string;
  stylers: Array<Record<string, string | number>>;
}

export const DARK_MAP_STYLE: MapStyleRule[] = [
  { elementType: 'geometry', stylers: [{ color: '#141517' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a82' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#141517' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#26272a' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#181a1c' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#16201a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#22242a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#191a1c' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c2e35' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1c27' }] },
];
