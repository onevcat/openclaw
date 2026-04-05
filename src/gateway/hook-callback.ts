import type { HookAgentCallbackConfig } from "./hooks.js";

type HookCallbackResult = {
  status: string;
  summary?: string;
  error?: string;
  outputText?: string;
  delivered?: boolean;
  deliveryAttempted?: boolean;
};

type ParsedTerminalHookResult = {
  status: "ok" | "failed";
  summary: string;
  error?: string;
};

const HOOK_RESULT_OPEN_TAG = "<openclaw_hook_result>";
const HOOK_RESULT_CLOSE_TAG = "</openclaw_hook_result>";

export function extractTerminalHookResult(text?: string): ParsedTerminalHookResult | null {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  const openIndex = text.lastIndexOf(HOOK_RESULT_OPEN_TAG);
  if (openIndex < 0) {
    return null;
  }
  const closeIndex = text.indexOf(HOOK_RESULT_CLOSE_TAG, openIndex + HOOK_RESULT_OPEN_TAG.length);
  if (closeIndex < 0) {
    return null;
  }

  const jsonText = text.slice(openIndex + HOOK_RESULT_OPEN_TAG.length, closeIndex).trim();
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      status?: unknown;
      summary?: unknown;
      error?: unknown;
    };
    if (parsed.status !== "ok" && parsed.status !== "failed") {
      return null;
    }
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
      return null;
    }
    if (parsed.error !== undefined && (typeof parsed.error !== "string" || !parsed.error.trim())) {
      return null;
    }
    return {
      status: parsed.status,
      summary: parsed.summary.trim(),
      ...(typeof parsed.error === "string" && parsed.error.trim()
        ? { error: parsed.error.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}

export function buildHookCallbackPayload(params: {
  callbackBody?: Record<string, unknown>;
  runId: string;
  hookName: string;
  agentId?: string;
  sessionKey: string;
  result: HookCallbackResult;
}) {
  const callbackBody = params.callbackBody ? { ...params.callbackBody } : {};
  const requireTerminalHookResult = callbackBody.requireTerminalHookResult === true;
  delete callbackBody.requireTerminalHookResult;

  const parsedTerminalResult = extractTerminalHookResult(
    params.result.outputText ?? params.result.summary,
  );

  const resolved = resolveCallbackResult({
    result: params.result,
    parsedTerminalResult,
    requireTerminalHookResult,
  });

  return {
    ...callbackBody,
    ok: resolved.ok,
    status: resolved.status,
    error: resolved.error,
    summary: resolved.summary,
    runId: params.runId,
    hook: params.hookName,
    ...(params.agentId ? { agent: params.agentId } : {}),
    sessionKey: params.sessionKey,
    delivered: params.result.delivered,
    deliveryAttempted: params.result.deliveryAttempted,
    timestamp: new Date().toISOString(),
  };
}

function resolveCallbackResult(params: {
  result: HookCallbackResult;
  parsedTerminalResult: ParsedTerminalHookResult | null;
  requireTerminalHookResult: boolean;
}): { ok: boolean; status: string; summary?: string; error?: string } {
  const { result, parsedTerminalResult, requireTerminalHookResult } = params;

  if (result.status !== "ok") {
    return {
      ok: false,
      status: result.status,
      summary: parsedTerminalResult?.summary ?? result.summary,
      error: result.error ?? parsedTerminalResult?.error,
    };
  }

  if (!parsedTerminalResult) {
    if (requireTerminalHookResult) {
      return {
        ok: false,
        status: "error",
        summary: result.summary,
        error: "missing_terminal_hook_result",
      };
    }
    return {
      ok: true,
      status: result.status,
      summary: result.summary,
      error: result.error,
    };
  }

  if (parsedTerminalResult.status === "failed") {
    return {
      ok: false,
      status: "failed",
      summary: parsedTerminalResult.summary,
      error: parsedTerminalResult.error ?? result.error ?? parsedTerminalResult.summary,
    };
  }

  return {
    ok: true,
    status: "ok",
    summary: parsedTerminalResult.summary,
    error: undefined,
  };
}

function toSafeLogUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

export async function sendHookCallback(params: {
  callback: HookAgentCallbackConfig;
  payload: Record<string, unknown>;
  log: (message: string) => void;
}) {
  const timeoutMs = Math.max(1, (params.callback.timeoutSeconds ?? 10) * 1_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(params.callback.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(params.callback.token ? { "x-meowhook-callback-token": params.callback.token } : {}),
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      params.log(
        `hook callback failed: status=${response.status} url=${toSafeLogUrl(params.callback.url)}`,
      );
    }
  } catch (err) {
    params.log(`hook callback error: ${String(err)} url=${toSafeLogUrl(params.callback.url)}`);
  } finally {
    clearTimeout(timer);
  }
}
