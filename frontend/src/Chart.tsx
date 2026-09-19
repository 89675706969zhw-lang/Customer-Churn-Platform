import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
]);
export const palette = ["#7700ff", "#059669", "#ed8b23", "#e04c64"];
export function Chart({
  option,
  label,
  onClick,
  height = 290,
}: {
  option: EChartsOption;
  label: string;
  onClick?: (name: string) => void;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    const chart = echarts.init(ref.current!);
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current!);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, []);
  useEffect(() => {
    const chart = instance.current!;
    chart.setOption(
      {
        color: palette,
        animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
        textStyle: {
          fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
          color: "#676171",
        },
        aria: { enabled: true },
        ...option,
      },
      true,
    );
    chart.off("click");
    if (onClick) chart.on("click", (p) => onClick(p.name));
  }, [option, onClick]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      style={{ height, width: "100%" }}
    />
  );
}
