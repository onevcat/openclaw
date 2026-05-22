import { describe, expect, it } from "vitest";
import { buildHookCallbackPayload, extractTerminalHookResult } from "./hook-callback.js";

describe("extractTerminalHookResult", () => {
  it("parses terminal hook result blocks", () => {
    const parsed = extractTerminalHookResult(
      [
        "Finished the task.",
        "<openclaw_hook_result>",
        '{"status":"ok","summary":"Opened PR #157 and commented on issue #143."}',
        "</openclaw_hook_result>",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      status: "ok",
      summary: "Opened PR #157 and commented on issue #143.",
    });
  });

  it("returns null for missing result blocks", () => {
    expect(extractTerminalHookResult("done")).toBeNull();
  });
});

describe("buildHookCallbackPayload", () => {
  it("uses terminal hook result blocks when required", () => {
    const payload = buildHookCallbackPayload({
      callbackBody: { traceId: "trace-1", requireTerminalHookResult: true },
      runId: "run-1",
      hookName: "MeowHook-GitHub-onevpaw",
      agentId: "onevpaw",
      sessionKey: "agent:onevpaw:hook:test",
      result: {
        status: "ok",
        summary: "intermediate summary",
        outputText: [
          "All done.",
          "<openclaw_hook_result>",
          '{"status":"ok","summary":"Opened PR #157 and posted the issue follow-up comment."}',
          "</openclaw_hook_result>",
        ].join("\n"),
      },
    });

    expect(payload).toMatchObject({
      traceId: "trace-1",
      ok: true,
      status: "ok",
      summary: "Opened PR #157 and posted the issue follow-up comment.",
      outputText: [
        "All done.",
        "<openclaw_hook_result>",
        '{"status":"ok","summary":"Opened PR #157 and posted the issue follow-up comment."}',
        "</openclaw_hook_result>",
      ].join("\n"),
      runId: "run-1",
      hook: "MeowHook-GitHub-onevpaw",
      agent: "onevpaw",
      sessionKey: "agent:onevpaw:hook:test",
    });
    expect(payload).not.toHaveProperty("requireTerminalHookResult");
  });

  it("fails closed when a required terminal hook result block is missing", () => {
    const payload = buildHookCallbackPayload({
      callbackBody: { traceId: "trace-2", requireTerminalHookResult: true },
      runId: "run-2",
      hookName: "MeowHook-GitHub-onevpaw",
      sessionKey: "agent:onevpaw:hook:test",
      result: {
        status: "ok",
        summary: "plain final reply without schema",
        outputText: "plain final reply without schema",
      },
    });

    expect(payload).toMatchObject({
      traceId: "trace-2",
      ok: false,
      status: "error",
      error: "missing_terminal_hook_result",
      summary: "plain final reply without schema",
    });
  });

  it("lets required terminal hook result override soft intermediate errors", () => {
    const payload = buildHookCallbackPayload({
      callbackBody: { requireTerminalHookResult: true },
      runId: "run-3",
      hookName: "MeowHook-GitHub-onevpaw",
      sessionKey: "agent:onevpaw:hook:test",
      result: {
        status: "error",
        error: "push_failed",
        outputText: [
          "Recovered after an intermediate tool failure.",
          "<openclaw_hook_result>",
          '{"status":"ok","summary":"Opened PR #157 and posted the issue follow-up comment."}',
          "</openclaw_hook_result>",
        ].join("\n"),
      },
    });

    expect(payload).toMatchObject({
      ok: true,
      status: "ok",
      summary: "Opened PR #157 and posted the issue follow-up comment.",
      error: undefined,
    });
  });

  it("keeps hard runtime failures fatal even if the required terminal block says ok", () => {
    const payload = buildHookCallbackPayload({
      callbackBody: { requireTerminalHookResult: true },
      runId: "run-4",
      hookName: "MeowHook-GitHub-onevpaw",
      sessionKey: "agent:onevpaw:hook:test",
      result: {
        status: "error",
        error: "session timed out",
        outputText: [
          "Trying to recover.",
          "<openclaw_hook_result>",
          '{"status":"ok","summary":"should not override runtime timeout"}',
          "</openclaw_hook_result>",
        ].join("\n"),
      },
    });

    expect(payload).toMatchObject({
      ok: false,
      status: "error",
      error: "session timed out",
    });
  });

  it("treats timeout status as a hard runtime failure", () => {
    const payload = buildHookCallbackPayload({
      callbackBody: { requireTerminalHookResult: true },
      runId: "run-5",
      hookName: "MeowHook-GitHub-onevpaw",
      sessionKey: "agent:onevpaw:hook:test",
      result: {
        status: "timeout",
        outputText: [
          "Trying to recover.",
          "<openclaw_hook_result>",
          '{"status":"ok","summary":"should not override timeout status"}',
          "</openclaw_hook_result>",
        ].join("\n"),
      },
    });

    expect(payload).toMatchObject({
      ok: false,
      status: "timeout",
    });
  });
});
