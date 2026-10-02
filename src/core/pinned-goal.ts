// One branch-local custom entry is the authority. Summaries are renderings only.
export const GOAL_ENTRY_TYPE = "pi-vcc-goal";
export const GOAL_MESSAGE_TYPE = "pi-vcc-goal-reference";
export const GOAL_HEADER = "[User-pinned Goal]";
export const MAX_GOAL_CHARS = 500;

export interface PinnedGoal { entryId: string; text: string }
type Entry = { type: string; id?: string; customType?: string; data?: unknown };

export function normalizeGoal(text: string): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value || value.length > MAX_GOAL_CHARS || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Goal must be 1–${MAX_GOAL_CHARS} characters without control characters.`);
  }
  return value;
}

export function readPinnedGoal(entries: readonly Entry[]): PinnedGoal | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) continue;
    const data = entry.data as { version?: unknown; text?: unknown } | null;
    // Unknown/malformed latest state must not resurrect an older pin.
    if (!data || data.version !== 1 || typeof data.text !== "string" || !entry.id) return null;
    try {
      const text = normalizeGoal(data.text);
      if (text !== data.text) return null;
      return { entryId: entry.id, text };
    } catch { return null; }
  }
  return null;
}

// Only remove our exact leading section, never matching prose elsewhere.
export function stripPinnedGoal(summary: string): string {
  return summary.replace(/^\[User-pinned Goal\]\n- [^\n]*(?:\n\n|$)/, "");
}

export function withPinnedGoal(summary: string, goal: PinnedGoal | null): string {
  const rest = stripPinnedGoal(summary);
  if (!goal) return rest;
  return `${GOAL_HEADER}\n- ${JSON.stringify(goal.text)}\n\n${rest}`;
}
