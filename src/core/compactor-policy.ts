import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSettings, type Compactor, type PiVccSettings } from "./settings";

export const COMPACTOR_STATE = "pi-vcc:compactor";

const mapValue = (map: Record<string, Compactor>, key: string): Compactor | undefined =>
  Object.entries(map).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())?.[1];

export const sessionCompactor = (ctx: any): Compactor | undefined => {
  const branch = ctx?.sessionManager?.getBranch?.() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "custom" || entry.customType !== COMPACTOR_STATE) continue;
    const value = entry.data?.compactor;
    return value === "pi" || value === "vcc" ? value : undefined;
  }
  return undefined;
};

export const resolveCompactor = (
  settings: PiVccSettings,
  ctx: any,
  oneShotVcc = false,
): { compactor: Compactor; source: string } => {
  if (oneShotVcc) return { compactor: "vcc", source: "/pi-vcc" };
  const session = sessionCompactor(ctx);
  if (session) return { compactor: session, source: "session" };
  const model = ctx?.model;
  const modelKey = model && typeof model.provider === "string" && typeof model.id === "string"
    ? `${model.provider}/${model.id}` : "";
  const byModel = modelKey && mapValue(settings.compactorsByModel, modelKey);
  if (byModel) return { compactor: byModel, source: `model ${modelKey}` };
  const provider = typeof model?.provider === "string" ? model.provider : "";
  const byProvider = provider && mapValue(settings.compactorsByProvider, provider);
  if (byProvider) return { compactor: byProvider, source: `provider ${provider}` };
  if (provider && settings.skipForProviders.some((p) => p.toLowerCase() === provider.toLowerCase())) {
    return { compactor: "pi", source: `legacy provider exclusion ${provider}` };
  }
  return { compactor: settings.defaultCompactor, source: "default" };
};

export const registerCompactorCommand = (pi: ExtensionAPI): void => {
  pi.registerCommand("compactor", {
    description: "Select the session compactor: pi, vcc, auto, or status",
    handler: async (args: string, ctx: any) => {
      const choice = args.trim().toLowerCase();
      if (choice === "pi" || choice === "vcc") {
        pi.appendEntry(COMPACTOR_STATE, { compactor: choice });
      } else if (choice === "auto") {
        pi.appendEntry(COMPACTOR_STATE, { compactor: "auto" });
      } else if (choice && choice !== "status") {
        ctx.ui.notify("Usage: /compactor [pi|vcc|auto|status]", "warning");
        return;
      }
      const settings = loadSettings();
      const resolved = resolveCompactor(settings, ctx);
      ctx.ui.notify(`Compactor: ${resolved.compactor} (${resolved.source})`, "info");
    },
  });
};
