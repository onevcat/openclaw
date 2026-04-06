import { describe, expect, it } from "vitest";
import {
  ensureOpenClawExecMarkerOnProcess,
  markOpenClawExecEnv,
  OPENCLAW_CLI_ENV_VALUE,
  OPENCLAW_CLI_ENV_VAR,
  resolveOpenClawRuntimeEnv,
} from "./openclaw-exec-env.js";

describe("markOpenClawExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", OPENCLAW_CLI: "0" };
    const marked = markOpenClawExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      OPENCLAW_CLI: OPENCLAW_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.OPENCLAW_CLI).toBe("0");
  });
});

describe("resolveOpenClawRuntimeEnv", () => {
  it("injects shell, agent, session key, and session id markers", () => {
    expect(
      resolveOpenClawRuntimeEnv({
        shell: "exec",
        agentId: "onevpaw",
        sessionKey: "agent:onevpaw:main",
        sessionId: "sid-123",
      }),
    ).toEqual({
      OPENCLAW_SHELL: "exec",
      OPENCLAW_AGENT_ID: "onevpaw",
      OPENCLAW_SESSION_KEY: "agent:onevpaw:main",
      OPENCLAW_SESSION_ID: "sid-123",
    });
  });

  it("derives agent id from session key when agentId is omitted", () => {
    expect(resolveOpenClawRuntimeEnv({ shell: "exec", sessionKey: "agent:onevtail:main" }))
      .toMatchObject({
        OPENCLAW_SHELL: "exec",
        OPENCLAW_AGENT_ID: "onevtail",
        OPENCLAW_SESSION_KEY: "agent:onevtail:main",
      });
  });
});

describe("ensureOpenClawExecMarkerOnProcess", () => {
  it.each([
    {
      name: "mutates and returns the provided process env",
      env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    },
    {
      name: "overwrites an existing marker on the provided process env",
      env: { PATH: "/usr/bin", [OPENCLAW_CLI_ENV_VAR]: "0" } as NodeJS.ProcessEnv,
    },
  ])("$name", ({ env }) => {
    expect(ensureOpenClawExecMarkerOnProcess(env)).toBe(env);
    expect(env[OPENCLAW_CLI_ENV_VAR]).toBe(OPENCLAW_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[OPENCLAW_CLI_ENV_VAR];
    delete process.env[OPENCLAW_CLI_ENV_VAR];

    try {
      expect(ensureOpenClawExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[OPENCLAW_CLI_ENV_VAR]).toBe(OPENCLAW_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        delete process.env[OPENCLAW_CLI_ENV_VAR];
      } else {
        process.env[OPENCLAW_CLI_ENV_VAR] = previous;
      }
    }
  });
});
