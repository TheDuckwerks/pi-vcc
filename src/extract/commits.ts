import type { NormalizedBlock } from "../types";
import { extractCommitReceipts } from "./commit-receipts";

export interface CommitInfo {
  hash?: string;
  message: string;
  /** Original block position for chronological additive composition. */
  blockIndex?: number;
  /** Matched result provenance; omitted when no global index is available. */
  sourceIndex?: number;
}

/** Narrow static -m grammar. Unsupported flags and producers fail closed. */
const isGitCommit = (argv: string[]): boolean => {
  if (argv[0] !== "git") return false;
  const args = argv[1] === "-C" && argv[2] ? argv.slice(3) : argv.slice(1);
  if (args[0] !== "commit") return false;
  let hasMessage = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "-m" || args[i] === "--message") {
      if (!args[++i]) return false;
      hasMessage = true;
    } else if (!["--amend", "--allow-empty", "--no-verify", "--signoff", "-a"].includes(args[i])) {
      return false;
    }
  }
  return hasMessage;
};

/** Commit subjects and hashes come only from uniquely paired Git receipts. */
export const extractCommits = (blocks: NormalizedBlock[]): CommitInfo[] =>
  extractCommitReceipts(blocks, argv => isGitCommit(argv) ? "git.commit" : undefined)
    .map(({ ruleIds, ...commit }) => commit);

export const formatCommits = (commits: CommitInfo[], limit = 8): string[] => {
  const lines: string[] = [];
  const items = commits.slice(-limit);
  for (const c of items) {
    const prefix = c.hash ? `${c.hash}: ` : "";
    const ref = c.sourceIndex != null ? ` (#${c.sourceIndex})` : "";
    lines.push(`${prefix}${c.message}${ref}`);
  }
  return lines;
};
