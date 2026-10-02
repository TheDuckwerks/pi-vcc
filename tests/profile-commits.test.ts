import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { NormalizedBlock } from "../src/types";
import { normalize } from "../src/core/normalize";
import { parseRecognitionProfile } from "../src/core/recognition-profile";
import { extractProfileCommits, staticCommandList } from "../src/extract/profile-commits";
import { extractCommits } from "../src/extract/commits";
import { compileRanked } from "../src/core/summarize";
import fixture from "./fixtures/quack-batch.json";
import landFixture from "./fixtures/quack-land-batch.json";
import profileJson from "../examples/duckwerks-recognition.json";

const profile = parseRecognitionProfile(profileJson);
const call = (command: string, id = "q1"): NormalizedBlock => ({
  kind: "tool_call", name: "bash", args: { command }, toolCallId: id, sourceIndex: 123,
});
const result = (text = "[main abc1234] Commit subject", id = "q1", extra = {}): NormalizedBlock => ({
  kind: "tool_result", name: "bash", text, toolCallId: id, sourceIndex: 124, ...extra,
});
const extract = (command: string, text?: string) => extractProfileCommits([call(command), result(text)], profile);
const replayInput = { messages: fixture.messages as any, sourceIndices: fixture.sourceIndices };

// The expected before text was generated from upstream commit 303e89db, not
// from this fork's disabled-profile path. It tests an identical frozen pair.
describe("Quack before/after replay", () => {
  test("upstream misses both receipts; absent or empty profile preserves that output", () => {
    const before = readFileSync(join(import.meta.dir, "fixtures/quack-before.txt"), "utf8").trimEnd();
    expect(extractCommits(normalize(replayInput.messages, replayInput.sourceIndices))).toEqual([]);
    expect(compileRanked(replayInput)).toBe(before);
    expect(compileRanked({ ...replayInput, recognitionProfile: { version: 1, commitCommands: [] } })).toBe(before);
  });

  test("sidecar adds exactly both actual receipt facts without changing the brief", () => {
    const blocks = normalize(replayInput.messages, replayInput.sourceIndices);
    const commits = extractProfileCommits(blocks, profile);
    expect(commits.map(({ hash, message, sourceIndex }) => ({ hash, message, sourceIndex }))).toEqual([
      { hash: "b17ba20", message: "Add on-demand subagent recipes and audit schema ref #134", sourceIndex: 124 },
      { hash: "42e3557", message: "Specify the subagent recipe pilot ref #134", sourceIndex: 124 },
    ]);
    expect(commits.every(c => c.ruleIds[0] === "duckwerks.quack-commit" && c.reason === "matched-command-and-git-receipt")).toBe(true);
    const after = compileRanked({ ...replayInput, recognitionProfile: profile });
    expect(after).toBe(readFileSync(join(import.meta.dir, "fixtures/quack-after.txt"), "utf8").trimEnd());
    expect(after).toStartWith("[Commits]\n- b17ba20: Add on-demand subagent recipes and audit schema ref #134 (#124)\n- 42e3557: Specify the subagent recipe pilot ref #134 (#124)");
    expect(after.slice(after.indexOf("\n\n---\n\n") + 7)).toBe(compileRanked(replayInput));
    expect(compileRanked({ ...replayInput, recognitionProfile: profile })).toBe(after);
  });
});

describe("observed Land envelope", () => {
  test("adds both receipt facts, leaving disabled-profile output and the brief unchanged", () => {
    const messages: any[] = [
      { role: "assistant", content: [{ type: "toolCall", id: "land", name: "bash", arguments: { command: landFixture.command } }] },
      { role: "toolResult", toolCallId: "land", toolName: "bash", content: [{ type: "text", text: landFixture.output }], isError: false },
    ];
    const input = { messages, sourceIndices: [90, 91] };
    const before = compileRanked(input);
    expect(before).not.toContain("[Commits]");
    expect(compileRanked({ ...input, recognitionProfile: { version: 1, commitCommands: [] } })).toBe(before);
    const after = compileRanked({ ...input, recognitionProfile: profile });
    expect(after).toStartWith("[Commits]\n- 8caea7f:");
    expect(after).toContain("804422d:");
    expect(after.match(/\(#91\)/g)).toHaveLength(2);
    expect(after.slice(after.indexOf("\n\n---\n\n") + 7)).toBe(before);
  });

  test.each([
    "quack log body.txt && git diff --cached --check && quack commit body.txt",
    "git diff --check && quack commit body.txt",
    "git -C /repo diff --cached --check && quack commit body.txt",
  ])("supports earned scaffolding %s", command => {
    expect(extract(command)).toHaveLength(1);
    expect(extract(command, "fatal: failed")).toEqual([]);
  });

  test.each([
    "quack log --help && quack commit body.txt",
    "quack log one.txt two.txt && quack commit body.txt",
    "git diff && quack commit body.txt",
    "git diff --cached --check --output=out && quack commit body.txt",
    "quack log $BODY && quack commit body.txt",
    "quack log body.txt && git commit -m 'Other' && quack commit body.txt",
  ])("unsupported Land variants fail closed %s", command => {
    expect(extract(command)).toEqual([]);
  });
});

describe("conservative command matching", () => {
  test.each([
    "quack commit body.txt",
    "cd /repo && quack commit 'body with spaces.txt'",
    "(cd /repo && quack commit body.txt) && git status --short",
    "git -C /repo add file.ts; quack commit body.txt; rm body.txt",
    "# comment\nquack commit body.txt",
    '"quack" "commit" "body.txt"',
    "quack commit bo\\ dy.txt",
  ])("recognizes supported command %s", command => {
    expect(extract(command)).toHaveLength(1);
  });

  test.each([
    "echo 'quack commit body.txt'",
    "printf '%s' 'quack commit body.txt'",
    "quack commit --help",
    "quack commit --dry-run body.txt",
    "quack commit",
    "quack commit a.txt b.txt",
    "cat <<'EOF'\nquack commit body.txt\nEOF",
    "python3 - <<'PY'\nquack commit body.txt\nPY",
    "quack commit $BODY_FILE",
    "quack commit $(echo body.txt)",
    'quack commit "$BODY_FILE"',
    "quack commit `echo body.txt`",
    "quack commit body.txt | cat",
    "quack commit body.txt &",
    "quack commit body.txt > out.txt",
    "if true; then quack commit body.txt; fi",
    "bash -lc 'quack commit body.txt'",
    "git commit -m 'other commit'; quack commit body.txt",
    "echo '[main abc1234] Fake receipt'; quack commit body.txt",
    "quack commit 'unclosed",
    "(quack commit body.txt",
    "quack commit body.txt)",
  ])("fails closed for unsupported/mention shape %s", command => {
    expect(extract(command)).toEqual([]);
  });

  test("literal dollar in single quotes is a path, not expansion", () => {
    expect(staticCommandList("quack commit '$literal.txt'")).toEqual([["quack", "commit", "$literal.txt"]]);
  });

  test("limits input size", () => {
    expect(staticCommandList("x".repeat(65_537))).toBeUndefined();
  });
});

describe("receipt evidence and identity", () => {
  test.each(["", "quack: no such file", "nothing to commit, working tree clean", "hash abc1234", "main abc1234..def5678", "[main abc1234]"])("no commit without a success header: %s", text => {
    expect(extract("quack commit body.txt", text)).toEqual([]);
  });

  test.each(["[main (root-commit) abc1234] First commit", "[detached HEAD abc1234] Detached commit", `[main ${"a".repeat(64)}] SHA256 commit`])("accepts Git header %s", text => {
    expect(extract("quack commit body.txt", text)).toHaveLength(1);
  });

  test("an earlier successful commit survives a later failure", () => {
    const commits = extractProfileCommits([
      call("quack commit body.txt && git status --short"),
      result("[main abc1234] Commit subject\nfatal: status failed\nCommand exited with code 1", "q1", { isError: true, execution: { exitCode: 1 } }),
    ], profile);
    expect(commits.map(c => c.hash)).toEqual(["abc1234"]);
  });

  test("parallel results attach by ID, not nearest position", () => {
    const commits = extractProfileCommits([
      call("quack commit one.txt", "one"),
      call("quack commit two.txt", "two"),
      result("[main def5678] Second", "two", { sourceIndex: 20 }),
      result("[main abc1234] First", "one", { sourceIndex: 21 }),
    ], profile);
    expect(commits.map(c => [c.hash, c.sourceIndex])).toEqual([["abc1234", 21], ["def5678", 20]]);
  });

  test("missing, mismatched and ambiguous IDs fail closed", () => {
    for (const blocks of [
      [call("quack commit body.txt")],
      [call("quack commit body.txt"), result(undefined, "other")],
      [call("quack commit body.txt", ""), result(undefined, "")],
      [call("quack commit body.txt"), call("quack commit body.txt"), result()],
      [call("quack commit body.txt"), result(), result()],
      [call("quack commit body.txt"), result(undefined, "q1", { name: "read" })],
      [result(), call("quack commit body.txt")],
    ]) expect(extractProfileCommits(blocks, profile)).toEqual([]);
  });

  test("does not borrow an unrelated nearby hash", () => {
    expect(extractProfileCommits([
      call("quack commit body.txt"), result("quack: refused"), result(undefined, "unrelated"),
    ], profile)).toEqual([]);
  });

  test("more receipts than recognized invocations is ambiguous", () => {
    expect(extract("quack commit body.txt", "[main abc1234] One\n[main def5678] Two")).toEqual([]);
  });

  test("missing global index omits the ref rather than inventing one", () => {
    const out = compileRanked({ ...replayInput, sourceIndices: [undefined, undefined], recognitionProfile: profile });
    expect(out).toContain("b17ba20: Add on-demand");
    expect(out).not.toContain("(#");
  });
});

describe("composition and bounded merge", () => {
  test("ordinary git extraction renders unchanged with the sidecar", () => {
    const input = { messages: [
      { role: "assistant", content: [{ type: "toolCall", id: "git", name: "bash", arguments: { command: 'git commit -m "Ordinary"' } }] },
      { role: "toolResult", toolCallId: "git", toolName: "bash", content: [{ type: "text", text: "[main abc1234] Ordinary" }], isError: false },
    ] as any };
    expect(compileRanked({ ...input, recognitionProfile: profile })).toBe(compileRanked(input));
  });

  test("mixed built-in and profile facts remain chronological under the cap", () => {
    const messages: any[] = [];
    for (let i = 0; i < 10; i++) {
      const hash = `abc123${i}`;
      messages.push(
        { role: "assistant", content: [{ type: "toolCall", id: `c${i}`, name: "bash", arguments: { command: i % 2 ? `git commit -m "Subject ${i}"` : `quack commit body${i}.txt` } }] },
        { role: "toolResult", toolCallId: `c${i}`, toolName: "bash", content: [{ type: "text", text: `[main ${hash}] Subject ${i}` }], isError: false },
      );
    }
    const out = compileRanked({ messages, recognitionProfile: profile });
    const header = out.split("\n\n---\n\n")[0];
    expect(header.match(/^- abc123/gm)).toHaveLength(8);
    expect(header).not.toContain("abc1230:");
    expect(header).not.toContain("abc1231:");
    expect(header.indexOf("abc1232:")).toBeLessThan(header.indexOf("abc1233:"));
    expect(header.indexOf("abc1238:")).toBeLessThan(header.indexOf("abc1239:"));
  });

  test("repeated compaction deduplicates the same fact despite a changed provenance ref", () => {
    const first = compileRanked({ ...replayInput, recognitionProfile: profile });
    const next = compileRanked({ ...replayInput, sourceIndices: [223, 224], recognitionProfile: profile, previousSummary: first });
    const header = next.split("\n\n---\n\n")[0];
    expect(header.match(/^- b17ba20:/gm)).toHaveLength(1);
    expect(header.match(/^- 42e3557:/gm)).toHaveLength(1);
    expect(header).toContain("(#124)");
  });

  test("user source ref survives noise cleaning into the final summary", () => {
    const out = compileRanked({ messages: [{ role: "user", content: "<system-reminder>noise</system-reminder>\nFix the login", timestamp: 0 }], sourceIndices: [42] });
    expect(out).toContain("Fix the login (#42)");
  });
});
