import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeAgentRuntime,
  makeEmptySessionStore,
  makeRuntime,
  readFirstEnsureSessionInput,
  type TestSessionStore,
} from "./runtime.test-support.js";

const CODEX_ACP_COMMAND = "npx @agentclientprotocol/codex-acp@1.11.0";

describe("ACPX startup session options", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { model: "gpt-5.4", controls: {} },
    { model: "gpt-5.5", controls: {} },
    { model: "gpt-5.6-sol", controls: { thinking: "medium" } },
  ] as const)(
    "normalizes Codex startup $model and keeps thinking separate",
    async ({ model, controls }) => {
      const { runtime, ensure } = makeAgentRuntime("codex", CODEX_ACP_COMMAND);

      await runtime.ensureSession({
        sessionKey: "agent:codex:acp:test",
        agent: "codex",
        mode: "persistent",
        model: `openai/${model}`,
        ...controls,
      });

      expect(readFirstEnsureSessionInput(ensure)).toEqual({
        sessionKey: "agent:codex:acp:test",
        agent: "codex",
        mode: "persistent",
        model,
        ...controls,
        sessionOptions: {
          model,
          env: {
            OPENCLAW_SHELL: "acpx-runtime",
            OPENCLAW_AGENT_ID: "codex",
            OPENCLAW_SESSION_KEY: "agent:codex:acp:test",
          },
        },
      });
    },
  );

  it.each([
    {
      name: "strips the OpenClaw Anthropic provider prefix for Claude ACP startup",
      model: "anthropic/claude-sonnet-4-6",
      expectedModel: "claude-sonnet-4-6",
    },
    {
      // Issue #121034: Bedrock rejects provider-qualified refs.
      name: "matches the Bedrock provider prefix case-insensitively",
      model: "Amazon-Bedrock/us.anthropic.claude-opus-4-6-v1",
      expectedModel: "us.anthropic.claude-opus-4-6-v1",
    },
    {
      // Bare inference-profile ids and ARNs are native Bedrock values the SDK
      // accepts as-is; only the documented OpenClaw prefixes may be stripped.
      name: "preserves native Bedrock inference-profile ids",
      model: "global.anthropic.claude-sonnet-5",
      expectedModel: "global.anthropic.claude-sonnet-5",
    },
    {
      name: "preserves Bedrock inference-profile ARNs",
      model:
        "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-5",
      expectedModel:
        "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-5",
    },
  ])("$name", async ({ model, expectedModel }) => {
    const baseStore: TestSessionStore = makeEmptySessionStore();
    const { runtime, delegate } = makeRuntime(baseStore, {
      agentRegistry: {
        resolve: (agentName: string) =>
          agentName === "claude" ? "npx @agentclientprotocol/claude-agent-acp" : agentName,
        list: () => ["claude", "openclaw"],
      },
    });
    const ensure = vi.spyOn(delegate, "ensureSession").mockResolvedValue({
      sessionKey: "agent:claude:acp:test",
      backend: "acpx",
      runtimeSessionName: "claude",
    });

    await runtime.ensureSession({
      sessionKey: "agent:claude:acp:test",
      agent: "claude",
      mode: "persistent",
      model,
    });

    expect(readFirstEnsureSessionInput(ensure)).toEqual({
      sessionKey: "agent:claude:acp:test",
      agent: "claude",
      mode: "persistent",
      model: expectedModel,
      sessionOptions: {
        model: expectedModel,
        env: {
          OPENCLAW_SHELL: "acpx-runtime",
          OPENCLAW_AGENT_ID: "claude",
          OPENCLAW_SESSION_KEY: "agent:claude:acp:test",
        },
      },
    });
  });

  it("leaves Codex ACP startup defaults alone when no model or thinking is provided", async () => {
    const { runtime, ensure } = makeAgentRuntime("codex", CODEX_ACP_COMMAND);

    await runtime.ensureSession({
      sessionKey: "agent:codex:acp:test",
      agent: "codex",
      mode: "persistent",
    });

    const ensureInput = readFirstEnsureSessionInput(ensure);
    expect(ensureInput).toEqual({
      sessionKey: "agent:codex:acp:test",
      agent: "codex",
      mode: "persistent",
      sessionOptions: {
        env: {
          OPENCLAW_SHELL: "acpx-runtime",
          OPENCLAW_AGENT_ID: "codex",
          OPENCLAW_SESSION_KEY: "agent:codex:acp:test",
        },
      },
    });
    expect(ensureInput).not.toHaveProperty("model");
    expect(ensureInput).not.toHaveProperty("thinking");
  });
});
