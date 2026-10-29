/* Numbers in template strings here are SVG and CSS geometry, never user words. */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { useEffect, useRef, useState } from "react";

import { sqrtRadius } from "./scale";
import { toneStyle, toneVar, type Tone } from "./tone";
import "./charts.css";

export interface FlowNode {
  id: string;
  count: number;
  label: string;
  sub?: string;
  tone: Tone;
  /** Position of the circle's centre: x across the width, y down the height, both 0..1. */
  x: number;
  y: number;
  dashed?: boolean;
  highlight?: boolean;
  action?: { label: string; onClick: () => void };
  onClick?: () => void;
}

export interface FlowEdge {
  from: string;
  to: string;
  curved?: boolean;
  tone: Tone;
  dashed?: boolean;
  label?: string;
}

export interface FlowBandProps {
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  /** Height in px of the drawing area; labels sit under each circle inside it. */
  height: number;
  minR?: number;
  maxR?: number;
  formatCount?: (n: number) => string;
  ariaLabel: string;
}

const DEFAULT_WIDTH = 960;
const ARROW = 7;
const defaultFormat = (n: number): string => n.toLocaleString("en-US");

export function FlowBand({
  nodes,
  edges,
  height,
  minR = 14,
  maxR = 48,
  formatCount = defaultFormat,
  ariaLabel,
}: FlowBandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const maxCount = Math.max(0, ...nodes.map((n) => n.count));
  const placed = new Map(
    nodes.map((n) => [
      n.id,
      { node: n, cx: n.x * width, cy: n.y * height, r: sqrtRadius(n.count, maxCount, minR, maxR) },
    ]),
  );

  return (
    <div ref={ref} className="ch-flow" style={{ height }} role="group" aria-label={ariaLabel}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {edges.map((e, i) => {
          const a = placed.get(e.from);
          const b = placed.get(e.to);
          if (!a || !b) return null;
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const sx = a.cx + ux * (a.r + 3);
          const sy = a.cy + uy * (a.r + 3);
          const ex = b.cx - ux * (b.r + 4);
          const ey = b.cy - uy * (b.r + 4);
          let d = `M${sx} ${sy} L${ex} ${ey}`;
          let tx = ux;
          let ty = uy;
          if (e.curved && Math.abs(dx) > 1) {
            const half = (ex - sx) / 2;
            d = `M${sx} ${sy} C${sx + half} ${sy} ${ex - half} ${ey} ${ex} ${ey}`;
            tx = Math.sign(half) || ux;
            ty = 0;
          }
          const mx = (sx + ex) / 2;
          const my = (sy + ey) / 2;
          const px = -ty;
          const py = tx;
          const head = `M${ex} ${ey} L${ex - tx * ARROW + px * ARROW * 0.5} ${ey - ty * ARROW + py * ARROW * 0.5} L${ex - tx * ARROW - px * ARROW * 0.5} ${ey - ty * ARROW - py * ARROW * 0.5} Z`;
          return (
            <g key={i} data-edge="" style={toneStyle(e.tone)}>
              <path
                className="ch-flow__edge"
                d={d}
                {...(e.dashed ? { strokeDasharray: "4 4" } : {})}
              />
              <path className="ch-flow__head" d={head} />
              {e.label ? (
                <text className="ch-flow__edge-label" x={mx} y={my - 8} textAnchor="middle">
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {[...placed.values()].map(({ node, cx, cy, r }) => (
          <circle
            key={node.id}
            className="ch-flow__circle"
            data-node-circle={node.id}
            cx={cx}
            cy={cy}
            r={r}
            {...(node.dashed ? { strokeDasharray: "4 4" } : {})}
            strokeWidth={node.highlight ? 3 : 1.5}
            style={{ stroke: toneVar(node.tone), fill: toneVar(node.tone) }}
          />
        ))}
      </svg>
      {[...placed.values()].map(({ node, cx, cy, r }) => (
        <div
          key={node.id}
          className="ch-flow__node"
          data-node={node.id}
          style={toneStyle(node.tone, { left: cx, top: cy })}
        >
          {node.onClick ? (
            <button
              type="button"
              className="ch-flow__hit"
              style={{ width: r * 2, height: r * 2 }}
              onClick={node.onClick}
              aria-label={`${formatCount(node.count)} ${node.label}`}
            />
          ) : null}
          <div className="ch-flow__text" style={{ top: r + 6 }}>
            <span className="ch-flow__count">{formatCount(node.count)}</span>
            <span className="ch-flow__name">{node.label}</span>
            {node.sub ? <span className="ch-flow__sub">{node.sub}</span> : null}
            {node.action ? (
              <button type="button" className="ch-flow__action" onClick={node.action.onClick}>
                {node.action.label}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
