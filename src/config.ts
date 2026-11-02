import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { FRAME_PRESETS } from "./frames.ts";

export interface Config {
  frames: string;
  windowMs: number;
  refreshMs: number;
  thresholds: [number, number, number];
  colors: [string, string, string, string];
}

export const DEFAULT_CONFIG: Config = {
  frames: "dots",
  windowMs: 1000,
  refreshMs: 200,
  thresholds: [10, 30, 60],
  colors: ["#ff4444", "#ff88cc", "#ffdd44", "#00ff88"],
};

export function validFrames(value: string): boolean {
  return value === "none" || value === "random" || Object.hasOwn(FRAME_PRESETS, value);
}

export function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("配置根节点必须是 JSON 对象");
  }
  const raw = value as Record<string, unknown>;
  const cfg: Config = structuredClone(DEFAULT_CONFIG);
  if (raw.frames !== undefined) {
    if (typeof raw.frames !== "string" || !validFrames(raw.frames)) throw new Error("frames 预设名称无效");
    cfg.frames = raw.frames;
  }
  for (const [key, min, max] of [["windowMs", 100, 30000], ["refreshMs", 50, 2000]] as const) {
    if (raw[key] === undefined) continue;
    const number = raw[key];
    if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) {
      throw new Error(`${key} 必须是 ${min}～${max} 的整数（毫秒）`);
    }
    cfg[key] = number;
  }
  if (raw.thresholds !== undefined) {
    const tiers = raw.thresholds;
    if (!Array.isArray(tiers) || tiers.length !== 3
      || tiers.some((n) => typeof n !== "number" || !Number.isFinite(n) || n <= 0)
      || !(tiers[0] < tiers[1] && tiers[1] < tiers[2])) {
      throw new Error("thresholds 必须是三个严格递增的正数，例如 [10, 30, 60]");
    }
    cfg.thresholds = [...tiers] as Config["thresholds"];
  }
  if (raw.colors !== undefined) {
    const colors = raw.colors;
    if (!Array.isArray(colors) || colors.length !== 4
      || colors.some((color) => typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))) {
      throw new Error("colors 必须包含四个 #RRGGBB 颜色，按速度从慢到快排列");
    }
    cfg.colors = [...colors] as Config["colors"];
  }
  return cfg;
}

export async function loadConfig(file: string): Promise<{ config: Config; warning?: string }> {
  try {
    return { config: parseConfig(JSON.parse(await readFile(file, "utf8"))) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: structuredClone(DEFAULT_CONFIG) };
    return {
      config: structuredClone(DEFAULT_CONFIG),
      warning: `pi-round-metrics 配置读取失败，暂用默认值：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function saveFrames(file: string, frames: string): Promise<void> {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    parseConfig(parsed);
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    // 损坏的配置不覆盖，先让用户修复，防止切换动画时丢失手写配置。
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ ...raw, frames }, null, 2)}\n`, "utf8");
}
