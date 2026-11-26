import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Nest owns state. VCC requests only a read-only goal for this compaction.
export interface GoalReference { entryId: string; text: string }
export function requestNestGoal(pi: ExtensionAPI, entries: readonly unknown[]): GoalReference | null {
  let goal: GoalReference | null = null;
  try {
    pi.events?.emit("duckwerks:nest-goal", { entries, reply: (value: GoalReference | null) => {
      if (value && typeof value.entryId === "string" && typeof value.text === "string" && value.text.trim() && value.text.length <= 500 && !/[\x00-\x1f\x7f]/.test(value.text)) goal = value;
    } });
  } catch { return null; } // Optional consumer: Nest absence/failure cannot block compaction.
  return goal;
}
export function stripGoalSnapshot(summary: string): string {
  return summary.replace(/^\[(?:User-pinned Goal|Active work goal)\]\n- [^\n]*(?:\n\n|$)/, "");
}
export function withNestGoal(summary: string, goal: GoalReference | null): string {
  const rest = stripGoalSnapshot(summary);
  return goal ? `[Active work goal]\n- ${JSON.stringify(goal.text)}\n\n${rest}` : rest;
}
