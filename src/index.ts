import { performance } from "node:perf_hooks";
import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, loadConfig, saveFrames, validFrames, type Config } from "./config.ts";
import { MetricsEngine, type Snapshot, type UsageLike } from "./engine.ts";
import { createWorkingLayout, formatMetrics } from "./display.ts";
import { FRAME_PRESETS } from "./frames.ts";
import { isResponseStreamEvent } from "./provider-events.ts";

const ENTRY_TYPE = "round-metrics-summary";
interface Summary {
  version: 1;
  timestamp: number;
  metrics: Snapshot;
}

type PricedModel = {
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

function hasPrice(model: PricedModel | undefined, usage: UsageLike | undefined): boolean {
  if (!model?.cost || !usage) return false;
  // 本次用到的计费类别必须有非零价格；全零模型配置按“价格未知”处理。
  const used = (["input", "output", "cacheRead", "cacheWrite"] as const)
    .filter((key) => (usage[key] ?? 0) > 0);
  return used.length > 0 && used.every((key) => (model.cost?.[key] ?? 0) > 0);
}

export default function (pi: ExtensionAPI): void {
  const configFile = join(getAgentDir(), "round-metrics.json");
  let config: Config = structuredClone(DEFAULT_CONFIG);
  let engine = new MetricsEngine(config.windowMs);
  let workingLayout = createWorkingLayout();
  let timer: ReturnType<typeof setInterval> | undefined;
  let submittedAt: number | undefined;
  let awaitingAssistant = false;
  let resolvedFrames = config.frames;
  let startedAt = Date.now();
  let pendingCompactions: { key: string; usage: UsageLike }[] = [];
  // 按调用ID跟踪并行、嵌套工具，不能在任意一个工具结束时就提前切回模型状态。
  const activeToolCalls = new Set<string>();

  const chooseFrames = () => {
    const names = Object.keys(FRAME_PRESETS);
    resolvedFrames = config.frames === "random"
      ? names[Math.floor(Math.random() * names.length)] : config.frames;
  };

  const applyIndicator = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    if (resolvedFrames === "none") {
      ctx.ui.setWorkingIndicator({ frames: [] });
      return;
    }
    const preset = FRAME_PRESETS[resolvedFrames] ?? FRAME_PRESETS.dots;
    ctx.ui.setWorkingIndicator({
      frames: preset.frames.map((frame) => ctx.ui.theme.fg("dim", frame)),
      intervalMs: preset.intervalMs,
    });
  };

  const workingMessage = (ctx: ExtensionContext) => {
    const state = activeToolCalls.size > 0 ? "工作中" : "思考中";
    const metrics = formatMetrics(engine.snapshot(performance.now()), config, ctx.ui.theme, false, workingLayout);
    return `${ctx.ui.theme.fg("dim", state)}  ${metrics}`;
  };

  const render = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !engine.running) return;
    ctx.ui.setWorkingMessage(workingMessage(ctx));
  };

  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  const startTimer = (ctx: ExtensionContext) => {
    stopTimer();
    if (ctx.mode === "tui") timer = setInterval(() => render(ctx), config.refreshMs);
  };

  pi.registerEntryRenderer<Summary>(ENTRY_TYPE, (entry, _options, theme) => {
    if (!entry.data || entry.data.version !== 1) return undefined;
    return new Text(formatMetrics(entry.data.metrics, config, theme, true), 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    stopTimer();
    activeToolCalls.clear();
    const loaded = await loadConfig(configFile);
    config = loaded.config;
    engine = new MetricsEngine(config.windowMs);
    workingLayout = createWorkingLayout();
    submittedAt = undefined;
    pendingCompactions = [];
    awaitingAssistant = false;
    chooseFrames();
    applyIndicator(ctx);
    if (ctx.mode === "tui") {
      // 预先替换默认 Working 文案，避免首个请求前短暂显示状态描述。
      ctx.ui.setWorkingMessage(workingMessage(ctx));
    }
    if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
  });

  pi.on("input", (_event, ctx) => {
    // 忙碌时的追加/纠正消息归入当前轮，不能重置正在统计的数据。
    if (!engine.running && ctx.isIdle()) {
      submittedAt = performance.now();
      pendingCompactions = [];
    }
  });

  pi.on("before_agent_start", (_event, ctx) => {
    activeToolCalls.clear();
    engine.begin(submittedAt ?? performance.now());
    // 列宽仅在本轮保留；下一轮恢复默认预留，避免历史超长值永久占位。
    workingLayout = createWorkingLayout();
    submittedAt = undefined;
    startedAt = Date.now();
    awaitingAssistant = false;
    for (const item of pendingCompactions) engine.addUsage(item.key, item.usage, undefined);
    pendingCompactions = [];
    chooseFrames();
    applyIndicator(ctx);
    render(ctx);
    startTimer(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
    if (!engine.running) return;
    engine.beginCall(performance.now());
    awaitingAssistant = true;
    render(ctx);
  });

  pi.on("before_provider_request", () => {
    // 不返回任何 payload，确保只观察请求，不修改模型实际收到的内容。
    if (engine.running && awaitingAssistant) engine.requestSent(performance.now());
  });

  pi.on("provider_stream_event", (event, ctx) => {
    if (!engine.running || !awaitingAssistant || activeToolCalls.size > 0) return;
    if (isResponseStreamEvent(event.data) && engine.recordResponse(performance.now())) {
      // 立即刷新首响应，不让界面继续等到正文或思考增量才停止首字计时。
      render(ctx);
    }
  });

  pi.on("message_update", (event) => {
    if (!engine.running || !awaitingAssistant || event.message.role !== "assistant") return;
    const stream = event.assistantMessageEvent;
    if (stream.type === "text_delta" || stream.type === "thinking_delta" || stream.type === "toolcall_delta") {
      // 内容增量只负责输出量估算，并为缺少原始流事件的provider提供计时兜底。
      engine.recordDelta(stream.delta, performance.now());
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (!engine.running) return;
    const message = event.message;
    if (message.role === "assistant") {
      // 以调用生命周期去重，不依赖毫秒 timestamp，避免极快调用碰撞而漏记。
      if (!awaitingAssistant) return;
      const model = ctx.modelRegistry.find(message.provider, message.model);
      engine.finishCall(performance.now(), message.usage, message.stopReason, hasPrice(model, message.usage));
      awaitingAssistant = false;
      render(ctx);
    } else if (message.role === "toolResult" && message.usage) {
      // Pi 已把工具内部的嵌套 usage 汇总到 toolResult；不再从执行事件重复累加。
      engine.addUsage(`tool:${message.toolCallId}`, message.usage, undefined);
      render(ctx);
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (!engine.running) return;
    activeToolCalls.add(event.toolCallId);
    render(ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (!engine.running) return;
    activeToolCalls.delete(event.toolCallId);
    render(ctx);
  });

  pi.on("session_compact", (event, ctx) => {
    const entry = event.compactionEntry;
    if (!entry?.usage) return;
    const key = `compaction:${entry.id}`;
    if (engine.running) {
      engine.addUsage(key, entry.usage, undefined);
      render(ctx);
    } else if (submittedAt !== undefined) {
      // Pi 可能先压缩再触发 before_agent_start；仍把这部分账目归到本轮。
      pendingCompactions.push({ key, usage: entry.usage });
    }
  });

  pi.on("agent_settled", (event, ctx) => {
    if (!engine.running) return;
    const metrics = engine.settle(performance.now(), event.aborted);
    activeToolCalls.clear();
    awaitingAssistant = false;
    stopTimer();
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage();
    // custom entry 会持久化和渲染，但不会进入下一次模型请求的上下文。
    pi.appendEntry<Summary>(ENTRY_TYPE, { version: 1, timestamp: startedAt, metrics });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopTimer();
    activeToolCalls.clear();
    if (ctx.mode === "tui") {
      ctx.ui.setWorkingMessage();
      ctx.ui.setWorkingIndicator();
    }
    submittedAt = undefined;
    pendingCompactions = [];
    awaitingAssistant = false;
  });

  pi.registerCommand("round-metrics", {
    description: "查看统计插件配置，切换动态图标或重载配置",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/u).filter(Boolean);
      if (parts.length === 0) {
        ctx.ui.notify(
          `pi-round-metrics\n配置：${configFile}\n动画：${config.frames}\n窗口：${config.windowMs}ms · 刷新：${config.refreshMs}ms`
          + `\nTPS分界：${config.thresholds.join(" / ")} tok/s\nTPS颜色：${config.colors.join(" / ")}`
          + "\n/round-metrics frames [名称|random|none]\n/round-metrics reload",
          "info",
        );
        return;
      }
      if (parts[0] === "frames" && parts.length <= 2) {
        let name: string | undefined = parts[1];
        if (!name && ctx.hasUI) {
          name = await ctx.ui.select("选择动态图标", [...Object.keys(FRAME_PRESETS), "random", "none"]);
          if (!name) return;
        }
        if (!name || !validFrames(name)) {
          ctx.ui.notify(`可用动画：${[...Object.keys(FRAME_PRESETS), "random", "none"].join(", ")}`, "warning");
          return;
        }
        try {
          await saveFrames(configFile, name);
          config = { ...config, frames: name };
          chooseFrames();
          applyIndicator(ctx);
          ctx.ui.notify(`动态图标已切换：${name}`, "info");
        } catch (error) {
          ctx.ui.notify(`保存配置失败：${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return;
      }
      if (parts[0] === "reload" && parts.length === 1) {
        const loaded = await loadConfig(configFile);
        if (loaded.warning) {
          ctx.ui.notify(loaded.warning, "warning");
          return;
        }
        config = loaded.config;
        engine.setWindow(config.windowMs);
        chooseFrames();
        applyIndicator(ctx);
        if (engine.running) {
          startTimer(ctx);
          render(ctx);
        }
        ctx.ui.notify("统计插件配置已重载", "info");
        return;
      }
      ctx.ui.notify("用法：/round-metrics [frames [名称|random|none]|reload]", "warning");
    },
  });
}
