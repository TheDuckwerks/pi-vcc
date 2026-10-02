import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  GOAL_ENTRY_TYPE, GOAL_MESSAGE_TYPE, GOAL_HEADER,
  normalizeGoal, readPinnedGoal, stripPinnedGoal,
} from "../core/pinned-goal";

export function registerGoal(pi: ExtensionAPI): void {
  pi.registerCommand("goal", {
    description: "Set a session reference goal; no args shows it, clear removes it",
    handler: async (args, ctx) => {
      const value = args.trim();
      const current = readPinnedGoal(ctx.sessionManager.getBranch());
      if (!value) {
        ctx.ui.notify(current ? `Goal: ${current.text}` : "No pinned goal.", "info");
        return;
      }
      if (value === "clear") {
        if (current) pi.appendEntry(GOAL_ENTRY_TYPE, {
          version: 1, text: null, clearedGoalId: current.entryId, reason: "User cleared the pin",
        });
        ctx.ui.notify(current ? "Goal cleared." : "No pinned goal.", "info");
        return;
      }
      try {
        const text = normalizeGoal(value.startsWith("set ") ? value.slice(4) : value);
        pi.appendEntry(GOAL_ENTRY_TYPE, { version: 1, text });
        ctx.ui.notify(`Goal: ${text}`, "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message, "warning");
      }
    },
  });

  pi.registerTool({
    name: "vcc_goal",
    label: "VCC Goal",
    description: "Read the user-pinned session reference goal, or clear an accomplished pin. " +
      "Clear requires its entryId from get and a reason; refuses a replaced pin. Does not set goals or authorize work.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("get"), Type.Literal("clear")]),
      expectedId: Type.Optional(Type.String({ description: "Current pin entryId, required for clear" })),
      reason: Type.Optional(Type.String({ description: "Why the agreed goal is accomplished, required for clear" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const current = readPinnedGoal(ctx.sessionManager.getBranch());
      if (params.action === "clear") {
        if (!current || !params.expectedId || params.expectedId !== current.entryId) {
          throw new Error("Goal changed or is absent; read it again before clearing.");
        }
        const reason = normalizeGoal(params.reason ?? "");
        pi.appendEntry(GOAL_ENTRY_TYPE, {
          version: 1, text: null, clearedGoalId: current.entryId, reason,
        });
        const details = { goal: null, cleared: current, reason };
        return { content: [{ type: "text", text: JSON.stringify(details) }], details };
      }
      const details = { goal: current };
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  });

  // Request-local reference, not persisted messages or a changing system prompt.
  // Read the branch on every request, including wakes/retries/tree navigation.
  pi.on("context", (event, ctx) => {
    const current = readPinnedGoal(ctx.sessionManager.getBranch());
    let changed = false;
    const messages = event.messages.filter(message => {
      const keep = message.role !== "custom" || message.customType !== GOAL_MESSAGE_TYPE;
      if (!keep) changed = true;
      return keep;
    }).map(message => {
      if (message.role !== "compactionSummary") return message;
      const summary = stripPinnedGoal(message.summary);
      if (summary === message.summary) return message;
      changed = true;
      return { ...message, summary };
    });
    if (current) {
      messages.unshift({
        role: "custom", customType: GOAL_MESSAGE_TYPE,
        content: `${GOAL_HEADER} (reference only; current user instructions take precedence)\n${JSON.stringify(current.text)}`,
        display: false, timestamp: 0,
      });
      changed = true;
    }
    return changed ? { messages } : undefined;
  });
}
