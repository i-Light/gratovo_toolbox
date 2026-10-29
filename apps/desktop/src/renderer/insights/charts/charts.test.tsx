// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BarList, ShareBar } from "./bars";
import { FlowBand, type FlowNode } from "./flow-band";
import { HeatTable } from "./heat-table";
import { LineChart } from "./line-chart";
import { PairedColumns } from "./paired-columns";
import { SmallMultiples } from "./small-multiples";
import { StepLine } from "./step-line";

afterEach(cleanup);

const noHex = (html: string): void => {
  expect(html).not.toMatch(/#[0-9a-f]{3,8}b/i);
};

describe("LineChart", () => {
  const pts = [
    { at: 0, value: 10 },
    { at: 1, value: 20 },
    { at: 2, value: null },
    { at: 3, value: 15 },
    { at: 4, value: 30 },
  ];

  it("breaks the line at a null and draws one area per piece", () => {
    const { container } = render(<LineChart points={pts} height={120} ariaLabel="Sent" />);
    expect(container.querySelectorAll("path.ch-line__path")).toHaveLength(2);
    expect(container.querySelectorAll("path.ch-line__area")).toHaveLength(2);
    expect(container.querySelector("[data-dot='last']")).not.toBeNull();
    noHex(container.innerHTML);
  });

  it("draws the last point hollow when it is today so far", () => {
    const { container } = render(
      <LineChart points={pts} height={120} lastIsPartial ariaLabel="Sent" />,
    );
    expect(container.querySelector("[data-dot='hollow']")).not.toBeNull();
    expect(container.querySelector("[data-dot='last']")).toBeNull();
  });

  it("shows given labels, ticks and bands, and no words of its own", () => {
    const { container } = render(
      <LineChart
        points={pts}
        height={120}
        xLabels={[
          { at: 0, label: "first" },
          { at: 4, label: "last" },
        ]}
        shaded={[{ from: 1, to: 2 }]}
        ariaLabel="Sent"
      />,
    );
    expect(container.querySelectorAll("[data-x-label]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-band]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-y-tick]").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("img", { name: "Sent" })).toBeTruthy();
  });

  it("copes with no data", () => {
    const { container } = render(<LineChart points={[]} height={80} ariaLabel="none" />);
    expect(container.querySelectorAll("path.ch-line__path")).toHaveLength(0);
  });
});

describe("PairedColumns", () => {
  it("draws two columns per pair on one scale and skips nulls", () => {
    const { container } = render(
      <PairedColumns
        rows={[
          { key: "1", label: "w1", a: 10, b: 5 },
          { key: "2", label: "w2", a: 20, b: null },
        ]}
        legend={{
          a: { label: "Joined", tone: "series-live" },
          b: { label: "Left", tone: "series-waiting" },
        }}
        height={160}
        ariaLabel="Weeks"
      />,
    );
    expect(container.querySelectorAll("[data-col]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-null]")).toHaveLength(1);
    const heights = [...container.querySelectorAll<HTMLElement>("[data-col]")].map((c) =>
      parseFloat(c.style.height),
    );
    expect(heights[0]).toBeGreaterThan(heights[1] ?? 0);
    expect(heights[2] ?? 0).toBeCloseTo((heights[0] ?? 0) * 2, 5);
    expect(screen.getByText("Joined")).toBeTruthy();
    noHex(container.innerHTML);
  });
});

describe("BarList and ShareBar", () => {
  it("scales to its own largest row and makes clickable rows buttons", () => {
    const onClick = vi.fn();
    const { container } = render(
      <BarList
        rows={[
          { key: "a", label: "Interested", value: 46, display: "46", onClick },
          { key: "b", label: "No", value: 23, display: "23", tone: "warn" },
        ]}
      />,
    );
    const bars = container.querySelectorAll<HTMLElement>("[data-bar]");
    expect(bars).toHaveLength(2);
    expect(bars[0]?.style.width).toBe("100%");
    expect(bars[1]?.style.width).toBe("50%");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    noHex(container.innerHTML);
  });

  it("uses a given max for shares", () => {
    const { container } = render(
      <BarList rows={[{ key: "a", label: "x", value: 0.25, display: "25%" }]} max={1} />,
    );
    expect(container.querySelector<HTMLElement>("[data-bar]")?.style.width).toBe("25%");
  });

  it("draws a share and a needed mark", () => {
    const { container } = render(<ShareBar n={3} d={12} neededAt={0.6} ariaLabel="3 of 12" />);
    expect(container.querySelector<HTMLElement>("[data-share-fill]")?.style.width).toBe("25%");
    expect(container.querySelector<HTMLElement>("[data-needed]")?.style.left).toBe("60%");
    expect(screen.getByRole("img", { name: "3 of 12" })).toBeTruthy();
  });

  it("shows an empty bar for a zero denominator", () => {
    const { container } = render(<ShareBar n={0} d={0} ariaLabel="none" />);
    expect(container.querySelector<HTMLElement>("[data-share-fill]")?.style.width).toBe("0%");
    expect(container.querySelector("[data-needed]")).toBeNull();
  });
});

describe("SmallMultiples", () => {
  it("draws one chart per item, each with its title, value and change", () => {
    const mk = (key: string, scale: number) => ({
      key,
      title: key,
      value: String(scale),
      change: `+${String(scale)}`,
      tone: "series-live" as const,
      points: [
        { at: 0, value: scale },
        { at: 1, value: scale * 2 },
      ],
      ariaLabel: `${key} chart`,
    });
    const { container } = render(
      <SmallMultiples items={[mk("Live", 2000), mk("Archive", 150200)]} />,
    );
    expect(container.querySelectorAll("[data-multi]")).toHaveLength(2);
    expect(container.querySelectorAll("path.ch-line__path")).toHaveLength(2);
    expect(screen.getByText("150200")).toBeTruthy();
    expect(screen.getByText("+2000")).toBeTruthy();
    // No y axis words: each chart has its own scale and is not labelled with ticks.
    expect(container.querySelectorAll("[data-y-tick]")).toHaveLength(0);
  });
});

describe("StepLine", () => {
  it("draws a dot per step, a share between each pair and reports the pick", () => {
    const onPick = vi.fn();
    const { container } = render(
      <StepLine
        steps={[
          { key: "a", label: "Found", count: "100", sub: "24 stuck", subTone: "warn" },
          { key: "b", label: "Emailed", count: "50" },
          { key: "c", label: "Signed", count: "5" },
        ]}
        shares={["50%", null]}
        onPick={onPick}
      />,
    );
    expect(container.querySelectorAll("[data-dot]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-link]")).toHaveLength(2);
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("24 stuck")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Emailed/ }));
    expect(onPick).toHaveBeenCalledWith(1);
    noHex(container.innerHTML);
  });
});

describe("HeatTable", () => {
  it("shades light to dark by value and shows null as a dash", () => {
    const { container } = render(
      <HeatTable
        rowLabels={["Week 1", "Week 2"]}
        colLabels={["Day 1", "Day 2"]}
        cells={[
          [0.1, 0.5],
          [0.9, null],
        ]}
        format={(v) => `${String(Math.round(v * 100))}%`}
        ariaLabel="Cohorts"
      />,
    );
    const op = [...container.querySelectorAll<HTMLElement>(".ch-heat__shade")].map((s) =>
      parseFloat(s.style.opacity),
    );
    expect(op).toHaveLength(3);
    expect(op[0] ?? 1).toBeLessThan(op[1] ?? 0);
    expect(op[1] ?? 1).toBeLessThan(op[2] ?? 0);
    expect(container.querySelectorAll(".is-null")).toHaveLength(1);
    expect(container.querySelector(".is-null")?.textContent).toBe("–");
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Day 2" })).toBeTruthy();
    noHex(container.innerHTML);
  });
});

describe("FlowBand", () => {
  const nodes: FlowNode[] = [
    { id: "found", count: 150200, label: "Found", tone: "series-archive", x: 0.1, y: 0.5 },
    {
      id: "live",
      count: 16,
      label: "Live",
      sub: "now",
      tone: "series-live",
      x: 0.6,
      y: 0.3,
      highlight: true,
      onClick: vi.fn(),
      action: { label: "Review", onClick: vi.fn() },
    },
    { id: "gone", count: 0, label: "Gone", tone: "series-waiting", x: 0.9, y: 0.7, dashed: true },
  ];

  it("draws a circle per node, sized by square root and never below the minimum", () => {
    const { container } = render(
      <FlowBand
        nodes={nodes}
        edges={[
          { from: "found", to: "live", tone: "series-live", curved: true, label: "kept" },
          { from: "live", to: "gone", tone: "series-waiting", dashed: true },
          { from: "live", to: "missing", tone: "series-waiting" },
        ]}
        height={240}
        minR={12}
        maxR={50}
        ariaLabel="Flow"
      />,
    );
    const radii = [...container.querySelectorAll("circle")].map((c) => Number(c.getAttribute("r")));
    expect(radii).toHaveLength(3);
    expect(radii[0]).toBe(50);
    expect(radii[1]).toBeGreaterThanOrEqual(12);
    expect(radii[2]).toBe(12);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(2);
    expect(container.querySelectorAll("path.ch-flow__head")).toHaveLength(2);
    expect(screen.getByText("150,200")).toBeTruthy();
    expect(screen.getByText("kept")).toBeTruthy();
    noHex(container.innerHTML);
  });

  it("calls back for a clicked circle and an action", () => {
    const onClick = vi.fn();
    const onAction = vi.fn();
    render(
      <FlowBand
        nodes={[
          {
            id: "a",
            count: 5,
            label: "Not reviewed",
            tone: "warn",
            x: 0.5,
            y: 0.4,
            onClick,
            action: { label: "Review", onClick: onAction },
          },
        ]}
        edges={[]}
        height={200}
        ariaLabel="Flow"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "5 Not reviewed" }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
