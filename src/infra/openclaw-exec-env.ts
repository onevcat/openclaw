import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

export const OPENCLAW_CLI_ENV_VAR = "OPENCLAW_CLI";
export const OPENCLAW_CLI_ENV_VALUE = "1";

export function markOpenClawExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [OPENCLAW_CLI_ENV_VAR]: OPENCLAW_CLI_ENV_VALUE,
  };
}

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

export function ensureOpenClawExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[OPENCLAW_CLI_ENV_VAR] = OPENCLAW_CLI_ENV_VALUE;
  return env;
}
