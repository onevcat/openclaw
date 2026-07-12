import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

/**
 * Build OpenClaw runtime environment markers for child-process spawn.
 *
 * Returns only OpenClaw-specific env vars. Callers should merge the result into
 * whatever base environment they already have.
 */
export function resolveOpenClawRuntimeEnv(opts: {
  shell: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
}): Record<string, string> {
  const sessionKey = opts.sessionKey?.trim();
  const sessionId = opts.sessionId?.trim();
  const agentId = opts.agentId?.trim() || resolveAgentIdFromSessionKey(sessionKey);
  return {
    OPENCLAW_SHELL: opts.shell,
    ...(agentId ? { OPENCLAW_AGENT_ID: agentId } : {}),
    ...(sessionKey ? { OPENCLAW_SESSION_KEY: sessionKey } : {}),
    ...(sessionId ? { OPENCLAW_SESSION_ID: sessionId } : {}),
  };
}
