import { describe, expect, test } from "bun:test";
import type { NormalizedBlock } from "../src/types";
import { extractCommits, formatCommits } from "../src/extract/commits";
import { compileRanked } from "../src/core/summarize";

const call = (command = 'git commit -m "Attempted subject"', id = "git"): NormalizedBlock => ({
  kind: "tool_call", name: "bash", args: { command }, toolCallId: id,
});
const result = (text = "[main abc1234] Actual receipt subject", id = "git", extra = {}): NormalizedBlock => ({
  kind: "tool_result", name: "bash", text, toolCallId: id, sourceIndex: 42, ...extra,
});

describe("built-in Git receipt extraction", () => {
  test("receipt subject and result ref replace attempted subject", () => {
    const commits = extractCommits([call(), result()]);
    expect(commits).toEqual([{ hash: "abc1234", message: "Actual receipt subject", blockIndex: 0, sourceIndex: 42 }]);
    expect(formatCommits(commits)).toEqual(["abc1234: Actual receipt subject (#42)"]);
  });

  test.each(["", "nothing to commit, working tree clean", "fatal: failed abc1234", "abc1234", "main abc1234..def5678", "[main abc1234]"])("attempt without a receipt is not a completed commit: %s", text => {
    expect(extractCommits([call(), result(text)])).toEqual([]);
  });

  test("failed call does not borrow a nearby successful result", () => {
    expect(extractCommits([call(), result("fatal: refused"), result(undefined, "unrelated")])).toEqual([]);
  });

  test("unique identity is required, including delayed parallel results", () => {
    const commits = extractCommits([
      call(undefined, "one"), call(undefined, "two"),
      result("[main def5678] Second", "two"), result("[main abc1234] First", "one"),
    ]);
    expect(commits.map(c => c.hash)).toEqual(["abc1234", "def5678"]);
    for (const blocks of [
      [call()], [call(), result(undefined, "other")],
      [call(undefined, ""), result(undefined, "")],
      [call(), call(), result()], [call(), result(), result()],
      [call(), result(undefined, "git", { name: "read" })], [result(), call()],
    ]) expect(extractCommits(blocks)).toEqual([]);
  });

  test.each([
    'git commit -m "Subject"',
    "git -C '/repo with spaces' commit --amend -m 'Subject'",
    "git add file.ts && git diff --cached --check && git commit -m 'Subject'",
    "(cd /repo && git commit --allow-empty --message 'Subject') && git status --short",
  ])("supports static Git command %s", command => {
    expect(extractCommits([call(command), result()])).toHaveLength(1);
  });

  test.each([
    "echo 'git commit -m fake'", "git commit -m $SUBJECT",
    "git commit -m 'Subject' | cat", "git commit -m 'Subject' > out",
    "git commit --dry-run -m 'Subject'", "git commit -m 'Subject' --help",
    "git commit -F body.txt", "git commit -m 'Subject'; quack commit body.txt",
    "echo '[main abc1234] Fake'; git commit -m 'Subject'",
  ])("unsupported syntax or mixed producer fails closed: %s", command => {
    expect(extractCommits([call(command), result()])).toEqual([]);
  });

  test.each(["[main (root-commit) abc1234] Root", "[detached HEAD abc1234] Detached", `[main ${"a".repeat(64)}] SHA256`])("accepts header %s", text => {
    expect(extractCommits([call(), result(text)])).toHaveLength(1);
  });

  test("earlier receipt survives a later failure, but excess receipts are ambiguous", () => {
    expect(extractCommits([call('git commit -m "Subject" && git status'), result(undefined, "git", { isError: true, execution: { exitCode: 1 } })])).toHaveLength(1);
    expect(extractCommits([call(), result("[main abc1234] One\n[main def5678] Two")])).toEqual([]);
  });

  test("dedup, bounded subjects and missing provenance", () => {
    const commits = extractCommits([call(), result(`[main abc1234] ${"x".repeat(300)}`, "git", { sourceIndex: undefined }), call(undefined, "two"), result(`[main abc1234] ${"x".repeat(300)}`, "two")]);
    expect(commits).toHaveLength(1);
    expect(commits[0].message.length).toBeLessThanOrEqual(200);
    expect(formatCommits(commits)[0]).not.toContain("(#");
  });

  test("compiler no longer promotes failed attempts into the Commits section", () => {
    const out = compileRanked({ messages: [
      { role: "assistant", content: [{ type: "toolCall", id: "git", name: "bash", arguments: { command: 'git commit -m "Failed attempt"' } }] },
      { role: "toolResult", toolCallId: "git", toolName: "bash", content: [{ type: "text", text: "nothing to commit" }], isError: true },
    ] as any });
    expect(out).not.toContain("[Commits]");
    expect(out).toContain("Failed attempt"); // raw attempt remains recall/transcript evidence
  });
});
