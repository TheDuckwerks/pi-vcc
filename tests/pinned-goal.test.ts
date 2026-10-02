import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { registerGoal } from "../src/commands/goal";
import { GOAL_ENTRY_TYPE, GOAL_MESSAGE_TYPE, normalizeGoal, readPinnedGoal, withPinnedGoal } from "../src/core/pinned-goal";
import { compile } from "../src/core/summarize";

function harness(manager = SessionManager.inMemory("/synthetic")) {
  let command: any, tool: any, context: any;
  const notices: string[] = [];
  registerGoal({
    registerCommand(_name: string, handler: any) { command = handler; },
    registerTool(handler: any) { tool = handler; },
    appendEntry(type: string, data: any) { manager.appendCustomEntry(type, data); },
    on(_event: string, handler: any) { context = handler; },
  } as any);
  const ctx = { sessionManager: manager, ui: { notify: (s: string) => notices.push(s) } };
  return { manager, notices,
    command: (args: string) => command.handler(args, ctx),
    tool: (args: any) => tool.execute("t", args, undefined, undefined, ctx),
    context: (messages: any[]) => context({ messages }, ctx),
  };
}

describe("session reference pin", () => {
  test("manual set/show/clear, normalized and bounded, no agent setter", async () => {
    const h = harness();
    await h.command("");
    expect(h.notices.pop()).toBe("No pinned goal.");
    await h.command("Fix   the receipts\nonly");
    expect(readPinnedGoal(h.manager.getBranch())?.text).toBe("Fix the receipts only");
    await h.command("x".repeat(501));
    expect(readPinnedGoal(h.manager.getBranch())?.text).toBe("Fix the receipts only");
    await h.command("clear");
    expect(readPinnedGoal(h.manager.getBranch())).toBeNull();
    await h.command("set clear");
    expect(readPinnedGoal(h.manager.getBranch())?.text).toBe("clear");
    expect(() => normalizeGoal("\u001b[31mhello")).toThrow();
    expect(() => normalizeGoal("   ")).toThrow();
  });

  test("guarded agent clear rejects absent, replaced, and reasonless pins", async () => {
    const h = harness();
    await h.command("First goal");
    const first = (await h.tool({ action: "get" })).details.goal;
    await h.command("Second goal");
    await expect(h.tool({ action: "clear", expectedId: first.entryId, reason: "Done" })).rejects.toThrow();
    const second = (await h.tool({ action: "get" })).details.goal;
    await expect(h.tool({ action: "clear", expectedId: second.entryId })).rejects.toThrow();
    expect(readPinnedGoal(h.manager.getBranch())).toEqual(second);
    await h.tool({ action: "clear", expectedId: second.entryId, reason: "Agreed result verified" });
    expect(readPinnedGoal(h.manager.getBranch())).toBeNull();
    expect((h.manager.getLeafEntry() as any).data.clearedGoalId).toBe(second.entryId);
    await expect(h.tool({ action: "clear", expectedId: second.entryId, reason: "Done" })).rejects.toThrow();
  });

  test("branch navigation restores ancestor state, never an abandoned pin", async () => {
    const h = harness();
    await h.command("Ancestor goal");
    const ancestor = h.manager.getLeafId()!;
    await h.command("Abandoned goal");
    h.manager.branch(ancestor);
    expect(readPinnedGoal(h.manager.getBranch())?.text).toBe("Ancestor goal");
    await h.command("clear");
    expect(readPinnedGoal(h.manager.getBranch())).toBeNull();
  });

  test("malformed latest metadata and explicit clears do not revive older pins", () => {
    const valid = { type: "custom", customType: GOAL_ENTRY_TYPE, id: "a", data: { version: 1, text: "A goal" } };
    for (const data of [{ version: 1, text: null }, { version: 2, text: "Wrong schema" }, null,
                        { version: 1, text: "x".repeat(501) }]) {
      expect(readPinnedGoal([valid, { ...valid, id: "b", data }])).toBeNull();
    }
  });

  test("context is ephemeral, latest pin replaces stale summary pin, clear removes it", async () => {
    const h = harness();
    const original = [{ role: "user", content: "Different latest request", timestamp: 0 }];
    expect(h.context(original)).toBeUndefined();
    await h.command("First goal");
    const first = h.context(original).messages;
    expect(first[0].customType).toBe(GOAL_MESSAGE_TYPE);
    expect(first[0].content).toContain("First goal");
    expect(first[1]).toEqual(original[0]);
    expect(h.manager.getBranch()).toHaveLength(1); // metadata only, no messages
    const summary = { role: "compactionSummary", summary: withPinnedGoal("[Session Goal]\n- Earlier request", readPinnedGoal(h.manager.getBranch())) };
    await h.command("Second goal");
    const next = h.context([summary, ...first]).messages;
    expect(next.filter((m: any) => m.customType === GOAL_MESSAGE_TYPE)).toHaveLength(1);
    expect(next[0].content).toContain("Second goal");
    expect(next[1].summary).not.toContain("First goal");
    expect(summary.summary).toContain("First goal"); // did not mutate history
    await h.command("clear");
    const cleared = h.context([summary, ...next]).messages;
    expect(cleared.some((m: any) => m.customType === GOAL_MESSAGE_TYPE)).toBe(false);
    expect(cleared[0].summary).not.toContain("User-pinned Goal");
  });

  test("repeated summary merge preserves one explicit pin, never infers or revives it", () => {
    const goal = { entryId: "g", text: "A pinned goal" };
    const input: any = { messages: [{ role: "user", content: "Build the small feature", timestamp: 0 }] };
    const first = withPinnedGoal(compile(input), goal);
    const second = withPinnedGoal(compile({ ...input, previousSummary: first }), goal);
    expect(second.match(/\[User-pinned Goal\]/g)).toHaveLength(1);
    const cleared = withPinnedGoal(compile({ ...input, previousSummary: second }), null);
    expect(cleared).not.toContain("A pinned goal");
    expect(withPinnedGoal("unchanged", null)).toBe("unchanged");
  });

  test("real SessionManager persistence, compaction, reopen and branch export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vcc-goal-"));
    try {
      const manager = SessionManager.create(dir, dir);
      manager.appendMessage({ role: "user", content: "Begin", timestamp: 0 });
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ready" }],
        api: "openai-responses", provider: "synthetic", model: "synthetic", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 });
      const h = harness(manager);
      await h.command("Survive compaction and resume");
      const expected = readPinnedGoal(manager.getBranch());
      manager.appendCompaction(withPinnedGoal("A summary", expected), "", 1000);
      expect(readPinnedGoal(manager.getBranch())).toEqual(expected);
      const reopened = SessionManager.open(manager.getSessionFile()!);
      expect(readPinnedGoal(reopened.getBranch())).toEqual(expected);
      const host = await import(new URL("./core/session-export.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
      const file = host.exportSessionToJsonl(reopened, join(dir, "export.jsonl"));
      expect(readPinnedGoal(SessionManager.open(file).getBranch())).toEqual(expected);
      const resumed = harness(reopened);
      await resumed.command("clear");
      expect(readPinnedGoal(SessionManager.open(reopened.getSessionFile()!).getBranch())).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
