import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

/**
 * Build OpenClaw runtime environment markers for child-process spawn.
 *
 * Returns only the OpenClaw-specific env vars (`OPENCLAW_SHELL`,
 * `OPENCLAW_AGENT_ID`, `OPENCLAW_SESSION_KEY`).  Callers should spread the
 * result onto whatever base env they already have:
 *
 *     { ...baseEnv, ...resolveOpenClawRuntimeEnv({ shell: "exec", ... }) }
 */
export function resolveOpenClawRuntimeEnv(opts: {
  shell: string;
  agentId?: string;
  sessionKey?: string;
}): Record<string, string> {
  const sessionKey = opts.sessionKey?.trim();
  const agentId = opts.agentId?.trim() || resolveAgentIdFromSessionKey(sessionKey);
  return {
    OPENCLAW_SHELL: opts.shell,
    ...(agentId ? { OPENCLAW_AGENT_ID: agentId } : {}),
    ...(sessionKey ? { OPENCLAW_SESSION_KEY: sessionKey } : {}),
  };
}
