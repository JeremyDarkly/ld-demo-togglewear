import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import ShipmentDialog from "@/components/account/ShipmentDialog";
import type { PastOrder } from "@/lib/account";
import { resolveLines } from "@/lib/cart";
import { formatDeliveryDate } from "@/lib/order";
import {
  PING_INTERVAL_MS,
  controlPoint,
  legLengths,
  pointOnArc,
  positionAt,
  project,
  splitArc,
  statusFor,
  type Point,
  type Position,
  type TrackingRoute,
} from "@/lib/tracking";

// Live order tracking, the feature flag 04 is rolling out: the parcel on a
// map, moving as the carrier reports it, above the order history it belongs
// to. Not in Jen's file, so it borrows her vocabulary rather than inventing
// one — the LD Black panel and lime accent of the referral card, the white
// 12px cards of the account page, and the shipment dialog's eyebrow-and-
// answer layout, with the answer (when it arrives) first.

const MAP_HEIGHT = { base: 220, md: 300 };
const MAP_PAD = { x: 64, y: 52 };
const LIME = "#DDFF46";

// When this browser first saw the parcel, kept for the session so the
// position survives leaving the page and coming back.
function useStartedAt(ref: string) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => {
    const key = `togglewear.tracking.${ref}`;
    let saved = Number.NaN;
    try {
      saved = Number(window.sessionStorage.getItem(key));
    } catch {
      // Without storage the parcel simply starts from its last scan.
    }
    if (Number.isFinite(saved) && saved > 0) {
      setStartedAt(saved);
      return;
    }
    const now = Date.now();
    try {
      window.sessionStorage.setItem(key, String(now));
    } catch {
      // As above.
    }
    setStartedAt(now);
  }, [ref]);
  return startedAt;
}

// The clock, a second at a time. Only "updated 4s ago" needs that often; the
// position itself changes once per ping.
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

// The map is drawn at its real pixel size rather than scaled, so the labels
// stay 11px on a phone instead of shrinking with the drawing.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function useMapHeight() {
  const [height, setHeight] = useState(MAP_HEIGHT.base);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setHeight(query.matches ? MAP_HEIGHT.md : MAP_HEIGHT.base);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return height;
}

function arcPath(a: Point, c: Point, b: Point) {
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

function RouteMap({
  route,
  position,
  width,
  height,
}: {
  route: TrackingRoute;
  position: Position;
  width: number;
  height: number;
}) {
  const points = project(route.stops, width, height, MAP_PAD);
  const legs = points.slice(1).map((end, i) => {
    const start = points[i];
    return { start, control: controlPoint(start, end), end };
  });

  const current = legs[position.leg];
  const partial = splitArc(current.start, current.control, current.end, position.along);
  const marker = pointOnArc(current.start, current.control, current.end, position.along);
  const travelled = [
    ...legs.slice(0, position.leg).map((l) => arcPath(l.start, l.control, l.end)),
    arcPath(current.start, partial.control, partial.end),
  ].join(" ");

  const last = route.stops.length - 1;

  // At most four names on the map, in this order of importance: where it is
  // going, where it started, and the two stops either side of it now. A name
  // that would overlap one already placed is left off — two stops close
  // together, like Cologne and Amsterdam, otherwise print on top of each
  // other.
  //
  // Names sit above their stop, except on a route that mostly runs north to
  // south, where above is where the line is, so they sit to the right.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const northSouth =
    Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
  // 11px uppercase Söhne Mono with its letter-spacing, per character.
  const CHAR_WIDTH = 7.4;
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const labels: { i: number; x: number; y: number; anchor: "start" | "middle" | "end" }[] = [];
  for (const i of [last, 0, position.leg + 1, position.leg]) {
    if (labels.some((l) => l.i === i)) continue;
    const p = points[i];
    const textWidth = route.stops[i].city.length * CHAR_WIDTH;
    const anchor = northSouth
      ? "start"
      : p.x < textWidth / 2 + 8
        ? "start"
        : p.x > width - textWidth / 2 - 8
          ? "end"
          : "middle";
    const x = northSouth ? p.x + 14 : p.x;
    const y = northSouth ? p.y + 4 : p.y - 14;
    const x0 = anchor === "start" ? x : anchor === "end" ? x - textWidth : x - textWidth / 2;
    const box = { x0: x0 - 4, x1: x0 + textWidth + 4, y0: y - 12, y1: y + 4 };
    const overlaps = placed.some(
      (b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0,
    );
    if (overlaps) continue;
    placed.push(box);
    labels.push({ i, x, y, anchor });
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Route from ${route.stops[0].city} to ${route.stops[last].city}. ${statusFor(route, position)}.`}
      className="block"
    >
      <defs>
        <filter id="route-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* The road ahead, dashed: planned, not promised. */}
      {legs.map((l, i) => (
        <path
          key={`ahead-${i}`}
          d={arcPath(l.start, l.control, l.end)}
          fill="none"
          stroke="#6D6E71"
          strokeWidth={1.5}
          strokeDasharray="3 6"
          strokeLinecap="round"
        />
      ))}

      {/* The road behind, solid lime with a soft glow under it. */}
      <path
        d={travelled}
        fill="none"
        stroke={LIME}
        strokeOpacity={0.35}
        strokeWidth={6}
        filter="url(#route-glow)"
      />
      <path
        d={travelled}
        fill="none"
        stroke={LIME}
        strokeWidth={2}
        strokeLinecap="round"
      />

      {points.map((p, i) => {
        const passed = i <= position.leg;
        const isEnd = i === last;
        return (
          <g key={route.stops[i].city}>
            {isEnd && (
              <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="#A7A9AC" strokeOpacity={0.5} />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={i === 0 || isEnd ? 4.5 : 3.5}
              fill={passed ? LIME : "#191919"}
              stroke={passed ? LIME : "#A7A9AC"}
              strokeWidth={1.5}
            />
          </g>
        );
      })}

      {/* Drawn after every stop and line, with an outline in the map's own
          black, so a route passing under a name never cuts through it. */}
      {labels.map(({ i, x, y, anchor }) => (
        <text
          key={`label-${i}`}
          x={x}
          y={y}
          textAnchor={anchor}
          stroke="#191919"
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
          className={`font-sohne-mono text-[11px] uppercase tracking-[0.6px] ${
            i === last ? "fill-grays-white" : "fill-grays-03"
          }`}
        >
          {route.stops[i].city}
        </text>
      ))}

      {/* The parcel. Glides to each new report rather than jumping. */}
      <g
        style={{
          transform: `translate(${marker.x}px, ${marker.y}px)`,
          transition: "transform 1.2s ease-in-out",
        }}
        className="motion-reduce:!transition-none"
      >
        <circle r={16} fill={LIME} opacity={0.14} />
        <circle
          r={8}
          fill={LIME}
          className="animate-ping motion-reduce:hidden"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          opacity={0.6}
        />
        <circle r={8} fill={LIME} stroke="#191919" strokeWidth={3} />
      </g>
    </svg>
  );
}

function formatDistance(value: number, unit: TrackingRoute["unit"]) {
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="font-sohne text-xsmall-caps font-medium uppercase text-grays-04">
        {label}
      </p>
      <p className="font-sohne text-h6 font-medium text-grays-ld-black">{value}</p>
      <p className="font-sohne text-small text-grays-04">{detail}</p>
    </div>
  );
}

export default function LiveTracking({ order }: { order: PastOrder }) {
  const route = order.route as TrackingRoute;
  const startedAt = useStartedAt(order.ref);
  const now = useNow();
  const [mapRef, width] = useWidth<HTMLDivElement>();
  const height = useMapHeight();
  const [detailOpen, setDetailOpen] = useState(false);

  const lastScan = order.events[order.events.length - 1].where;
  const elapsed = startedAt !== null && now !== null ? now - startedAt : 0;
  const position = positionAt(route, lastScan, elapsed);
  const total = legLengths(route).reduce((sum, km) => sum + km, 0);
  const totalInUnit = route.unit === "mi" ? total / 1.609344 : total;

  const sinceReport = Math.floor(
    (elapsed - position.pings * PING_INTERVAL_MS) / 1000,
  );
  const updated = sinceReport < 2 ? "Updated just now" : `Updated ${sinceReport}s ago`;
  const lines = resolveLines(order.lines);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
          Live Tracking
        </h2>
        <span className="rounded-full bg-base-lime px-2.5 py-1 font-geist text-[10px] font-semibold uppercase leading-none tracking-[1px] text-grays-ld-black">
          Beta
        </span>
      </div>

      <article className="overflow-hidden rounded-[12px] bg-grays-white">
        <div
          ref={mapRef}
          className="relative w-full bg-grays-ld-black bg-[radial-gradient(circle,#2C2C2C_1px,transparent_1.5px)] bg-[length:18px_18px]"
          style={{ height }}
        >
          {width > 0 && startedAt !== null && (
            <RouteMap route={route} position={position} width={width} height={height} />
          )}

          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-grays-black-01/80 px-3 py-1.5 backdrop-blur-sm">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-base-lime opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-base-lime" />
            </span>
            <span className="font-geist text-[11px] font-semibold uppercase tracking-[1.2px] text-grays-white">
              Live
            </span>
          </div>
          <p className="absolute right-4 top-4 rounded-full bg-grays-black-01/80 px-3 py-1.5 font-sohne-mono text-[11px] text-grays-03 backdrop-blur-sm">
            {updated}
          </p>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-3">
          <Stat
            label="Arriving"
            value={formatDeliveryDate(order.arrivesOn)}
            detail={`to ${order.destination}`}
          />
          <Stat
            label="Distance left"
            value={formatDistance(position.remaining, route.unit)}
            detail={`of ${formatDistance(totalInUnit, route.unit)}`}
          />
          <Stat
            label="Latest"
            value="In transit"
            detail={statusFor(route, position)}
          />
        </div>

        <div className="flex flex-col gap-4 border-t border-grays-hairline px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex shrink-0 -space-x-3">
              {lines.map((line) => (
                <div
                  key={`${line.slug}__${line.size}`}
                  className="relative h-[50px] w-10 overflow-hidden rounded-[4px] bg-grays-01 ring-2 ring-grays-white"
                >
                  <Image
                    src={line.product.image}
                    alt={line.product.name}
                    fill
                    sizes="40px"
                    className="object-contain"
                  />
                </div>
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-sohne text-small font-medium text-grays-ld-black">
                {order.ref}
              </p>
              <p className="truncate font-sohne text-xsmall text-grays-04">
                {order.carrier} · {order.tracking}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="flex shrink-0 items-center gap-2 self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2 sm:self-auto"
          >
            <img
              src="/icons/truck.svg"
              alt=""
              width={24}
              height={24}
              className="shrink-0 max-w-none"
            />
            <span className="font-sohne text-small text-base-blue hover:underline">
              View shipment details
            </span>
          </button>
        </div>
      </article>

      {detailOpen && (
        <ShipmentDialog order={order} onClose={() => setDetailOpen(false)} />
      )}
    </section>
  );
}
