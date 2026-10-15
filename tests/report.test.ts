import { describe, it, expect } from "bun:test";
import { buildCompactReport } from "../src/core/report";
import {
  userMsg,
  assistantText,
  assistantWithToolCall,
  toolResult,
} from "./fixtures";

describe("buildCompactReport", () => {
  it("includes before and after compact metrics", () => {
    const report = buildCompactReport({
      messages: [
        userMsg("Fix login bug in auth.ts"),
        assistantWithToolCall("Read", { path: "auth.ts" }),
        toolResult("Read", "const x = 1;"),
        assistantText("Found the root cause in auth.ts.\n1. Fix validation\n2. Run tests"),
      ],
    });
    expect(report.before.messageCount).toBe(4);
    expect(report.before.roleCounts.user).toBe(1);
    expect(report.before.topFiles).toContain("auth.ts");
    expect(report.before.preview).toContain("Fix login bug in auth.ts");
    expect(report.after.sectionCount).toBeGreaterThan(0);
    expect(report.after.summaryPreview).not.toContain("[Session Goal]");
    expect(report.after.summaryPreview).toContain("Read(auth.ts)");
    expect(report.after.briefTranscriptLines).toBeGreaterThan(0);
    expect(report.compression.ratio).toBeGreaterThan(0);
  });

  it("marks recall probe coverage for source-observed file calls", () => {
    const report = buildCompactReport({
      messages: [
        userMsg("Fix login bug in auth.ts"),
        assistantWithToolCall("Read", { path: "auth.ts" }),
        toolResult("Read", "code content"),
        assistantText("Found the root cause"),
      ],
    });
    expect(report.recall.probes.length).toBeGreaterThanOrEqual(1);
    expect(report.recall.probes.every((p) => p.label === "file")).toBe(true);
    const fileProbe = report.recall.probes.find((p) => p.label === "file");
    expect(fileProbe?.query).toContain("auth.ts");
  });

  it("counts recall hits with the probe query", () => {
    const report = buildCompactReport({
      messages: [
        userMsg("Handle unrelated setup"),
        assistantWithToolCall("Read", { path: "unique-auth-file.ts" }),
        toolResult("Read", "code content"),
        assistantText("Done"),
      ],
    });
    const fileProbe = report.recall.probes.find((p) => p.label === "file");
    expect(fileProbe?.query).toBe("unique-auth-file.ts");
    expect(fileProbe?.recallHits).toBe(1);
  });
});
