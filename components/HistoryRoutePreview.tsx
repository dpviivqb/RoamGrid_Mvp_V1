"use client";

import { buildGridCells } from "@/lib/grid";
import type { LocationPoint } from "@/lib/types";

export function HistoryCardPreview({
  snapshot,
  blockCount
}: {
  snapshot?: string;
  blockCount: number;
}) {
  if (snapshot) {
    return (
      <div className="relative aspect-[1.75] overflow-hidden rounded-md border border-white/10 bg-slate-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={snapshot} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.02)_42%,rgba(2,6,23,0.52)_100%)]" />
      </div>
    );
  }

  const tileCount = Math.max(4, Math.min(14, blockCount || 4));

  return (
    <div className="relative aspect-[1.75] overflow-hidden rounded-md border border-white/10 bg-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="absolute left-[12%] top-[18%] h-2 w-[76%] rotate-[24deg] rounded-full bg-sky-300/90 shadow-[0_0_22px_rgba(125,211,252,0.72)]" />
      {Array.from({ length: tileCount }).map((_, index) => {
        const column = index % 7;
        const row = Math.floor(index / 7);
        return (
          <div
            key={index}
            className="absolute h-[20%] w-[13%] rounded-sm border border-teal-100/55 bg-teal-300/24 shadow-[0_0_18px_rgba(45,212,191,0.28)]"
            style={{
              left: `${14 + column * 10}%`,
              top: `${22 + row * 24 + (column % 2) * 5}%`
            }}
          />
        );
      })}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.08)_46%,rgba(2,6,23,0.62)_100%)]" />
    </div>
  );
}

export function RoutePreview({
  points,
  fallback,
  staticFallback,
  className = "h-72"
}: {
  points: LocationPoint[];
  fallback: string;
  staticFallback: string;
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <div
        className={`mt-5 grid ${className} place-items-center rounded-lg border border-white/10 bg-slate-950 text-sm text-slate-400`}
      >
        {fallback}
      </div>
    );
  }

  const projected = projectPoints(points);
  const linePoints = projected.map((point) => `${point.x},${point.y}`).join(" ");
  const first = projected[0];
  const last = projected[projected.length - 1];
  const isStatic = calculateProjectedLength(projected) < 14;

  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
      <svg viewBox="0 0 640 360" className={`w-full ${className}`}>
        <defs>
          <pattern id="history-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148, 163, 184, 0.18)" strokeWidth="1" />
          </pattern>
          <filter id="route-glow">
            <feGaussianBlur stdDeviation="5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="640" height="360" fill="url(#history-grid)" />
        <polyline points={linePoints} fill="none" stroke="#67e8f9" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" opacity="0.22" />
        <polyline points={linePoints} fill="none" stroke="#38bdf8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity="1" filter="url(#route-glow)" />
        {projected.map((point, index) => (
          <circle
            key={`${point.x}-${point.y}-${index}`}
            cx={point.x}
            cy={point.y}
            r={index === 0 || index === projected.length - 1 ? 7 : 4}
            fill={index === projected.length - 1 ? "#f0fdfa" : "#5eead4"}
            stroke="#082f49"
            strokeWidth="2"
            opacity={0.95}
          />
        ))}
        <circle cx={first.x} cy={first.y} r="11" fill="none" stroke="#5eead4" strokeWidth="3" />
        <circle cx={last.x} cy={last.y} r="13" fill="none" stroke="#f0fdfa" strokeWidth="3" />
      </svg>
      {isStatic ? (
        <div className="border-t border-white/10 px-4 py-3 text-sm text-slate-400">
          {staticFallback}
        </div>
      ) : null}
    </div>
  );
}

export function GridPreview({ gridIds }: { gridIds: string[] }) {
  const cells = buildGridCells(gridIds.slice(0, 80));
  if (cells.length === 0) {
    return <div className="text-sm text-slate-400">-</div>;
  }

  return (
    <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-5">
      {cells.map((cell) => (
        <div
          key={cell.id}
          className="truncate rounded-md border border-teal-200/20 bg-teal-300/10 px-2 py-2 text-xs font-bold text-teal-100"
          title={cell.id}
        >
          {cell.id}
        </div>
      ))}
    </div>
  );
}

function projectPoints(points: LocationPoint[]) {
  const padding = 28;
  const width = 640;
  const height = 360;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(maxLng - minLng, 0.00001);
  const latSpan = Math.max(maxLat - minLat, 0.00001);

  return points.map((point) => ({
    x: padding + ((point.lng - minLng) / lngSpan) * (width - padding * 2),
    y: height - padding - ((point.lat - minLat) / latSpan) * (height - padding * 2)
  }));
}

function calculateProjectedLength(points: Array<{ x: number; y: number }>) {
  return points.reduce((distance, point, index) => {
    const previous = points[index - 1];
    if (!previous) {
      return distance;
    }

    return distance + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}
