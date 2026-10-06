import { RequestedModelUnsupportedError } from "acpx/runtime";
import { describe, expect, it, vi } from "vitest";
import { ensureSessionWithModelRef } from "./model-ref.js";

describe("ACPX session environment", () => {
  it("persists logical owner identity while preserving custom environment and startup model", async () => {
    const ensure = vi.fn(async () => ({
      sessionKey: "agent:main:acp:test",
      backend: "acpx",
      runtimeSessionName: "test",
    }));

    await ensureSessionWithModelRef(ensure, {
      sessionKey: "agent:main:acp:test",
      agent: "codex",
      mode: "persistent",
      model: "gpt-5.4",
      modelExplicit: true,
      thinkingExplicit: true,
      sessionOptions: { env: { CUSTOM_VALUE: "fixture", OPENCLAW_AGENT_ID: "stale" } },
    });

    expect(ensure).toHaveBeenCalledExactlyOnceWith({
      sessionKey: "agent:main:acp:test",
      agent: "codex",
      mode: "persistent",
      model: "gpt-5.4",
      sessionOptions: {
        model: "gpt-5.4",
        env: {
          CUSTOM_VALUE: "fixture",
          OPENCLAW_SHELL: "acpx-runtime",
          OPENCLAW_AGENT_ID: "main",
          OPENCLAW_SESSION_KEY: "agent:main:acp:test",
        },
      },
    });
  });

  it("keeps identity and custom environment when dropping an unsupported inherited model", async () => {
    const ensure = vi
      .fn()
      .mockRejectedValueOnce(
        new RequestedModelUnsupportedError("No model support", "missing-capability"),
      )
      .mockResolvedValueOnce({
        sessionKey: "agent:main:acp:test",
        backend: "acpx",
        runtimeSessionName: "test",
      });

    const handle = await ensureSessionWithModelRef(ensure, {
      sessionKey: "agent:main:acp:test",
      agent: "codex",
      mode: "persistent",
      model: "openai/gpt-5.4",
      sessionOptions: { env: { CUSTOM_VALUE: "fixture" } },
    });

    expect(handle.appliedModel).toEqual({ kind: "dropped" });
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenLastCalledWith({
      sessionKey: "agent:main:acp:test",
      agent: "codex",
      mode: "persistent",
      model: undefined,
      sessionOptions: {
        env: {
          CUSTOM_VALUE: "fixture",
          OPENCLAW_SHELL: "acpx-runtime",
          OPENCLAW_AGENT_ID: "main",
          OPENCLAW_SESSION_KEY: "agent:main:acp:test",
        },
      },
    });
  });
});
