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

/** Facts from successful receipts, even if a later clause made the batch fail. */
export const extractProfileCommits = (
  blocks: NormalizedBlock[],
  profile?: RecognitionProfile,
): ProfileCommitInfo[] => {
  if (!profile?.commitCommands.length) return [];
  return extractCommitReceipts(blocks, argv =>
    profile.commitCommands.find(rule => rule.tool === "bash" && matchesRule(argv, rule))?.id,
    true,
  ).map(commit => ({ ...commit, reason: "matched-command-and-git-receipt" }));
};
