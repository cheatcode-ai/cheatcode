import type { DataChartInput, DataRecord } from "./schemas";

const RUNTIME_REQUIRE = [
  'import { createRequire } from "node:module";',
  'const require = createRequire("/opt/cheatcode-doc-runtime/package.json");',
].join("\n");

interface ChartScriptInput {
  input: DataChartInput;
  rows: DataRecord[];
}

export function buildChartScript({ input, rows }: ChartScriptInput): string {
  return [
    RUNTIME_REQUIRE,
    assignment("input", input),
    assignment("rows", rows),
    'const ReactModule = await import(require.resolve("react"));',
    "const React = ReactModule.default ?? ReactModule;",
    'const { renderToStaticMarkup } = await import(require.resolve("react-dom/server"));',
    'const Recharts = await import(require.resolve("recharts"));',
    "const h = React.createElement;",
    "const {",
    "  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,",
    "  Tooltip, XAxis, YAxis,",
    "} = Recharts;",
    "const palette = ['#8B5CF6', '#22C55E', '#F97316', '#06B6D4'];",
    "function axisChildren() {",
    "  return [",
    "    h(CartesianGrid, { key: 'grid', stroke: '#243044', strokeDasharray: '3 3' }),",
    "    h(XAxis, { key: 'x', dataKey: input.xKey, stroke: '#8EA0BA', tick: { fill: '#B9C6D8', fontSize: 12 } }),",
    "    h(YAxis, { key: 'y', stroke: '#8EA0BA', tick: { fill: '#B9C6D8', fontSize: 12 } }),",
    "    h(Tooltip, { key: 'tooltip' }),",
    "    h(Legend, { key: 'legend' }),",
    "  ];",
    "}",
    "function seriesChildren(kind) {",
    "  return input.yKeys.map((key, index) => {",
    "    const color = palette[index % palette.length];",
    "    if (kind === 'line') {",
    "      return h(Line, { key, type: 'monotone', dataKey: key, stroke: color, strokeWidth: 2, dot: false });",
    "    }",
    "    if (kind === 'area') {",
    "      return h(Area, { key, type: 'monotone', dataKey: key, fill: color, fillOpacity: 0.24, stroke: color, strokeWidth: 2 });",
    "    }",
    "    return h(Bar, { key, dataKey: key, fill: color, radius: [4, 4, 0, 0] });",
    "  });",
    "}",
    "const commonProps = {",
    "  data: rows,",
    "  height: input.height,",
    "  margin: { top: 28, right: 32, bottom: 28, left: 28 },",
    "  width: input.width,",
    "};",
    "const children = [...axisChildren(), ...seriesChildren(input.chartType)];",
    "const chart = input.chartType === 'line'",
    "  ? h(LineChart, commonProps, children)",
    "  : input.chartType === 'area'",
    "    ? h(AreaChart, commonProps, children)",
    "    : h(BarChart, commonProps, children);",
    "const markup = renderToStaticMarkup(chart);",
    "const start = markup.indexOf('<svg');",
    "const end = markup.lastIndexOf('</svg>');",
    "const svg = start >= 0 && end >= start ? markup.slice(start, end + '</svg>'.length) : markup;",
    "process.stdout.write(JSON.stringify({ svg }));",
  ].join("\n");
}

export function buildChartComponentSource(
  input: DataChartInput,
  rows: readonly DataRecord[],
): string {
  const chartName =
    input.chartType === "line"
      ? "LineChart"
      : input.chartType === "area"
        ? "AreaChart"
        : "BarChart";
  const seriesName =
    input.chartType === "line" ? "Line" : input.chartType === "area" ? "Area" : "Bar";
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
    'const palette = ["#8B5CF6", "#22C55E", "#F97316", "#06B6D4"];',
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

function assignment(name: string, value: unknown): string {
  return `const ${name} = ${JSON.stringify(value)};`;
}
