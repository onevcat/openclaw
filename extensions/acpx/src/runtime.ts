import {
  ACPX_BACKEND_ID,
  AcpxRuntime as BaseAcpxRuntime,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  decodeAcpxRuntimeHandleState,
  encodeAcpxRuntimeHandleState,
  type AcpAgentRegistry,
  type AcpRuntimeDoctorReport,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeOptions,
  type AcpRuntimeStatus,
} from "acpx/runtime";
import type { AcpRuntime } from "../runtime-api.js";

const RUNTIME_ENV_SHELL = "acpx-runtime";
const RUNTIME_ENV_KEYS = ["OPENCLAW_AGENT_ID", "OPENCLAW_SESSION_KEY", "OPENCLAW_SHELL"] as const;

type RuntimeEnvPatch = Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string>>;

type AcpSessionStore = AcpRuntimeOptions["sessionStore"];
type AcpSessionRecord = Parameters<AcpSessionStore["save"]>[0];
type AcpLoadedSessionRecord = Awaited<ReturnType<AcpSessionStore["load"]>>;

type ResetAwareSessionStore = AcpSessionStore & {
  markFresh: (sessionKey: string) => void;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOpenClawAgentId(value?: string): string | undefined {
  const trimmed = asTrimmedString(value);
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "default" || trimmed === "onevclaw") {
    return "main";
  }
  if (trimmed === "main" || trimmed === "onevpaw" || trimmed === "onevtail") {
    return trimmed;
  }
  return undefined;
}

function deriveAgentFromSessionKey(sessionKey?: string): string | undefined {
  const match = asTrimmedString(sessionKey).match(/^agent:([^:]+):/i);
  return asTrimmedString(match?.[1]) || undefined;
}

function resolveOpenClawAgentId(params: {
  sessionKey?: string;
  runtimeAgent?: string;
}): string | undefined {
  const sessionKey = asTrimmedString(params.sessionKey);
  const bindingMatch = sessionKey.match(/^agent:[^:]+:acp:binding:[^:]+:([^:]+):/i);
  const fromBindingAccount = toOpenClawAgentId(asTrimmedString(bindingMatch?.[1]));
  const fromSessionKey = toOpenClawAgentId(deriveAgentFromSessionKey(sessionKey));
  const fromRuntimeAgent = toOpenClawAgentId(params.runtimeAgent);
  return fromBindingAccount || fromSessionKey || fromRuntimeAgent;
}

function buildRuntimeEnvPatch(params: {
  sessionKey?: string;
  runtimeAgent?: string;
}): RuntimeEnvPatch {
  const patch: RuntimeEnvPatch = {
    OPENCLAW_SHELL: RUNTIME_ENV_SHELL,
  };
  const sessionKey = asTrimmedString(params.sessionKey);
  const resolvedAgentId = resolveOpenClawAgentId(params);
  if (resolvedAgentId) {
    patch.OPENCLAW_AGENT_ID = resolvedAgentId;
  }
  if (sessionKey) {
    patch.OPENCLAW_SESSION_KEY = sessionKey;
  }
  return patch;
}

function readSessionRecordName(record: AcpSessionRecord): string {
  if (typeof record !== "object" || record === null) {
    return "";
  }
  const { name } = record as { name?: unknown };
  return typeof name === "string" ? name.trim() : "";
}

function createResetAwareSessionStore(baseStore: AcpSessionStore): ResetAwareSessionStore {
  const freshSessionKeys = new Set<string>();

  return {
    async load(sessionId: string): Promise<AcpLoadedSessionRecord> {
      const normalized = sessionId.trim();
      if (normalized && freshSessionKeys.has(normalized)) {
        return undefined;
      }
      return await baseStore.load(sessionId);
    },
    async save(record: AcpSessionRecord): Promise<void> {
      await baseStore.save(record);
      const sessionName = readSessionRecordName(record);
      if (sessionName) {
        freshSessionKeys.delete(sessionName);
      }
    },
    markFresh(sessionKey: string): void {
      const normalized = sessionKey.trim();
      if (normalized) {
        freshSessionKeys.add(normalized);
      }
    },
  };
}

type AcpxRuntimeLike = AcpRuntime & {
  probeAvailability(): Promise<void>;
  isHealthy(): boolean;
  doctor(): Promise<AcpRuntimeDoctorReport>;
};

export class AcpxRuntime implements AcpxRuntimeLike {
  private readonly sessionStore: ResetAwareSessionStore;
  private readonly delegate: BaseAcpxRuntime;
  private runtimeEnvTail: Promise<void> = Promise.resolve();

  constructor(
    options: AcpRuntimeOptions,
    testOptions?: ConstructorParameters<typeof BaseAcpxRuntime>[1],
  ) {
    this.sessionStore = createResetAwareSessionStore(options.sessionStore);
    this.delegate = new BaseAcpxRuntime(
      {
        ...options,
        sessionStore: this.sessionStore,
      },
      testOptions,
    );
  }

  isHealthy(): boolean {
    return this.delegate.isHealthy();
  }

  probeAvailability(): Promise<void> {
    return this.delegate.probeAvailability();
  }

  doctor(): Promise<AcpRuntimeDoctorReport> {
    return this.delegate.doctor();
  }

  ensureSession(input: Parameters<AcpRuntime["ensureSession"]>[0]): Promise<AcpRuntimeHandle> {
    return this.withPatchedRuntimeEnv(
      buildRuntimeEnvPatch({
        sessionKey: input.sessionKey,
        runtimeAgent: input.agent,
      }),
      () => this.delegate.ensureSession(input),
    );
  }

  runTurn(input: Parameters<AcpRuntime["runTurn"]>[0]): AsyncIterable<AcpRuntimeEvent> {
    return this.runTurnWithPatchedRuntimeEnv(input);
  }

  getCapabilities(): ReturnType<BaseAcpxRuntime["getCapabilities"]> {
    return this.delegate.getCapabilities();
  }

  getStatus(input: Parameters<NonNullable<AcpRuntime["getStatus"]>>[0]): Promise<AcpRuntimeStatus> {
    return this.delegate.getStatus(input);
  }

  setMode(input: Parameters<NonNullable<AcpRuntime["setMode"]>>[0]): Promise<void> {
    return this.delegate.setMode(input);
  }

  setConfigOption(input: Parameters<NonNullable<AcpRuntime["setConfigOption"]>>[0]): Promise<void> {
    return this.delegate.setConfigOption(input);
  }

  cancel(input: Parameters<AcpRuntime["cancel"]>[0]): Promise<void> {
    return this.delegate.cancel(input);
  }

  async prepareFreshSession(input: { sessionKey: string }): Promise<void> {
    this.sessionStore.markFresh(input.sessionKey);
  }

  close(input: Parameters<AcpRuntime["close"]>[0]): Promise<void> {
    return this.delegate
      .close({
        handle: input.handle,
        reason: input.reason,
        discardPersistentState: input.discardPersistentState,
      })
      .then(() => {
        if (input.discardPersistentState) {
          this.sessionStore.markFresh(input.handle.sessionKey);
        }
      });
  }

  private applyRuntimeEnv(patch: RuntimeEnvPatch): () => void {
    const previous: Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string>> = {};
    for (const key of RUNTIME_ENV_KEYS) {
      previous[key] = process.env[key];
      const nextValue = asTrimmedString(patch[key]);
      if (nextValue) {
        process.env[key] = nextValue;
      } else {
        delete process.env[key];
      }
    }
    return () => {
      for (const key of RUNTIME_ENV_KEYS) {
        const previousValue = previous[key];
        if (typeof previousValue === "string") {
          process.env[key] = previousValue;
        } else {
          delete process.env[key];
        }
      }
    };
  }

  private async acquirePatchedRuntimeEnv(patch: RuntimeEnvPatch): Promise<() => void> {
    const waitForPrevious = this.runtimeEnvTail;
    let releaseQueue: (() => void) | undefined;
    this.runtimeEnvTail = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await waitForPrevious;
    const restore = this.applyRuntimeEnv(patch);
    return () => {
      restore();
      releaseQueue?.();
    };
  }

  private async withPatchedRuntimeEnv<T>(
    patch: RuntimeEnvPatch,
    run: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquirePatchedRuntimeEnv(patch);
    try {
      return await run();
    } finally {
      release();
    }
  }

  private async *runTurnWithPatchedRuntimeEnv(
    input: Parameters<AcpRuntime["runTurn"]>[0],
  ): AsyncIterable<AcpRuntimeEvent> {
    const release = await this.acquirePatchedRuntimeEnv(
      buildRuntimeEnvPatch({
        sessionKey: input.handle.sessionKey,
      }),
    );
    try {
      for await (const event of this.delegate.runTurn(input)) {
        yield event;
      }
    } finally {
      release();
    }
  }
}

export {
  ACPX_BACKEND_ID,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  decodeAcpxRuntimeHandleState,
  encodeAcpxRuntimeHandleState,
};

export type { AcpAgentRegistry, AcpRuntimeOptions, AcpSessionRecord, AcpSessionStore };
