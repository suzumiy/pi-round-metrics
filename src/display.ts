import type { Theme } from "@earendil-works/pi-coding-agent";
import { parseColor, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import type { Rate, Snapshot } from "./engine.ts";

export interface WorkingLayout {
  first: number;
  tps: number;
  elapsed: number;
  tokens: number;
  cost: number;
}

export function createWorkingLayout(): WorkingLayout {
  return {
    first: 11,
    tps: 11,
    elapsed: 8,
    tokens: 7,
    cost: 10,
  };
}

function padGroup(value: string, key: keyof WorkingLayout, layout: WorkingLayout): string {
  // 留白补在组尾，图标始终紧邻自己的数值；按可见列宽处理颜色转义码。
  const width = visibleWidth(value);
  layout[key] = Math.max(layout[key], width);
  return value + " ".repeat(layout[key] - width);
}

function fixed(value: number, digits: number): string {
  // 只去掉既有显示精度内的小数末尾零，不改变原始统计值或截掉整数末尾零。
  return value.toFixed(digits).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${fixed(value / 1_000_000, 1)}M`;
  if (value >= 1000) return `${fixed(value / 1000, 1)}k`;
  return Math.round(value).toString();
}

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${fixed(ms / 1000, 1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m${seconds % 60}s`;
}

function latency(rate: Rate | undefined, theme: Theme): string {
  if (!rate) return theme.fg("dim", "--");
  // 延迟越低越好；使用原始毫秒判断档位，不用四舍五入后的显示值判断。
  const color = rate.value <= 3000 ? "#00ff88"
    : rate.value <= 10000 ? "#ffdd44"
      : rate.value <= 20000 ? "#ff88cc" : "#ff4444";
  return theme.style(`${rate.estimated ? "~" : ""}${fixed(rate.value / 1000, 2)}`, { fg: parseColor(color) });
}

function speed(rate: Rate | undefined, config: Config, theme: Theme): string {
  if (!rate) return theme.fg("dim", "--");
  const tier = rate.value >= config.thresholds[2] ? 3
    : rate.value >= config.thresholds[1] ? 2
      : rate.value >= config.thresholds[0] ? 1 : 0;
  // 通过主题 API 适配终端颜色能力，只给速度数值着色。
  return theme.style(`${rate.estimated ? "~" : ""}${fixed(rate.value, 1)}`, { fg: parseColor(config.colors[tier]) });
}

function money(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.001) return `$${value.toFixed(6)}`;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatMetrics(
  snapshot: Snapshot,
  config: Config,
  theme: Theme,
  final = false,
  layout?: WorkingLayout,
): string {
  const tokens = snapshot.totalTokens > 0 || snapshot.usageCount > 0
    ? `${snapshot.tokensEstimated ? "~" : ""}${compactNumber(snapshot.totalTokens)}` : "--";
  const cost = snapshot.costIncomplete
    ? (snapshot.totalCost > 0 ? `≥${money(snapshot.totalCost)}` : "--")
    : (snapshot.usageCount > 0 ? money(snapshot.totalCost) : "--");
  const suffix = !final || snapshot.outcome === "completed" ? ""
    : snapshot.outcome === "aborted" ? "  已中断"
      : snapshot.outcome === "length" ? "  输出达上限" : "  出错";
  // 运行中也逐段明确颜色，避免继承输入框的紫色边框；时延和TPS数值独立着色。
  const text = (value: string) => theme.fg("dim", value);
  // 使用默认 Emoji 样式的闹钟，不加选择符，避免秒表的占宽差异造成间距或滚动条错位。
  // 最终记录保留标签及自然间距，不带Working栏用于对齐的占位空格。
  if (final) {
    return [
      `${text("⏳ 均首字 ")}${latency(snapshot.averageFirstMs, theme)}${text(" / 首字 ")}${latency(snapshot.firstMs, theme)}`,
      `${text("⚡ 均TPS ")}${speed(snapshot.averageTps, config, theme)}${text(" / TPS ")}${speed(snapshot.tps, config, theme)}`,
      text(`⏰ 总用时 ${duration(snapshot.elapsedMs)}`),
      text(`🔥 ${tokens}`),
      text(`💰 ${cost}`),
    ].join(text("  ")) + text(suffix);
  }

  const widths = layout ?? createWorkingLayout();
  const fit = (value: string, key: keyof WorkingLayout) => padGroup(value, key, widths);
  // 只固定整组宽度，不在图标和数值之间填充；首字仍以秒计量但不显示单位。
  const firstValues = `${latency(snapshot.averageFirstMs, theme)}${text("/")}${latency(snapshot.firstMs, theme)}`;
  const speedValues = `${speed(snapshot.averageTps, config, theme)}${text("/")}${speed(snapshot.tps, config, theme)}`;
  const firstGroup = `${text("⏳ ")}${fit(firstValues, "first")}`;
  const speedGroup = `${text("⚡ ")}${fit(speedValues, "tps")}`;
  return [
    firstGroup,
    speedGroup,
    text(`⏰ ${fit(duration(snapshot.elapsedMs), "elapsed")}`),
    text(`🔥 ${fit(tokens, "tokens")}`),
    text(`💰 ${fit(cost, "cost")}`),
  ].join(text("  "));
}
