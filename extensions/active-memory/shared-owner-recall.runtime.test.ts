import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveSharedOwnerSessionContext } from "./shared-owner-recall.js";

const ownerKey = "agent:main:discord:default:direct:owner";
const siblingKey = "agent:onevpaw:discord:onevpaw:direct:owner";
const io = vi.hoisted(() => ({ search: vi.fn(), list: vi.fn() }));
vi.mock("openclaw/plugin-sdk/memory-host-search", () => ({
  getActiveMemorySearchManager: async () => ({ manager: { search: io.search } }),
}));
vi.mock("openclaw/plugin-sdk/session-store-runtime", () => ({
  listSessionEntriesAsync: (...args: unknown[]) => io.list(...args),
}));

beforeEach(() => {
  io.search.mockReset().mockResolvedValue([
    {
      path: "transcript:onevpaw:sibling-session",
      source: "sessions",
      snippet: "Owner chose the morning train.",
      score: 0.9,
      startLine: 1,
      endLine: 2,
    },
    {
      path: "transcript:onevpaw:unbound-session",
      source: "sessions",
      snippet: "Unbound private content.",
      score: 1,
      startLine: 1,
      endLine: 2,
    },
  ]);
  io.list
    .mockReset()
    .mockResolvedValue([
      { sessionKey: siblingKey, entry: { sessionId: "sibling-session", updatedAt: 1 } },
    ]);
});

function recall() {
  return resolveSharedOwnerSessionContext({
    cfg: {} as OpenClawConfig,
    agentId: "main",
    currentSessionKey: ownerKey,
    query: "train",
    sharedOwnerDirectSessionKeys: [ownerKey, siblingKey],
  });
}

it("uses asynchronous public session bindings and excludes unbound transcript hits", async () => {
  const context = await recall();
  expect(context).toContain("Owner chose the morning train.");
  expect(context).not.toContain("Unbound private content.");
});

it("does not expose any transcript when persisted binding reads fail", async () => {
  io.list.mockRejectedValue(new Error("offline store"));
  expect(await recall()).toBeUndefined();
});
