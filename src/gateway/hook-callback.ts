import type { HookAgentCallbackConfig } from "./hooks.js";

type HookCallbackResult = {
  status: string;
  summary?: string;
  error?: string;
  delivered?: boolean;
  deliveryAttempted?: boolean;
};

export function buildHookCallbackPayload(params: {
  callbackBody?: Record<string, unknown>;
  runId: string;
  hookName: string;
  agentId?: string;
  sessionKey: string;
  result: HookCallbackResult;
}) {
  const base = params.callbackBody ? { ...params.callbackBody } : {};
  return {
    ...base,
    ok: params.result.status === "ok",
    status: params.result.status,
    error: params.result.error,
    summary: params.result.summary,
    runId: params.runId,
    hook: params.hookName,
    ...(params.agentId ? { agent: params.agentId } : {}),
    sessionKey: params.sessionKey,
    delivered: params.result.delivered,
    deliveryAttempted: params.result.deliveryAttempted,
    timestamp: new Date().toISOString(),
  };
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
      params.log(`hook callback failed: status=${response.status} url=${params.callback.url}`);
    }
  } catch (err) {
    params.log(`hook callback error: ${String(err)} url=${params.callback.url}`);
  } finally {
    clearTimeout(timer);
  }
}
