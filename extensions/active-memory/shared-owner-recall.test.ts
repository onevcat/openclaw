import type { MemorySearchResult } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import { describe, expect, it } from "vitest";
import {
  formatSharedOwnerSessionContext,
  selectSharedOwnerSessionHits,
} from "./shared-owner-recall.js";

const mainSessionKey = "agent:main:discord:default:direct:onevcat";
const pawSessionKey = "agent:onevpaw:discord:onevpaw:direct:onevcat";
const groupSessionKey = "agent:onevpaw:discord:onevpaw:group:cats";

function hit(snippet: string, score = 0.8): MemorySearchResult {
  return {
    path: "sessions/onevpaw/example-session.jsonl",
    startLine: 1,
    endLine: 2,
    score,
    snippet,
    source: "sessions",
  };
}

describe("shared owner direct recall", () => {
  it("returns only configured sibling direct-message hits and excludes the live session", () => {
    const selected = selectSharedOwnerSessionHits({
      currentSessionKey: mainSessionKey,
      sharedOwnerDirectSessionKeys: [mainSessionKey, pawSessionKey],
      candidates: [
        { agentId: "main", sessionKeys: [mainSessionKey], hit: hit("current thread", 0.95) },
        { agentId: "onevpaw", sessionKeys: [pawSessionKey], hit: hit("paw handoff", 0.9) },
        { agentId: "onevpaw", sessionKeys: [groupSessionKey], hit: hit("group secret", 0.99) },
      ],
    });

    expect(selected).toEqual([{ agentId: "onevpaw", hit: hit("paw handoff", 0.9) }]);
    expect(formatSharedOwnerSessionContext(selected)).toContain("paw handoff");
    expect(formatSharedOwnerSessionContext(selected)).not.toContain("group secret");
  });

  it("fails closed when the current conversation is outside the configured owner cluster", () => {
    expect(
      selectSharedOwnerSessionHits({
        currentSessionKey: "agent:main:discord:default:direct:someone-else",
        sharedOwnerDirectSessionKeys: [mainSessionKey, pawSessionKey],
        candidates: [{ agentId: "onevpaw", sessionKeys: [pawSessionKey], hit: hit("private") }],
      }),
    ).toEqual([]);
  });
});
