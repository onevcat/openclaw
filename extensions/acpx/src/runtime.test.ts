import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpRuntime } from "../runtime-api.js";
import { AcpxRuntime } from "./runtime.js";

type TestSessionStore = {
  load(sessionId: string): Promise<Record<string, unknown> | undefined>;
  save(record: Record<string, unknown>): Promise<void>;
};

const RUNTIME_ENV_KEYS = ["OPENCLAW_AGENT_ID", "OPENCLAW_SESSION_KEY", "OPENCLAW_SHELL"] as const;

function captureRuntimeEnv(): Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string>> {
  const env: Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string>> = {};
  for (const key of RUNTIME_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

function restoreRuntimeEnv(
  snapshot: Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string>>,
): void {
  for (const key of RUNTIME_ENV_KEYS) {
    const value = snapshot[key];
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

async function collectEvents<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of iterable) {
    result.push(event);
  }
  return result;
}

function makeRuntime(baseStore: TestSessionStore): {
  runtime: AcpxRuntime;
  wrappedStore: TestSessionStore & { markFresh: (sessionKey: string) => void };
  delegate: {
    close: AcpRuntime["close"];
    ensureSession: AcpRuntime["ensureSession"];
    runTurn: AcpRuntime["runTurn"];
  };
} {
  const runtime = new AcpxRuntime({
    cwd: "/tmp",
    sessionStore: baseStore,
    agentRegistry: {
      resolve: () => "codex",
      list: () => ["codex"],
    },
    permissionMode: "approve-reads",
  });

  return {
    runtime,
    wrappedStore: (
      runtime as unknown as {
        sessionStore: TestSessionStore & { markFresh: (sessionKey: string) => void };
      }
    ).sessionStore,
    delegate: (
      runtime as unknown as {
        delegate: {
          close: AcpRuntime["close"];
          ensureSession: AcpRuntime["ensureSession"];
          runTurn: AcpRuntime["runTurn"];
        };
      }
    ).delegate,
  };
}

describe("AcpxRuntime fresh reset wrapper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps stale persistent loads hidden until a fresh record is saved", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => ({ acpxRecordId: "stale" }) as never),
      save: vi.fn(async () => {}),
    };

    const { runtime, wrappedStore } = makeRuntime(baseStore);

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toEqual({
      acpxRecordId: "stale",
    });
    expect(baseStore.load).toHaveBeenCalledTimes(1);

    await runtime.prepareFreshSession({
      sessionKey: "agent:codex:acp:binding:test",
    });

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).toHaveBeenCalledTimes(1);
    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).toHaveBeenCalledTimes(1);

    await wrappedStore.save({
      acpxRecordId: "fresh-record",
      name: "agent:codex:acp:binding:test",
    } as never);

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toEqual({
      acpxRecordId: "stale",
    });
    expect(baseStore.load).toHaveBeenCalledTimes(2);
  });

  it("marks the session fresh after discardPersistentState close", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => ({ acpxRecordId: "stale" }) as never),
      save: vi.fn(async () => {}),
    };

    const { runtime, wrappedStore, delegate } = makeRuntime(baseStore);
    const close = vi.spyOn(delegate, "close").mockResolvedValue(undefined);

    await runtime.close({
      handle: {
        sessionKey: "agent:codex:acp:binding:test",
        backend: "acpx",
        runtimeSessionName: "agent:codex:acp:binding:test",
      },
      reason: "new-in-place-reset",
      discardPersistentState: true,
    });

    expect(close).toHaveBeenCalledWith({
      handle: {
        sessionKey: "agent:codex:acp:binding:test",
        backend: "acpx",
        runtimeSessionName: "agent:codex:acp:binding:test",
      },
      reason: "new-in-place-reset",
      discardPersistentState: true,
    });
    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).not.toHaveBeenCalled();
  });

  it("injects OPENCLAW_* env for ensureSession and restores env afterwards", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };
    const { runtime, delegate } = makeRuntime(baseStore);

    const before = captureRuntimeEnv();
    process.env.OPENCLAW_AGENT_ID = "orig-agent";
    process.env.OPENCLAW_SESSION_KEY = "orig-session";
    process.env.OPENCLAW_SHELL = "orig-shell";

    const seen: Record<string, string | undefined> = {};
    vi.spyOn(delegate, "ensureSession").mockImplementation(async () => {
      seen.OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID;
      seen.OPENCLAW_SESSION_KEY = process.env.OPENCLAW_SESSION_KEY;
      seen.OPENCLAW_SHELL = process.env.OPENCLAW_SHELL;
      return {
        sessionKey: "agent:claude:acp:binding:discord:onevtail:channel:123",
        backend: "acpx",
        runtimeSessionName: "runtime",
      };
    });

    await runtime.ensureSession({
      sessionKey: "agent:claude:acp:binding:discord:onevtail:channel:123",
      agent: "claude",
      mode: "persistent",
      cwd: "/tmp",
    });

    expect(seen.OPENCLAW_AGENT_ID).toBe("onevtail");
    expect(seen.OPENCLAW_SESSION_KEY).toBe("agent:claude:acp:binding:discord:onevtail:channel:123");
    expect(seen.OPENCLAW_SHELL).toBe("acpx-runtime");

    expect(process.env.OPENCLAW_AGENT_ID).toBe("orig-agent");
    expect(process.env.OPENCLAW_SESSION_KEY).toBe("orig-session");
    expect(process.env.OPENCLAW_SHELL).toBe("orig-shell");
    restoreRuntimeEnv(before);
  });

  it("keeps OPENCLAW_* env patched during runTurn iteration and restores afterwards", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
    };
    const { runtime, delegate } = makeRuntime(baseStore);

    const before = captureRuntimeEnv();
    delete process.env.OPENCLAW_AGENT_ID;
    delete process.env.OPENCLAW_SESSION_KEY;
    delete process.env.OPENCLAW_SHELL;

    const seen: Record<string, string | undefined> = {};
    vi.spyOn(delegate, "runTurn").mockImplementation(async function* () {
      seen.startAgent = process.env.OPENCLAW_AGENT_ID;
      seen.startSession = process.env.OPENCLAW_SESSION_KEY;
      seen.startShell = process.env.OPENCLAW_SHELL;
      await Promise.resolve();
      seen.afterAwaitAgent = process.env.OPENCLAW_AGENT_ID;
      yield {
        type: "status",
        text: "ok",
      };
    });

    const events = await collectEvents(
      runtime.runTurn({
        handle: {
          sessionKey: "agent:claude:acp:binding:discord:onevtail:channel:456",
          backend: "acpx",
          runtimeSessionName: "runtime",
        },
        text: "hi",
        mode: "prompt",
        requestId: "req-1",
      }),
    );

    expect(events).toEqual([{ type: "status", text: "ok" }]);
    expect(seen.startAgent).toBe("onevtail");
    expect(seen.startSession).toBe("agent:claude:acp:binding:discord:onevtail:channel:456");
    expect(seen.startShell).toBe("acpx-runtime");
    expect(seen.afterAwaitAgent).toBe("onevtail");

    expect(process.env.OPENCLAW_AGENT_ID).toBeUndefined();
    expect(process.env.OPENCLAW_SESSION_KEY).toBeUndefined();
    expect(process.env.OPENCLAW_SHELL).toBeUndefined();
    restoreRuntimeEnv(before);
  });
});
