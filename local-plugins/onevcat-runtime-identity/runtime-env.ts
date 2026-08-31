export type OpenClawExecRuntimeContext = {
  agentId?: string;
  sessionKey?: string;
  eventSessionKey?: string;
  sessionId?: string;
};

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function resolveOpenClawExecRuntimeEnv(
  context: OpenClawExecRuntimeContext,
): Record<string, string> {
  const agentId = nonEmpty(context.agentId);
  const sessionKey = nonEmpty(context.sessionKey) ?? nonEmpty(context.eventSessionKey);
  const sessionId = nonEmpty(context.sessionId);
  return {
    OPENCLAW_SHELL: "exec",
    ...(agentId ? { OPENCLAW_AGENT_ID: agentId } : {}),
    ...(sessionKey ? { OPENCLAW_SESSION_KEY: sessionKey } : {}),
    ...(sessionId ? { OPENCLAW_SESSION_ID: sessionId } : {}),
  };
}
