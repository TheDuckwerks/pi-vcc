import { describe, it, expect } from "bun:test";
import { buildSections } from "../src/core/build-sections";
import type { NormalizedBlock } from "../src/types";

describe("buildSections", () => {
  it("returns all-empty for no blocks", () => {
    const r = buildSections({ blocks: [] });
    expect(r.sessionGoal).toEqual([]);
    expect(r.outstandingContext).toEqual([]);
    expect(r.userPreferences).toEqual([]);
    expect(r.briefTranscript).toBe("");
  });

  it("populates sections from realistic blocks", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "Fix the auth bug" },
      { kind: "tool_call", name: "Read", args: { file_path: "auth.ts" } },
      { kind: "tool_result", name: "Read", text: "const x = 1;" },
      { kind: "tool_call", name: "Edit", args: { file_path: "auth.ts" } },
      { kind: "tool_result", name: "Edit", text: "ok" },
      { kind: "assistant", text: "- run tests next" },
    ];
    const r = buildSections({ blocks });
    expect(r.sessionGoal).toEqual([]);
    expect(r.filesAndChanges).toContain('Read(auth.ts)');
    expect(r.filesAndChanges).toContain('Edit(auth.ts)');
    expect(r.briefTranscript).toContain('[user]');
    expect(r.briefTranscript).toContain('* Read "auth.ts"');
    expect(r.briefTranscript).toContain('* Edit "auth.ts"');
  });

  it("does not infer goals, blockers or preferences from conversation text", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "user", text: "Fix auth; I prefer concise logs." },
      { kind: "assistant", text: "Tests are still failing after the retry." },
    ];
    const r = buildSections({ blocks });
    expect(r.sessionGoal).toEqual([]);
    expect(r.outstandingContext).toEqual([]);
    expect(r.userPreferences).toEqual([]);
  });

  it("brief transcript hides tool results", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_result", name: "Read", text: "lots of code here ..." },
      { kind: "tool_result", name: "bash", text: "Command not found" },
    ];
    const r = buildSections({ blocks });
    expect(r.briefTranscript).toBe("");
  });

  it("brief transcript merges adjacent assistant sections", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "assistant", text: "Part one." },
      { kind: "tool_call", name: "Read", args: { file_path: "a.ts" } },
      { kind: "assistant", text: "Part two." },
    ];
    const r = buildSections({ blocks });
    const matches = r.briefTranscript.match(/\[assistant\]/g);
    expect(matches?.length).toBe(1);
  });
});
