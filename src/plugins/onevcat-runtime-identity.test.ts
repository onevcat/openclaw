import { describe, expect, it } from "vitest";
import { resolveOpenClawExecRuntimeEnv } from "../../local-plugins/onevcat-runtime-identity/runtime-env.js";

describe("resolveOpenClawExecRuntimeEnv", () => {
  it("projects complete exec identity without inventing missing context", () => {
    expect(
      resolveOpenClawExecRuntimeEnv({
        agentId: "onevtail",
        sessionKey: "agent:onevtail:discord:onevtail:direct:owner",
        sessionId: "session-1",
      }),
    ).toEqual({
      OPENCLAW_SHELL: "exec",
      OPENCLAW_AGENT_ID: "onevtail",
      OPENCLAW_SESSION_KEY: "agent:onevtail:discord:onevtail:direct:owner",
      OPENCLAW_SESSION_ID: "session-1",
    });
  });

  it("uses the event session key when hook context omits it", () => {
    expect(
      resolveOpenClawExecRuntimeEnv({
        agentId: "main",
        eventSessionKey: "agent:main:automation:nightly",
      }),
    ).toEqual({
      OPENCLAW_SHELL: "exec",
      OPENCLAW_AGENT_ID: "main",
      OPENCLAW_SESSION_KEY: "agent:main:automation:nightly",
    });
  });

  it("does not fabricate agent or session identity", () => {
    expect(resolveOpenClawExecRuntimeEnv({})).toEqual({ OPENCLAW_SHELL: "exec" });
  });
});
