import type { NormalizedBlock } from "../types";
import type { CommitCommandRule, RecognitionProfile } from "../core/recognition-profile";
import type { CommitInfo } from "./commits";
import { extractCommitReceipts } from "./commit-receipts";

export { staticCommandList } from "./commit-receipts";

const matchesRule = (argv: string[], rule: CommitCommandRule): boolean =>
  argv.length === rule.argvPrefix.length + 1 &&
  rule.argvPrefix.every((token, i) => argv[i] === token) &&
  !!argv[argv.length - 1] && !argv[argv.length - 1].startsWith("-");

export interface ProfileCommitInfo extends CommitInfo {
  ruleIds: string[];
  reason: "matched-command-and-git-receipt";
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Anything else in a batch that can print a Git commit header. With one of these
// present, a header cannot be attributed to the profile command, so the batch is rejected.
const OTHER_COMMIT_PRODUCER_RE =
  /\bgit\b(?:\s+-C\s+\S+)?\s+(?:commit|merge|rebase|cherry-pick|am|revert|pull|stash\s+(?:pop|apply))\b/;

/**
 * Agents run profile commands inside batches the static parser rejects: a body file
 * written with printf/heredoc, `2>&1 | tail -1`, a trailing `gh issue close`. Count
 * the profile commands at command boundaries instead; accept only when nothing
 * else in the batch can produce a commit, so every Git header comes from them.
 */
const looseMatches = (rules: CommitCommandRule[]) => (command: string): string[] | undefined => {
  if (OTHER_COMMIT_PRODUCER_RE.test(command)) return undefined;
  const matched: string[] = [];
  for (const rule of rules) {
    const re = new RegExp(`(?:^|[\\n;&|(])\\s*${rule.argvPrefix.map(escapeRe).join("\\s+")}\\s+(?!-)\\S`, "g");
    for (const _ of command.matchAll(re)) matched.push(rule.id);
  }
  return matched.length ? matched : undefined;
};

/** Facts from successful receipts, even if a later clause made the batch fail. */
export const extractProfileCommits = (
  blocks: NormalizedBlock[],
  profile?: RecognitionProfile,
): ProfileCommitInfo[] => {
  if (!profile?.commitCommands.length) return [];
  const rules = profile.commitCommands.filter(rule => rule.tool === "bash");
  return extractCommitReceipts(blocks, argv =>
    rules.find(rule => matchesRule(argv, rule))?.id,
    true,
    looseMatches(rules),
  ).map(commit => ({ ...commit, reason: "matched-command-and-git-receipt" }));
};
