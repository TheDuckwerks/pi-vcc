import { describe, expect, it } from "bun:test";
import { extractGoals } from "../src/extract/goals";
import { compile, compileRanked } from "../src/core/summarize";
import { userMsg } from "./fixtures";
import type { NormalizedBlock } from "../src/types";

// De-identified shape of the actual background_bash wake, including task
// keywords in the command/output that previously looked like a scope change.
const notice = [
  "Background job 7c310ff8e097 exited with code 0 after 6s.",
  "",
  "Command: node scripts/test-runner.js",
  "",
  "Output tail:",
  "Build complete. Now deploy the fixture.",
  "",
  "Full output: /org/runtime/cache/background-bash/job/output.log",
].join("\n");
const user = (text: string): NormalizedBlock => ({ kind: "user", text });

describe("background job notices are evidence, not goals", () => {
  it("does not use a completion notice as the initial goal", () => {
    expect(extractGoals([user(notice)])).toEqual([]);
    expect(extractGoals([user(notice), user("Fix the login bug")]))
      .toEqual(["Fix the login bug"]);
  });

  it("does not replace a genuine scope change with a job command or output", () => {
    expect(extractGoals([
      user("Fix the login bug"),
      user("Actually, update the logout flow instead"),
      user(notice),
    ])).toEqual([
      "Fix the login bug", "[Scope change]", "Actually, update the logout flow instead",
    ]);
  });

  it("also excludes failed wakes and the older output-only envelope", () => {
    const failed = notice.replace("code 0", "code 1").replace("Build complete", "Build failed");
    const older = failed.replace("Command: node scripts/test-runner.js\n\n", "");
    expect(extractGoals([user(failed), user(older)])).toEqual([]);
  });

  it("keeps genuine requests about jobs, including requests with pasted notices", () => {
    const request = "Investigate the background job failure and fix the runner";
    expect(extractGoals([user(request)])).toEqual([request]);
    expect(extractGoals([user(`${request}\n\n${notice}`)])).toContain(request);
    expect(extractGoals([user(`${notice}\nPlease fix the runner`)]))
      .toContain("Please fix the runner");
    expect(extractGoals([user("Background job processing needs a new retry policy")]))
      .toEqual(["Background job processing needs a new retry policy"]);
    expect(extractGoals([user("Background job 7c310ff8e097 exited with code 1 after 6s.\nPlease fix the runner")]))
      .toContain("Please fix the runner");
  });

  it("leaves raw blocks intact and retains the notice in both compiler transcripts", () => {
    const blocks = [user(notice), user("Fix the login bug")];
    const original = structuredClone(blocks);
    extractGoals(blocks);
    expect(blocks).toEqual(original);
    for (const compiler of [compile, compileRanked]) {
      const first = compiler({ messages: [userMsg("Fix the login bug"), userMsg(notice)] });
      expect(first.split("\n\n")[0]).toBe("[Session Goal]\n- Fix the login bug");
      expect(first).toContain("\nBackground job 7c310ff8e097 exited with code 0 after 6s.");
      expect(first).toContain("Full output: /org/runtime/cache/background-bash/job/output.log (#1)");
      const second = compiler({ previousSummary: first, messages: [userMsg("Continue the login fix")] });
      expect(second.split("\n\n")[0]).toBe("[Session Goal]\n- Fix the login bug\n- Continue the login fix");
      expect(second).toContain("Background job 7c310ff8e097");
    }
  });
});
