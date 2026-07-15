import type { DataChartInput, DataRecord } from "./schemas";

const PALETTE = ["#8B5CF6", "#22C55E", "#F97316", "#06B6D4"] as const;
const GRID_LINES = 5;

export interface ChartPoint {
  label: string;
  values: number[];
}

interface ChartLayout {
  bottom: number;
  left: number;
  plotHeight: number;
  plotWidth: number;
  right: number;
  top: number;
}

interface YDomain {
  max: number;
  min: number;
  range: number;
}

export function renderChartSvg(input: DataChartInput, points: readonly ChartPoint[]): string {
  const layout = chartLayout(input);
  const domain = yDomain(points);
  const description = `${input.chartType} chart of ${input.yKeys.join(", ")} by ${input.xKey}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" role="img" aria-labelledby="chart-title chart-description">`,
    `<title id="chart-title">${escapeXml(input.title)}</title>`,
    `<desc id="chart-description">${escapeXml(description)}</desc>`,
    `<rect width="100%" height="100%" rx="16" fill="#0B1020"/>`,
    `<text x="${layout.left}" y="32" fill="#F8FAFC" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="600">${escapeXml(input.title)}</text>`,
    renderLegend(input, layout),
    renderGrid(layout, domain),
    renderSeries(input, points, layout, domain),
    renderXAxis(input, points, layout),
    `<text x="${layout.left - 46}" y="${layout.top + layout.plotHeight / 2}" fill="#8EA0BA" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" text-anchor="middle" transform="rotate(-90 ${layout.left - 46} ${layout.top + layout.plotHeight / 2})">value</text>`,
    "</svg>",
  ].join("");
}

export function buildChartComponentSource(
  input: DataChartInput,
  rows: readonly DataRecord[],
): string {
  const chartName = chartComponentName(input.chartType);
  const seriesName = seriesComponentName(input.chartType);
  const series = input.yKeys
    .map(
      (key, index) =>
        `<${seriesName} dataKey=${JSON.stringify(key)} stroke={palette[${index}]} fill={palette[${index}]} />`,
    )
    .join("\n      ");
  return [
    'import { Bar, BarChart, Area, AreaChart, Line, LineChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";',
    "",
    `const data = ${JSON.stringify(rows, null, 2)};`,
    `const palette = ${JSON.stringify(PALETTE)};`,
    "",
    "export function CheatcodeChart() {",
    "  return (",
    `    <${chartName} width={${input.width}} height={${input.height}} data={data}>`,
    '      <CartesianGrid strokeDasharray="3 3" />',
    `      <XAxis dataKey=${JSON.stringify(input.xKey)} />`,
    "      <YAxis />",
    "      <Tooltip />",
    "      <Legend />",
    `      ${series}`,
    `    </${chartName}>`,
    "  );",
    "}",
  ].join("\n");
}

function chartLayout(input: DataChartInput): ChartLayout {
  const left = 72;
  const right = 28;
  const top = 76;
  const bottom = 58;
  return {
    bottom,
    left,
    plotHeight: input.height - top - bottom,
    plotWidth: input.width - left - right,
    right,
    top,
  };
}

function yDomain(points: readonly ChartPoint[]): YDomain {
  const values = points.flatMap((point) => point.values);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) {
    min = Math.min(0, min - 1);
    max = Math.max(1, max + 1);
  }
  return { max, min, range: max - min };
}

function renderLegend(input: DataChartInput, layout: ChartLayout): string {
  const itemWidth = Math.max(110, Math.floor(layout.plotWidth / input.yKeys.length));
  return input.yKeys
    .map((key, index) => {
      const x = layout.left + index * itemWidth;
      return [
        `<rect x="${x}" y="47" width="12" height="12" rx="3" fill="${PALETTE[index]}"/>`,
        `<text x="${x + 18}" y="57" fill="#C7D2E3" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11">${escapeXml(truncateLabel(key, 24))}</text>`,
      ].join("");
    })
    .join("");
}

function renderGrid(layout: ChartLayout, domain: YDomain): string {
  const lines: string[] = [];
  for (let index = 0; index <= GRID_LINES; index += 1) {
    const ratio = index / GRID_LINES;
    const y = layout.top + ratio * layout.plotHeight;
    const value = domain.max - ratio * domain.range;
    lines.push(
      `<line x1="${layout.left}" y1="${round(y)}" x2="${layout.left + layout.plotWidth}" y2="${round(y)}" stroke="#243044" stroke-width="1"/>`,
      `<text x="${layout.left - 10}" y="${round(y + 4)}" fill="#8EA0BA" font-family="ui-monospace, monospace" font-size="10" text-anchor="end">${escapeXml(formatNumber(value))}</text>`,
    );
  }
  return lines.join("");
}

function renderSeries(
  input: DataChartInput,
  points: readonly ChartPoint[],
  layout: ChartLayout,
  domain: YDomain,
): string {
  if (input.chartType === "bar") return renderBars(points, layout, domain);
  return input.yKeys
    .map((_, seriesIndex) =>
      input.chartType === "area"
        ? renderArea(points, seriesIndex, layout, domain)
        : renderLine(points, seriesIndex, layout, domain),
    )
    .join("");
}

function renderBars(points: readonly ChartPoint[], layout: ChartLayout, domain: YDomain): string {
  const bandWidth = layout.plotWidth / points.length;
  const groupWidth = Math.min(72, bandWidth * 0.74);
  const seriesCount = points[0]?.values.length ?? 1;
  const barWidth = Math.max(1, groupWidth / seriesCount);
  const baseline = yCoordinate(0, layout, domain);
  return points
    .flatMap((point, pointIndex) =>
      point.values.map((value, seriesIndex) => {
        const valueY = yCoordinate(value, layout, domain);
        const x = layout.left + pointIndex * bandWidth + (bandWidth - groupWidth) / 2;
        return `<rect x="${round(x + seriesIndex * barWidth)}" y="${round(Math.min(valueY, baseline))}" width="${round(Math.max(1, barWidth - 1))}" height="${round(Math.max(1, Math.abs(baseline - valueY)))}" rx="2" fill="${PALETTE[seriesIndex]}"/>`;
      }),
    )
    .join("");
}

function renderLine(
  points: readonly ChartPoint[],
  seriesIndex: number,
  layout: ChartLayout,
  domain: YDomain,
): string {
  const coordinates = seriesCoordinates(points, seriesIndex, layout, domain);
  const dots = coordinates
    .filter((_, index) => points.length <= 24 || index === 0 || index === points.length - 1)
    .map(
      ([x, y]) =>
        `<circle cx="${round(x)}" cy="${round(y)}" r="2.5" fill="${PALETTE[seriesIndex]}"/>`,
    )
    .join("");
  return `<polyline points="${coordinateList(coordinates)}" fill="none" stroke="${PALETTE[seriesIndex]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
}

function renderArea(
  points: readonly ChartPoint[],
  seriesIndex: number,
  layout: ChartLayout,
  domain: YDomain,
): string {
  const coordinates = seriesCoordinates(points, seriesIndex, layout, domain);
  const baseline = yCoordinate(0, layout, domain);
  const firstX = coordinates[0]?.[0] ?? layout.left;
  const lastX = coordinates.at(-1)?.[0] ?? layout.left + layout.plotWidth;
  const polygon = `${round(firstX)},${round(baseline)} ${coordinateList(coordinates)} ${round(lastX)},${round(baseline)}`;
  return [
    `<polygon points="${polygon}" fill="${PALETTE[seriesIndex]}" fill-opacity="0.22"/>`,
    `<polyline points="${coordinateList(coordinates)}" fill="none" stroke="${PALETTE[seriesIndex]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  ].join("");
}

function renderXAxis(
  input: DataChartInput,
  points: readonly ChartPoint[],
  layout: ChartLayout,
): string {
  const axisY = layout.top + layout.plotHeight;
  const ticks = xTickIndices(points.length);
  return [
    `<line x1="${layout.left}" y1="${axisY}" x2="${layout.left + layout.plotWidth}" y2="${axisY}" stroke="#52637A"/>`,
    ...ticks.map((index) => {
      const x = xCoordinate(index, points.length, layout);
      return `<text x="${round(x)}" y="${axisY + 19}" fill="#8EA0BA" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" text-anchor="middle">${escapeXml(truncateLabel(points[index]?.label ?? "", 14))}</text>`;
    }),
    `<text x="${layout.left + layout.plotWidth / 2}" y="${input.height - 12}" fill="#8EA0BA" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" text-anchor="middle">${escapeXml(input.xKey)}</text>`,
  ].join("");
}

function seriesCoordinates(
  points: readonly ChartPoint[],
  seriesIndex: number,
  layout: ChartLayout,
  domain: YDomain,
): [number, number][] {
  return points.map((point, index) => [
    xCoordinate(index, points.length, layout),
    yCoordinate(point.values[seriesIndex] ?? 0, layout, domain),
  ]);
}

function xCoordinate(index: number, count: number, layout: ChartLayout): number {
  return count === 1
    ? layout.left + layout.plotWidth / 2
    : layout.left + (index / (count - 1)) * layout.plotWidth;
}

function yCoordinate(value: number, layout: ChartLayout, domain: YDomain): number {
  return layout.top + ((domain.max - value) / domain.range) * layout.plotHeight;
}

function xTickIndices(count: number): number[] {
  const tickCount = Math.min(8, count);
  if (tickCount <= 1) return [0];
  return [
    ...new Set(
      Array.from({ length: tickCount }, (_, index) =>
        Math.round((index * (count - 1)) / (tickCount - 1)),
      ),
    ),
  ];
}

function coordinateList(coordinates: readonly [number, number][]): string {
  return coordinates.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

function chartComponentName(chartType: DataChartInput["chartType"]): string {
  return chartType === "line" ? "LineChart" : chartType === "area" ? "AreaChart" : "BarChart";
}

function seriesComponentName(chartType: DataChartInput["chartType"]): string {
  return chartType === "line" ? "Line" : chartType === "area" ? "Area" : "Bar";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function truncateLabel(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
