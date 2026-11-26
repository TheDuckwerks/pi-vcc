import { describe, it, expect } from "bun:test";
import { extractCommits } from "../src/extract/commits";
import type { NormalizedBlock } from "../src/types";

const commitBlocks = (command: string): NormalizedBlock[] => [
  { kind: "tool_call", name: "bash", args: { command } },
  { kind: "tool_result", name: "bash", text: "[master 5416801] commit" },
];

describe("extractCommits", () => {
  it("extracts double-quoted -m subject", () => {
    const blocks = commitBlocks('git commit -m "fix: handle empty config"');
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "fix: handle empty config" }]);
  });

  it("extracts single-quoted -m subject", () => {
    const blocks = commitBlocks("git commit -m 'fix: handle empty config'");
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "fix: handle empty config" }]);
  });

  it("extracts first line of $'...' -m subject", () => {
    const blocks = commitBlocks("git commit -m $'fix: handle empty config\\n\\nbody'");
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "fix: handle empty config" }]);
  });

  it("skips git commit without -m", () => {
    expect(extractCommits(commitBlocks("git commit --allow-empty"))).toEqual([]);
  });

  it("extracts heredoc subject with single-quoted delimiter", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<'EOF'\nfeat: add retry to upload client\n\nbody\nEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("extracts heredoc subject with double-quoted delimiter", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<"EOF"\nfeat: add retry to upload client\nEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("extracts heredoc subject with unquoted non-EOF delimiter", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<MSG\nfeat: add retry to upload client\nMSG\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("extracts heredoc subject with <<- and tab-indented lines", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<-EOF\n\tfeat: add retry to upload client\n\tEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("allows a space between << and the delimiter", () => {
    const blocks = commitBlocks(`git commit -m "$(cat << 'EOF'\nfeat: add retry to upload client\nEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("skips leading blank lines in heredoc body", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<'EOF'\n\n\nfeat: add retry to upload client\nEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("skips heredoc with empty body", () => {
    expect(extractCommits(commitBlocks(`git commit -m "$(cat <<'EOF'\n\nEOF\n)"`))).toEqual([]);
  });

  it("skips heredoc with empty body and double-quoted delimiter", () => {
    expect(extractCommits(commitBlocks(`git commit -m "$(cat <<"EOF"\n\nEOF\n)"`))).toEqual([]);
  });

  it("treats delimiter with trailing spaces as end of body", () => {
    expect(extractCommits(commitBlocks(`git commit -m "$(cat <<'EOF'\n\nEOF   \n)"`))).toEqual([]);
  });

  it("unescapes \\\" in heredoc subject", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<'EOF'\\nfix: handle \\"quoted\\" args\\nEOF\\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: 'fix: handle "quoted" args' }]);
  });

  it("keeps plain quotes in heredoc subject", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<'EOF'\nfix: handle "quoted" args\nEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: 'fix: handle "quoted" args' }]);
  });

  it("extracts heredoc subject from escaped newlines", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<'EOF'\\nfeat: add retry to upload client\\n\\nEOF\\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("skips empty heredoc with escaped newlines", () => {
    expect(extractCommits(commitBlocks(`git commit -m "$(cat <<'EOF'\\n\\nEOF\\n)"`))).toEqual([]);
  });

  it("uses the first -m when heredoc is only in a later -m", () => {
    const blocks = commitBlocks(`git commit -m "fix: handle empty config" -m "$(cat <<'EOF'\nbody\nEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "fix: handle empty config" }]);
  });

  it("extracts every commit in an && chain and hashes only the one the output names", () => {
    const blocks: NormalizedBlock[] = [
      {
        kind: "tool_call",
        name: "bash",
        args: {
          command: `git add a && git commit -m "docs: explain git commit -m" && git add b && git commit -m "$(cat <<'EOF'\nfeat: add retry to upload client\nEOF\n)"`,
        },
      },
      { kind: "tool_result", name: "bash", text: "[master 5416801] docs: explain git commit -m\n 1 file changed\n[master 77aa001] unrelated" },
    ];
    expect(extractCommits(blocks)).toEqual([
      { hash: "5416801", message: "docs: explain git commit -m" },
      { hash: undefined, message: "feat: add retry to upload client" },
    ]);
  });

  it("hashes quiet commits in a chain from `git log --oneline` lines naming them", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "tool_call", name: "bash", args: { command: 'git commit -q -m "fix: one" && git commit -q -m "fix: two" && git log --oneline -2' } },
      { kind: "tool_result", name: "bash", text: "bbb2222 (HEAD -> master) fix: two\naaa1111 fix: one" },
    ];
    expect(extractCommits(blocks)).toEqual([
      { hash: "aaa1111", message: "fix: one" },
      { hash: "bbb2222", message: "fix: two" },
    ]);
  });

  it("does not take a later commit's heredoc subject for an unparsable first commit", () => {
    const blocks = commitBlocks(
      `git commit --author="A <a@b>" -m "$(cat <<'EOF'\nfeat: one\nEOF\n)" && git commit -m "$(cat <<'EOF'\nfeat: two\nEOF\n)"`,
    );
    expect(extractCommits(blocks)).toEqual([{ hash: undefined, message: "feat: two" }]);
  });

  it("extracts heredoc subject with --amend", () => {
    const blocks = commitBlocks(`git commit --amend -m "$(cat <<'EOF'\nfeat: add retry to upload client\nEOF\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("extracts heredoc subject with CRLF line endings", () => {
    const blocks = commitBlocks(`git commit -m "$(cat <<'EOF'\r\nfeat: add retry to upload client\r\n\r\nEOF\r\n)"`);
    expect(extractCommits(blocks)).toEqual([{ hash: "5416801", message: "feat: add retry to upload client" }]);
  });

  it("skips empty heredoc with CRLF line endings", () => {
    expect(extractCommits(commitBlocks(`git commit -m "$(cat <<'EOF'\r\n\r\nEOF\r\n)"`))).toEqual([]);
  });

  // `-q` makes git print no hash, so these commits are hashless.
  const quietBlocks = (command: string): NormalizedBlock[] => [
    { kind: "tool_call", name: "bash", args: { command } },
    { kind: "tool_result", name: "bash", text: "" },
  ];

  it("extracts the subject from combined short flags ending in m", () => {
    expect(extractCommits(quietBlocks('git commit -qam "chore: release v0.11.0"'))).toEqual([
      { hash: undefined, message: "chore: release v0.11.0" },
    ]);
  });

  it("extracts the heredoc subject after combined short flags", () => {
    const cmd = `git commit -qam "$(cat <<'EOF'\nfeat: add retry to upload client\nEOF\n)"`;
    expect(extractCommits(quietBlocks(cmd))).toEqual([{ hash: undefined, message: "feat: add retry to upload client" }]);
  });

  it("extracts the subject of a message piped to `-F -` through a heredoc", () => {
    const cmd = `git commit -q -F - <<'EOF'\nfeat: add retry to upload client\n\nbody\nEOF`;
    expect(extractCommits(quietBlocks(cmd))).toEqual([{ hash: undefined, message: "feat: add retry to upload client" }]);
  });

  it("keeps one entry per commit, preferring the hashed one in either order", () => {
    const hashless = quietBlocks('git commit -q -m "fix: handle empty config"');
    const hashed = commitBlocks('git commit -m "fix: handle empty config"');
    const want = [{ hash: "5416801", message: "fix: handle empty config" }];
    expect(extractCommits([...hashless, ...hashed])).toEqual(want);
    expect(extractCommits([...hashed, ...hashless])).toEqual(want);
    // Two commits that share a message but have different hashes stay two.
    const other = [
      { kind: "tool_call", name: "bash", args: { command: 'git commit -m "fix: handle empty config"' } },
      { kind: "tool_result", name: "bash", text: "[master 9999999] commit" },
    ] as NormalizedBlock[];
    expect(extractCommits([...hashed, ...other]).map((x) => x.hash)).toEqual(["5416801", "9999999"]);
  });

  describe("git commit written inside a heredoc body", () => {
    const quiet = (command: string): NormalizedBlock[] => [
      { kind: "tool_call", name: "bash", args: { command } },
      { kind: "tool_result", name: "bash", text: "" },
    ];

    it("skips a mention in a script fed to an interpreter", () => {
      const cmd = "python3 - <<'EOF'\nfixtures = [\n  \"make && git commit -m 'Example subject'\",\n]\nEOF";
      expect(extractCommits(quiet(cmd))).toEqual([]);
    });

    it("skips a mention in a file being written", () => {
      expect(extractCommits(quiet('cat > notes.md <<EOF\nthen run: git commit -m "Docs"\nEOF'))).toEqual([]);
    });

    it("keeps a real commit after the heredoc closes", () => {
      const cmd = "cat > notes.md <<'EOF'\ngit commit -m \"Not this\"\nEOF\ngit add notes.md && git commit -m \"Add notes\"";
      expect(extractCommits(commitBlocks(cmd))).toEqual([{ hash: "5416801", message: "Add notes" }]);
    });

    it("keeps a commit in a body that a shell runs", () => {
      expect(extractCommits(commitBlocks("bash <<'EOF'\ncd repo && git commit -m \"From a script\"\nEOF"))).toEqual([{ hash: "5416801", message: "From a script" }]);
      expect(extractCommits(commitBlocks("ssh box <<EOF\ngit commit -m \"Remote\"\nEOF"))).toEqual([{ hash: "5416801", message: "Remote" }]);
    });

    it("still reads a commit message from its own heredoc", () => {
      expect(extractCommits(commitBlocks("git commit -F - <<'EOF'\nSubject here\n\ngit commit -m \"inside body\"\nEOF"))).toEqual([{ hash: "5416801", message: "Subject here" }]);
    });

    it("handles escaped newlines the way the other heredoc parsers do", () => {
      expect(extractCommits(quiet("cat > f.txt <<'EOF'\\ngit commit -m \"No\"\\nEOF"))).toEqual([]);
    });
  });
});
