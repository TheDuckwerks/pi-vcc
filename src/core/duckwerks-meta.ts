import type { NormalizedBlock } from "../types";

// Duckwerks: metadata kept beside upstream's objects instead of on them, so
// upstream's block and commit shapes (and its exact-equality tests) are unchanged.

const toolCallIds = new WeakMap<NormalizedBlock, string>();
const commitPositions = new WeakMap<object, number>();

export const setToolCallId = (block: NormalizedBlock, id: unknown): NormalizedBlock => {
  if (typeof id === "string" && id) toolCallIds.set(block, id);
  return block;
};

/** The provider's tool call id for a call or result block, if normalize saw one. */
export const toolCallIdOf = (block: NormalizedBlock): string | undefined =>
  toolCallIds.get(block) ?? ((block as { toolCallId?: unknown }).toolCallId as string | undefined);

export const setCommitPosition = <T extends object>(commit: T, blockIndex: number): T => {
  commitPositions.set(commit, blockIndex);
  return commit;
};

/** Block index a built-in commit came from, for ordering beside receipt-backed ones. */
export const commitPositionOf = (commit: { blockIndex?: number }): number =>
  commit.blockIndex ?? commitPositions.get(commit) ?? 0;
