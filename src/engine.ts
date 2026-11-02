export interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

export interface Rate {
  value: number;
  estimated: boolean;
}

interface Call {
  startedAt: number;
  firstAt?: number;
  firstContentAt?: number;
  firstSource?: "provider" | "content";
  endedAt?: number;
  approximateStart: boolean;
  estimatedOutput: number;
  output: number;
  exactOutput: boolean;
  samples: { at: number; tokens: number }[];
}

export interface Snapshot {
  firstMs?: Rate;
  /** 等待中的计时只是显示值，不能当作已经测得的首字延迟。 */
  firstPending?: boolean;
  averageFirstMs?: Rate;
  tps?: Rate;
  averageTps?: Rate;
  elapsedMs: number;
  totalTokens: number;
  tokensEstimated: boolean;
  totalCost: number;
  costIncomplete: boolean;
  usageCount: number;
  callCount: number;
  outcome: "completed" | "aborted" | "error" | "length";
}

const positive = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function usageTokens(usage: UsageLike | undefined): number {
  if (!usage) return 0;
  // Pi 的 input 不含缓存部分，reasoning 已在 output 内，不能再累加一次。
  return positive(usage.input) + positive(usage.output)
    + positive(usage.cacheRead) + positive(usage.cacheWrite);
}

function estimateDelta(delta: string): number {
  let tokens = 0;
  // 保留小数跨 delta 累加，避免每个短数据块都向上取整而放大估算。
  for (const char of delta) {
    if (/\s/u.test(char)) continue;
    tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 1.5 : 0.25;
  }
  return tokens;
}

/** 所有时间使用 performance.now()，避免系统时钟校时导致负耗时。 */
export class MetricsEngine {
  running = false;
  private roundStart = 0;
  private roundEnd = 0;
  private calls: Call[] = [];
  private current?: Call;
  private totalTokens = 0;
  private totalCost = 0;
  private tokensEstimated = false;
  private costIncomplete = false;
  private usageCount = 0;
  private seenUsage = new Set<string>();
  private outcome: Snapshot["outcome"] = "completed";
  private windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  setWindow(windowMs: number): void {
    this.windowMs = windowMs;
  }

  begin(now: number): void {
    this.running = true;
    this.roundStart = now;
    this.roundEnd = now;
    this.calls = [];
    this.current = undefined;
    this.totalTokens = 0;
    this.totalCost = 0;
    this.tokensEstimated = false;
    this.costIncomplete = false;
    this.usageCount = 0;
    this.seenUsage.clear();
    this.outcome = "completed";
  }

  /** turn_start 提供兜底；真正的请求钩子到来时再修正起点。 */
  beginCall(now: number): void {
    if (!this.running) return;
    if (this.current) this.finishCall(now, undefined, "error", false);
    const call: Call = {
      startedAt: now,
      approximateStart: true,
      estimatedOutput: 0,
      output: 0,
      exactOutput: false,
      samples: [],
    };
    this.calls.push(call);
    this.current = call;
  }

  requestSent(now: number): void {
    if (!this.current || this.current.firstAt !== undefined) return;
    this.current.startedAt = now;
    this.current.approximateStart = false;
  }

  recordResponse(now: number): boolean {
    const call = this.current;
    if (!call || call.firstAt !== undefined) return false;
    // 原始首响应先到就立即结束等待，不能等可见正文出现才切分生成耗时。
    call.firstAt = now;
    call.firstSource = "provider";
    return true;
  }

  recordDelta(delta: string, now: number): void {
    const call = this.current;
    if (!call || delta.length === 0) return;
    call.firstContentAt ??= now;
    // 缺少原始流事件的provider只能按内容增量降级测量，必须标记口径不完整。
    if (call.firstAt === undefined) {
      call.firstAt = now;
      call.firstSource = "content";
    }
    const tokens = estimateDelta(delta);
    call.estimatedOutput += tokens;
    call.output = Math.ceil(call.estimatedOutput);
    if (tokens > 0) call.samples.push({ at: now, tokens });
    this.prune(call, now);
  }

  /** 只在消息结束时接纳权威 usage，不把累计 usage 与本地增量混加。 */
  finishCall(
    now: number,
    usage: UsageLike | undefined,
    stopReason: string,
    priceKnown: boolean,
  ): void {
    const call = this.current;
    if (!call) return;
    call.endedAt = now;
    const reported = usageTokens(usage);
    call.exactOutput = positive(usage?.output) > 0
      || (reported > 0 && call.estimatedOutput === 0);
    call.output = call.exactOutput ? positive(usage?.output) : Math.ceil(call.estimatedOutput);
    // 请求失败且没有首字时不虚构 TTFT/TPS；调用次数仍包含这次尝试。
    this.addUsage(`call:${this.calls.length}`, usage, priceKnown, call.output);
    call.samples = [];
    this.current = undefined;
    this.outcome = stopReason === "aborted" ? "aborted"
      : stopReason === "error" ? "error"
        : stopReason === "length" ? "length" : "completed";
  }

  /** 工具嵌套模型、压缩等额外 usage 只影响账目，不污染主对话 TPS。 */
  addUsage(key: string, usage: UsageLike | undefined, priceKnown: boolean | undefined, fallbackOutput = 0): void {
    if (this.seenUsage.has(key)) return;
    this.seenUsage.add(key);
    const tokens = usageTokens(usage);
    if (tokens > 0) {
      this.totalTokens += tokens;
      this.usageCount++;
    }
    // 某些接口仅返回 input；缺失的 output 用估算补齐，而不是丢弃已知 input。
    if (positive(usage?.output) === 0 && fallbackOutput > 0) {
      this.totalTokens += fallbackOutput;
      this.tokensEstimated = true;
      this.costIncomplete = true;
    }
    const reportedCost = usage?.cost?.total;
    const validCost = typeof reportedCost === "number" && Number.isFinite(reportedCost) && reportedCost >= 0;
    const cost = positive(reportedCost);
    this.totalCost += cost;
    // 已知缺少某类价格时，正数费用也可能不完整；额外调用无模型信息时信任其正数 cost。
    if ((tokens > 0 || fallbackOutput > 0)
      && (!validCost || priceKnown === false || (cost === 0 && priceKnown !== true))) {
      this.costIncomplete = true;
    }
    if (!usage || (tokens === 0 && fallbackOutput > 0)) {
      this.tokensEstimated = true;
      this.costIncomplete = true;
    }
  }

  settle(now: number, aborted: boolean): Snapshot {
    if (this.current) this.finishCall(now, undefined, aborted ? "aborted" : "error", false);
    this.roundEnd = now;
    this.running = false;
    if (aborted) this.outcome = "aborted";
    return this.snapshot(now);
  }

  snapshot(now: number): Snapshot {
    const firsts = this.calls.filter((call) => call.firstAt !== undefined);
    const firstCall = firsts.at(-1);
    const waitingCall = this.current?.firstAt === undefined ? this.current : undefined;
    // 等待时显示本次请求已耗时；首响应一到就定格，不再等待首个可见内容。
    const firstMs = waitingCall ? {
      value: Math.max(0, now - waitingCall.startedAt),
      estimated: waitingCall.approximateStart,
    } : firstCall ? {
      value: Math.max(0, firstCall.firstAt! - firstCall.startedAt),
      estimated: firstCall.approximateStart || firstCall.firstSource !== "provider",
    } : undefined;
    const averageFirstMs = firsts.length === 0 ? undefined : {
      value: firsts.reduce((sum, call) => sum + Math.max(0, call.firstAt! - call.startedAt), 0) / firsts.length,
      estimated: firsts.some((call) => call.approximateStart || call.firstSource !== "provider"),
    };
    let generationMs = 0;
    let generated = 0;
    let rateEstimated = false;
    let tpsCall: Call | undefined;
    for (const call of firsts) {
      const duration = Math.max(0, (call.endedAt ?? now) - call.firstAt!);
      const hasGeneration = call.firstContentAt !== undefined || call.output > 0;
      // 只收到首包、尚无输出时保留上一TPS；但最终真实usage可包含未透出的思考。
      if (hasGeneration && (call.endedAt === undefined || duration > 0)) tpsCall = call;
      // 均TPS只结算已结束调用，耗时从首响应算起，覆盖首包到可见内容之间的生成阶段。
      if (call.endedAt === undefined || duration <= 0 || !hasGeneration) continue;
      generationMs += duration;
      generated += call.output;
      rateEstimated ||= !call.exactOutput || call.approximateStart || call.firstSource !== "provider";
    }
    const averageTps = generationMs > 0 ? {
      value: generated * 1000 / generationMs,
      estimated: rateEstimated,
    } : undefined;
    let tps: Rate | undefined;
    if (tpsCall) {
      if (tpsCall.endedAt === undefined) {
        this.prune(tpsCall, now);
        const tokens = tpsCall.samples.reduce((sum, sample) => sum + sample.tokens, 0);
        // 仅当前正在生成的调用按时间衰减；等待下一次调用时保留上一调用的平均TPS。
        const span = Math.max(100, Math.min(this.windowMs, now - tpsCall.firstAt!));
        tps = { value: tokens * 1000 / span, estimated: true };
      } else {
        const duration = tpsCall.endedAt - tpsCall.firstAt!;
        tps = {
          value: tpsCall.output * 1000 / duration,
          estimated: !tpsCall.exactOutput || tpsCall.approximateStart || tpsCall.firstSource !== "provider",
        };
      }
    }
    return {
      firstMs,
      firstPending: waitingCall !== undefined,
      averageFirstMs,
      tps,
      averageTps,
      elapsedMs: Math.max(0, (this.running ? now : this.roundEnd) - this.roundStart),
      totalTokens: this.totalTokens + (this.current?.output ?? 0),
      tokensEstimated: this.tokensEstimated || !!this.current,
      totalCost: this.totalCost,
      costIncomplete: this.costIncomplete || !!this.current,
      usageCount: this.usageCount,
      callCount: this.calls.length,
      outcome: this.outcome,
    };
  }

  private prune(call: Call, now: number): void {
    let expired = 0;
    while (expired < call.samples.length && call.samples[expired].at < now - this.windowMs) expired++;
    if (expired > 0) call.samples.splice(0, expired);
  }
}
