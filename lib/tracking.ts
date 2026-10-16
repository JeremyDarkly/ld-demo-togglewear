// The geometry behind live order tracking (flag 04): where a parcel is along
// its route, how far it has left, and how to draw the route without a map
// service. There are no map tiles — the stops are projected straight onto
// the panel, which keeps their real positions relative to each other and
// needs nothing from outside the app.

export type Stop = { city: string; lat: number; lon: number };

export type TrackingRoute = {
  // Miles for a US delivery, kilometres for one abroad, as the carrier
  // would show it to the person it is going to.
  unit: "mi" | "km";
  stops: Stop[];
};

// How often the carrier reports a position, and how far the parcel moves
// between reports, as a share of the whole route. Far faster than a truck:
// a demo lasts minutes, and a marker that never visibly moves is not live.
export const PING_INTERVAL_MS = 6000;
const STEP_SHARE = 0.0035;
// It stops short of the door, so the demo never ends in a delivery that has
// no delivery scan to go with it.
const MAX_SHARE = 0.97;

const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.609344;

function distanceKm(a: Stop, b: Stop) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function legLengths(route: TrackingRoute) {
  return route.stops
    .slice(1)
    .map((stop, i) => distanceKm(route.stops[i], stop));
}

export type Position = {
  // The leg the parcel is on, from stops[leg] to stops[leg + 1].
  leg: number;
  // How far along that leg, from 0 to 1.
  along: number;
  remaining: number;
  // Reports received since tracking began, which is what dates the last one.
  pings: number;
};

// Where the parcel is, worked out from the clock rather than kept in state, so
// leaving the page or reloading it does not send the parcel back to where it
// started. It sets off a quarter of the way past the last stop the carrier
// scanned it at, which is what the order history says it has reached.
export function positionAt(
  route: TrackingRoute,
  lastScannedAt: string,
  elapsedMs: number,
): Position {
  const legs = legLengths(route);
  const total = legs.reduce((sum, km) => sum + km, 0);
  const scanned = Math.max(
    0,
    Math.min(
      route.stops.findIndex((stop) => stop.city === lastScannedAt),
      legs.length - 1,
    ),
  );

  const before = legs.slice(0, scanned).reduce((sum, km) => sum + km, 0);
  const pings = Math.floor(elapsedMs / PING_INTERVAL_MS);
  const travelled = Math.min(
    before + legs[scanned] * 0.25 + pings * STEP_SHARE * total,
    total * MAX_SHARE,
  );

  let leg = 0;
  let start = 0;
  while (leg < legs.length - 1 && travelled > start + legs[leg]) {
    start += legs[leg];
    leg += 1;
  }

  const remainingKm = total - travelled;
  return {
    leg,
    along: (travelled - start) / legs[leg],
    remaining:
      route.unit === "mi" ? remainingKm / KM_PER_MILE : remainingKm,
    pings,
  };
}

// One line about where the parcel is, the way a carrier phrases it.
export function statusFor(route: TrackingRoute, position: Position) {
  const from = route.stops[position.leg].city;
  const to = route.stops[position.leg + 1].city;
  if (position.along < 0.15) return `Departed ${from}`;
  if (position.along > 0.8) return `Approaching ${to}`;
  return `Between ${from} and ${to}`;
}

export type Point = { x: number; y: number };

// Projects the stops into a width x height box, keeping their shape: an
// equirectangular projection, with longitude narrowed by the cosine of the
// route's middle latitude so a route across the north is not stretched.
export function project(
  stops: Stop[],
  width: number,
  height: number,
  pad: { x: number; y: number },
): Point[] {
  const midLat =
    ((Math.min(...stops.map((s) => s.lat)) +
      Math.max(...stops.map((s) => s.lat))) /
      2) *
    (Math.PI / 180);
  const raw = stops.map((s) => ({ x: s.lon * Math.cos(midLat), y: -s.lat }));
  const minX = Math.min(...raw.map((p) => p.x));
  const maxX = Math.max(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  const maxY = Math.max(...raw.map((p) => p.y));

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min(
    (width - pad.x * 2) / spanX,
    (height - pad.y * 2) / spanY,
  );
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return raw.map((p) => ({
    x: offsetX + (p.x - minX) * scale,
    y: offsetY + (p.y - minY) * scale,
  }));
}

// Each leg is drawn as a shallow arc rather than a straight line, the way
// routes are drawn on carrier maps. The control point sits off the middle of
// the leg, always bowing the same way, by a fixed share of its length.
export function controlPoint(a: Point, b: Point): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bow = 0.12;
  return { x: mx + dy * bow, y: my - dx * bow };
}

export function pointOnArc(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

// The first t of an arc, as an arc of its own (de Casteljau), which is how
// the travelled part of the current leg is drawn.
export function splitArc(a: Point, c: Point, b: Point, t: number) {
  const c1 = { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t };
  const end = pointOnArc(a, c, b, t);
  return { control: c1, end };
}
