import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import extension from "../index";
import { tmpdir } from "os";
import { join } from "path";
import { registerBeforeCompactHook, PI_VCC_COMPACT_INSTRUCTION } from "../src/hooks/before-compact";
import fixture from "./fixtures/quack-batch.json";
import profileJson from "../examples/duckwerks-recognition.json";

let dir: string;
let previousConfig: string | undefined;
beforeEach(() => {
  previousConfig = process.env.PI_VCC_CONFIG_PATH;
  dir = mkdtempSync(join(tmpdir(), "vcc-profile-hook-"));
  process.env.PI_VCC_CONFIG_PATH = join(dir, "config.json");
});
afterEach(() => {
  if (previousConfig == null) delete process.env.PI_VCC_CONFIG_PATH;
  else process.env.PI_VCC_CONFIG_PATH = previousConfig;
  rmSync(dir, { recursive: true, force: true });
});

const run = (profilePath?: string, previousSummary?: string, prepare?: (entries: any[]) => any) => {
  writeFileSync(process.env.PI_VCC_CONFIG_PATH!, JSON.stringify({
    debug: false, smartKeepTail: false, overrideDefaultCompaction: true,
    ...(profilePath ? { recognitionProfilePath: profilePath } : {}),
  }));
  const entries = [
    { type: "message", id: "u1", message: { role: "user", content: "Make the approved changes", timestamp: 0 } },
    ...fixture.messages.map((message, i) => ({ type: "message", id: `q${i}`, message })),
    { type: "message", id: "a1", message: { role: "assistant", content: [{ type: "text", text: "Commits recorded." }], timestamp: 0 } },
    { type: "message", id: "u2", message: { role: "user", content: "Review the result", timestamp: 0 } },
    { type: "message", id: "a2", message: { role: "assistant", content: [{ type: "text", text: "Reviewing." }], timestamp: 0 } },
  ].map((entry, i, all) => ({ ...entry, parentId: all[i - 1]?.id ?? null }));
  // Abandoned entries count globally but are not in the summarized lineage.
  const all = [
    ...Array.from({ length: 122 }, (_, i) => ({ type: "message", id: `abandoned${i}`, message: { role: "user", content: "Other branch" } })),
    { type: "custom", id: "metadata", data: {} }, ...entries,
  ];
  let handler: any;
  registerBeforeCompactHook({ on(name: string, h: any) { if (name === "session_before_compact") handler = h; } } as any);
  const notifications: string[] = [];
  const ctx = { ui: { notify: (message: string) => notifications.push(message) }, sessionManager: { getEntries: () => all } };
  const response = handler({
    branchEntries: entries, customInstructions: `${PI_VCC_COMPACT_INSTRUCTION} keep:1`, reason: "manual",
    preparation: prepare?.(entries) ?? { previousSummary, fileOps: { read: [], written: [], edited: [] }, tokensBefore: 2000 },
  }, ctx);
  return { response, notifications };
};

describe("profile reaches the real compaction hook", () => {
  test("extension entry registers its resources and scaffolds only the explicit test config", () => {
    const commands: string[] = [];
    const tools: string[] = [];
    const events: string[] = [];
    extension({
      on: (name: string) => { events.push(name); },
      registerCommand: (name: string) => { commands.push(name); },
      registerTool: (tool: any) => { tools.push(tool.name); },
    } as any);
    const config = JSON.parse(readFileSync(process.env.PI_VCC_CONFIG_PATH!, "utf8"));
    expect(config.recognitionProfilePath).toBe("");
    expect(commands).toContain("pi-vcc");
    expect(commands).toContain("pi-vcc-recall");
    expect(tools).toContain("vcc_recall");
    expect(events).toContain("session_before_compact");
  });

  test("adds both receipts without changing the cut, kept tail or transcript", () => {
    const path = join(dir, "profile.json");
    writeFileSync(path, JSON.stringify(profileJson));
    const off = run();
    const on = run(path);
    expect(off.response.compaction.firstKeptEntryId).toBe("u2");
    expect(on.response.compaction.firstKeptEntryId).toBe(off.response.compaction.firstKeptEntryId);
    const summary = on.response.compaction.summary;
    expect(summary).toContain("b17ba20: Add on-demand subagent recipes and audit schema ref #134 (#124)");
    expect(summary).toContain("42e3557: Specify the subagent recipe pilot ref #134 (#124)");
    expect(summary).toContain("(#123)");
    expect(summary).toContain("Make the approved changes (#122)");
    expect(summary.split("\n\n---\n\n")[1]).toBe(off.response.compaction.summary.split("\n\n---\n\n")[1]);
    expect(on.notifications).toEqual([]);
  });

  test("short smoke reaches the hook only after Pi core retention is lowered", async () => {
    // Exercise the installed host's preparation boundary, not just a fabricated
    // hook event. This private module is test-only, never a runtime dependency.
    const host = await import(new URL("./core/compaction/compaction.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
    const path = join(dir, "profile.json");
    writeFileSync(path, JSON.stringify(profileJson));
    const { response } = run(path, undefined, entries => {
      expect(host.prepareCompaction(entries, host.DEFAULT_COMPACTION_SETTINGS)).toBeUndefined();
      const preparation = host.prepareCompaction(entries, { ...host.DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 0 });
      expect(preparation).toBeDefined();
      return preparation;
    });
    expect(response.compaction.summary).toContain("b17ba20:");
    expect(response.compaction.summary).toContain("42e3557:");
  });

  test("explicit goal follows the branch through real compaction, including a later clear", () => {
    const first = run(undefined, undefined, entries => {
      entries.push({ type: "custom", id: "pin", customType: "pi-vcc-goal", data: { version: 1, text: "The explicit goal" } });
      return { fileOps: { read: [], written: [], edited: [] }, tokensBefore: 2000 };
    }).response.compaction.summary;
    expect(first).toStartWith("[User-pinned Goal]");
    expect(first).toContain("The explicit goal");
    const cleared = run(undefined, first, entries => {
      entries.push({ type: "custom", id: "clear", customType: "pi-vcc-goal", data: { version: 1, text: null } });
      return { previousSummary: first, fileOps: { read: [], written: [], edited: [] }, tokensBefore: 2000 };
    }).response.compaction.summary;
    expect(cleared).not.toContain("The explicit goal");
  });

  test("malformed and missing sidecars warn and preserve built-in compaction", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "broken JSON");
    const baseline = run().response.compaction.summary;
    for (const candidate of [path, join(dir, "missing.json")]) {
      const { response, notifications } = run(candidate);
      expect(response.compaction.summary).toBe(baseline);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toContain("Using built-in extraction");
    }
  });

  test("repeated merge retains one entry per commit", () => {
    const path = join(dir, "profile.json");
    writeFileSync(path, JSON.stringify(profileJson));
    const first = run(path).response.compaction.summary;
    const next = run(path, first).response.compaction.summary;
    expect(next.match(/^- b17ba20:/gm)).toHaveLength(1);
    expect(next.match(/^- 42e3557:/gm)).toHaveLength(1);
  });
});
