/** 判定“开始返回”的结构化流事件，不把HTTP响应头或心跳冒充模型首响应。 */
export function isResponseStreamEvent(data: unknown): boolean {
  const event = asRecord(data);
  if (!event || event.error) return false;
  const type = typeof event.type === "string" ? event.type
    : typeof event.event === "string" ? event.event : "";

  // 终止、错误、心跳和纯用量事件不能作为首包，避免制造接近零的生成耗时。
  if (/error|failed|cancelled|canceled|exception/iu.test(type)
    || /^(?:ping|pong|heartbeat|keep[_-]?alive|usage|metadata|done|message_stop|response\.(?:completed|done|incomplete))$/iu.test(type)) {
    return false;
  }

  // Responses的created/in_progress已表示开始返回，无需等到思考摘要或正文delta。
  if (type === "response.created" || type === "response.in_progress"
    || /^response\..+\.(?:added|delta)$/u.test(type)) return true;

  if (type === "message_start" || type === "content_block_start" || type === "content_block_delta") {
    return true;
  }

  // Chat Completions的首包常只有assistant角色或空delta，也属于有效首响应。
  if (Array.isArray(event.choices)) {
    return event.choices.some((value) => {
      const choice = asRecord(value);
      if (!choice) return false;
      const delta = asRecord(choice.delta);
      return !!delta && (choice.finish_reason == null || Object.keys(delta).length > 0);
    });
  }

  // 兼容Gemini、Bedrock等已解析事件；不将空候选、用量或停止信息当作首响应。
  if (Array.isArray(event.candidates) && event.candidates.some((value) => {
    const candidate = asRecord(value);
    return !!asRecord(candidate?.content);
  })) return true;
  if (event.messageStart != null || event.contentBlockStart != null || event.contentBlockDelta != null) {
    return true;
  }

  // 未识别协议仅接受明确的生成增量，其余交给标准化内容事件降级测量。
  if (typeof event.delta === "string" && event.delta.length > 0) return true;
  const delta = asRecord(event.delta);
  return !!delta && ["text", "content", "thinking", "reasoning_content", "partial_json"]
    .some((key) => typeof delta[key] === "string" && (delta[key] as string).length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
