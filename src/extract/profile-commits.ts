import type { NormalizedBlock } from "../types";
import type { CommitCommandRule, RecognitionProfile } from "../core/recognition-profile";
import { clip } from "../core/content";
import type { CommitInfo } from "./commits";

/**
 * Static words in a small shell subset. No expansion, pipelines, redirection,
 * heredocs, shell control flow or background execution. Unsupported syntax
 * rejects the whole batch rather than guessing which clauses executed.
 */
export const staticCommandList = (raw: string): string[][] | undefined => {
  if (raw.length > 65_536) return undefined;
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let started = false;
  let quote = "";
  let depth = 0;
  const flushWord = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  const flushCommand = () => {
    flushWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) { quote = ""; continue; }
      if (quote === '"' && (c === "$" || c === "`")) return undefined;
      if (quote === '"' && c === "\\") {
        const next = raw[++i];
        if (next == null) return undefined;
        if (next !== "\n") word += /[$`"\\]/.test(next) ? next : `\\${next}`;
      } else word += c;
      continue;
    }
    if (c === "'" || c === '"') { started = true; quote = c; continue; }
    if (c === "\\") {
      const next = raw[++i];
      if (next == null) return undefined;
      if (next !== "\n") { started = true; word += next; }
      continue;
    }
    if (c === "#" && !started) {
      while (i < raw.length && raw[i] !== "\n") i++;
      flushCommand();
      continue;
    }
    if (/[\s]/.test(c)) {
      if (c === "\n") flushCommand();
      else flushWord();
      continue;
    }
    if (c === "(" || c === ")") {
      flushCommand();
      depth += c === "(" ? 1 : -1;
      if (depth < 0) return undefined;
      continue;
    }
    if (c === ";") { flushCommand(); continue; }
    if (c === "&" || c === "|") {
      if (raw[i + 1] !== c) return undefined;
      i++;
      flushCommand();
      continue;
    }
    if (/[<>$`*?\[\]{}]/.test(c)) return undefined;
    started = true;
    word += c;
  }
  if (quote || depth) return undefined;
  flushCommand();
  return commands;
};

const matchesRule = (argv: string[], rule: CommitCommandRule): boolean =>
  argv.length === rule.argvPrefix.length + 1 &&
  rule.argvPrefix.every((token, i) => argv[i] === token) &&
  !!argv[argv.length - 1] && !argv[argv.length - 1].startsWith("-");

// The observed compound Quack shape includes staging, status, cd and cleanup.
// Restrict other clauses so a script/echo/unrecognized commit producer cannot
// lend its own Git-looking output to a failed recognized command in the batch.
const isScaffolding = (argv: string[]): boolean => {
  if (argv[0] === "cd") return argv.length === 2 && !argv[1].startsWith("-");
  if (argv[0] === "rm") return argv.length > 1;
  if (argv[0] !== "git") return false;
  const subcommand = argv[1] === "-C" && argv[2] ? argv[3] : argv[1];
  return subcommand === "add" || subcommand === "status";
};

export interface ProfileCommitInfo extends CommitInfo {
  ruleIds: string[];
  reason: "matched-command-and-git-receipt";
}

/** Facts from successful receipts, even if a later clause made the batch fail. */
export const extractProfileCommits = (
  blocks: NormalizedBlock[],
  profile?: RecognitionProfile,
): ProfileCommitInfo[] => {
  if (!profile?.commitCommands.length) return [];
  // A duplicate identity stays ambiguous; retain no growing list of matches.
  const calls = new Map<string, number | null>();
  const results = new Map<string, number | null>();
  blocks.forEach((block, i) => {
    if (!((block.kind === "tool_call" || block.kind === "tool_result") && block.toolCallId)) return;
    const map = block.kind === "tool_call" ? calls : results;
    map.set(block.toolCallId, map.has(block.toolCallId) ? null : i);
  });
  const commits: ProfileCommitInfo[] = [];
  const seen = new Set<string>();
  blocks.forEach((call, blockIndex) => {
    if (call.kind !== "tool_call" || call.name !== "bash" || !call.toolCallId ||
        calls.get(call.toolCallId) !== blockIndex || typeof call.args.command !== "string") return;
    const resultIndex = results.get(call.toolCallId);
    if (resultIndex == null || resultIndex <= blockIndex) return;
    const result = blocks[resultIndex];
    if (result.kind !== "tool_result" || result.name !== call.name) return;
    const commands = staticCommandList(call.args.command);
    if (!commands) return;
    const matched: CommitCommandRule[] = [];
    for (const argv of commands) {
      const rule = profile.commitCommands.find((r) => r.tool === call.name && matchesRule(argv, r));
      if (rule) matched.push(rule);
      else if (!isScaffolding(argv)) return;
    }
    if (!matched.length) return;
    // Covers normal, root-commit and detached-HEAD headers. No generic hash scan.
    const receipts = [...result.text.matchAll(/^\[[^\]\r\n]+ ([0-9a-f]{7,64})\] ([^\r\n]+)$/gm)];
    // Each supported invocation creates at most one commit. Extra headers make
    // receipt attribution ambiguous, so do not silently accept them.
    if (!receipts.length || receipts.length > matched.length) return;
    for (const receipt of receipts) {
      const hash = receipt[1];
      const message = clip(receipt[2].trim(), 200);
      if (!message) continue;
      const key = `${hash}::${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      commits.push({
        hash, message, blockIndex, sourceIndex: result.sourceIndex,
        ruleIds: [...new Set(matched.map((rule) => rule.id))],
        reason: "matched-command-and-git-receipt",
      });
    }
  });
  return commits;
};
