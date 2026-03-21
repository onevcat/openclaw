import { randomUUID } from "node:crypto";
import type { CliDeps } from "../../cli/deps.js";
import { loadConfig } from "../../config/config.js";
import { resolveMainSessionKeyFromConfig } from "../../config/sessions.js";
import { runCronIsolatedAgentTurn } from "../../cron/isolated-agent.js";
import type { CronJob } from "../../cron/types.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  normalizeHookDispatchSessionKey,
  type HookAgentCallbackConfig,
  type HookAgentDispatchPayload,
  type HooksConfigResolved,
} from "../hooks.js";
import { createHooksRequestHandler } from "../server-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

async function notifyHookCallback(params: {
  callback: HookAgentCallbackConfig;
  payload: Record<string, unknown>;
  logHooks: SubsystemLogger;
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
      params.logHooks.warn(
        `hook callback failed: status=${response.status} url=${params.callback.url}`,
      );
    }
  } catch (err) {
    params.logHooks.warn(`hook callback error: ${String(err)} url=${params.callback.url}`);
  } finally {
    clearTimeout(timer);
  }
}

function buildHookCallbackPayload(params: {
  callbackBody?: Record<string, unknown>;
  runId: string;
  hookName: string;
  agentId?: string;
  sessionKey: string;
  result:
    | {
        status: string;
        summary?: string;
        error?: string;
        delivered?: boolean;
        deliveryAttempted?: boolean;
      }
    | {
        status: "error";
        summary?: string;
        error?: string;
      };
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
    delivered: "delivered" in params.result ? params.result.delivered : undefined,
    deliveryAttempted:
      "deliveryAttempted" in params.result ? params.result.deliveryAttempted : undefined,
    timestamp: new Date().toISOString(),
  };
}

export function createGatewayHooksRequestHandler(params: {
  deps: CliDeps;
  getHooksConfig: () => HooksConfigResolved | null;
  bindHost: string;
  port: number;
  logHooks: SubsystemLogger;
}) {
  const { deps, getHooksConfig, bindHost, port, logHooks } = params;

  const dispatchWakeHook = (value: { text: string; mode: "now" | "next-heartbeat" }) => {
    const sessionKey = resolveMainSessionKeyFromConfig();
    enqueueSystemEvent(value.text, { sessionKey });
    if (value.mode === "now") {
      requestHeartbeatNow({ reason: "hook:wake" });
    }
  };

  const dispatchAgentHook = (value: HookAgentDispatchPayload) => {
    const sessionKey = normalizeHookDispatchSessionKey({
      sessionKey: value.sessionKey,
      targetAgentId: value.agentId,
    });
    const mainSessionKey = resolveMainSessionKeyFromConfig();
    const jobId = randomUUID();
    const now = Date.now();
    const job: CronJob = {
      id: jobId,
      agentId: value.agentId,
      name: value.name,
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "at", at: new Date(now).toISOString() },
      sessionTarget: "isolated",
      wakeMode: value.wakeMode,
      payload: {
        kind: "agentTurn",
        message: value.message,
        model: value.model,
        thinking: value.thinking,
        timeoutSeconds: value.timeoutSeconds,
        deliver: value.deliver,
        channel: value.channel,
        to: value.to,
        allowUnsafeExternalContent: value.allowUnsafeExternalContent,
      },
      state: { nextRunAtMs: now },
    };

    const runId = randomUUID();
    void (async () => {
      try {
        const cfg = loadConfig();
        const result = await runCronIsolatedAgentTurn({
          cfg,
          deps,
          job,
          message: value.message,
          sessionKey,
          lane: "cron",
          deliveryContract: "shared",
        });

        if (value.callback) {
          await notifyHookCallback({
            callback: value.callback,
            payload: buildHookCallbackPayload({
              callbackBody: value.callback.body,
              runId,
              hookName: value.name,
              agentId: value.agentId,
              sessionKey,
              result,
            }),
            logHooks,
          });
        }

        const summary = result.summary?.trim() || result.error?.trim() || result.status;
        const prefix =
          result.status === "ok" ? `Hook ${value.name}` : `Hook ${value.name} (${result.status})`;
        if (!result.delivered) {
          enqueueSystemEvent(`${prefix}: ${summary}`.trim(), {
            sessionKey: mainSessionKey,
          });
          if (value.wakeMode === "now") {
            requestHeartbeatNow({ reason: `hook:${jobId}` });
          }
        }
      } catch (err) {
        const errorText = String(err);
        logHooks.warn(`hook agent failed: ${errorText}`);

        if (value.callback) {
          await notifyHookCallback({
            callback: value.callback,
            payload: buildHookCallbackPayload({
              callbackBody: value.callback.body,
              runId,
              hookName: value.name,
              agentId: value.agentId,
              sessionKey,
              result: {
                status: "error",
                error: errorText,
                summary: errorText,
              },
            }),
            logHooks,
          });
        }

        enqueueSystemEvent(`Hook ${value.name} (error): ${errorText}`, {
          sessionKey: mainSessionKey,
        });
        if (value.wakeMode === "now") {
          requestHeartbeatNow({ reason: `hook:${jobId}:error` });
        }
      }
    })();

    return runId;
  };

  return createHooksRequestHandler({
    getHooksConfig,
    bindHost,
    port,
    logHooks,
    dispatchAgentHook,
    dispatchWakeHook,
  });
}
