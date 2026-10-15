import { describe, it, expect } from "bun:test";
import { formatSummary } from "../src/core/format";
import type { SectionData } from "../src/sections";

const empty: SectionData = {
  sessionGoal: [],
  outstandingContext: [],
  filesAndChanges: [],
  commits: [],
  userPreferences: [],
  briefTranscript: "",
};

describe("formatSummary", () => {
  it("returns empty string for all-empty sections", () => {
    expect(formatSummary(empty)).toBe("");
  });

  it("labels file activity as observed tool calls, not confirmed changes", () => {
    const r = formatSummary({ ...empty, filesAndChanges: ['- write(config.json) (#12)'] });
    expect(r).toContain("[File Operations Observed]");
    expect(r).toContain("write(config.json) (#12)");
    expect(r).not.toContain("[Files And Changes]");
  });

  it("omits inferred goal, blocker and preference sections", () => {
    const r = formatSummary({ ...empty, sessionGoal: ["guess"], outstandingContext: ["maybe blocked"], userPreferences: ["inferred"] });
    expect(r).not.toContain("Session Goal");
    expect(r).not.toContain("Outstanding Context");
    expect(r).not.toContain("User Preferences");
  });

  it("separates evidence and transcript with ---", () => {
    const r = formatSummary({ ...empty, commits: ["abc123: landed (#9)"], briefTranscript: "[user]\ndo something" });
    expect(r).toContain("[Commits]");
    expect(r).toContain("---");
    expect(r).toContain("[user]\ndo something");
  });

  it("renders brief transcript alone when no header sections", () => {
    const r = formatSummary({ ...empty, briefTranscript: "[user]\nhi\n\n[assistant]\nhello" });
    expect(r).toContain("[user]\nhi\n\n[assistant]\nhello");
  });

  it("wraps long lines so compaction TUI rendering stays bounded", () => {
    const r = formatSummary({ ...empty, briefTranscript: `[assistant]\n${"word ".repeat(80)}` });
    expect(Math.max(...r.split("\n").map((line) => line.length))).toBeLessThanOrEqual(120);
  });
});
