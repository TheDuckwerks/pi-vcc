import type { NormalizedBlock } from "../types";
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


/** Only observed, non-commit-producing scaffolding is admitted. */
const isScaffolding = (argv: string[], allowQuackLog: boolean): boolean => {
  if (argv[0] === "cd") return argv.length === 2 && !argv[1].startsWith("-");
  if (argv[0] === "rm") return argv.length > 1;
  if (allowQuackLog && argv[0] === "quack" && argv[1] === "log")
    return argv.length === 3 && !!argv[2] && !argv[2].startsWith("-");
  if (argv[0] !== "git") return false;
  const args = argv[1] === "-C" && argv[2] ? argv.slice(3) : argv.slice(1);
  if (args[0] === "add" || args[0] === "status") return true;
  return args.join(" ") === "diff --check" || args.join(" ") === "diff --cached --check";
};

export interface CommitReceipt extends CommitInfo {
  ruleIds: string[];
}

/** Unique identity, static commands and bounded Git headers, never nearby hashes. */
export const extractCommitReceipts = (
  blocks: NormalizedBlock[],
  match: (argv: string[]) => string | undefined,
  allowQuackLog = false,
): CommitReceipt[] => {
  const calls = new Map<string, number | null>();
  const results = new Map<string, number | null>();
  blocks.forEach((block, i) => {
    if (!((block.kind === "tool_call" || block.kind === "tool_result") && block.toolCallId)) return;
    const map = block.kind === "tool_call" ? calls : results;
    map.set(block.toolCallId, map.has(block.toolCallId) ? null : i);
  });
  const commits: CommitReceipt[] = [];
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
    const matched: string[] = [];
    for (const argv of commands) {
      const rule = match(argv);
      if (rule) matched.push(rule);
      else if (!isScaffolding(argv, allowQuackLog)) return;
    }
    if (!matched.length) return;
    // A header is evidence of a commit even if a later clause fails.
    const receipts = [...result.text.matchAll(/^\[[^\]\r\n]+ ([0-9a-f]{7,64})\] ([^\r\n]+)$/gm)];
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
        ruleIds: [...new Set(matched)],
      });
    }
  });
  return commits;
};
