import type { PiVccSettings } from "./settings";

// Duckwerks addition. Upstream decides with one switch (overrideDefaultCompaction)
// plus an opt-out list (skipForProviders). These maps choose per model or provider
// in either direction, e.g. VCC for local models while Pi summarizes the rest.

export type Compactor = "pi" | "vcc";

const lookup = (map: Record<string, Compactor>, key: string): Compactor | undefined =>
  Object.entries(map).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())?.[1];

/** Whether pi-vcc handles this compaction, and why. Explicit /pi-vcc always wins. */
export const selectCompactor = (
  settings: PiVccSettings,
  model: { provider?: unknown; id?: unknown } | undefined,
  isPiVcc: boolean,
): { compactor: Compactor; source: string } => {
  if (isPiVcc) return { compactor: "vcc", source: "/pi-vcc" };
  const provider = typeof model?.provider === "string" ? model.provider : "";
  const id = typeof model?.id === "string" ? model.id : "";
  const byModel = provider && id ? lookup(settings.compactorsByModel, `${provider}/${id}`) : undefined;
  if (byModel) return { compactor: byModel, source: `model ${provider}/${id}` };
  const byProvider = provider ? lookup(settings.compactorsByProvider, provider) : undefined;
  if (byProvider) return { compactor: byProvider, source: `provider ${provider}` };
  if (provider && settings.skipForProviders.some((p) => p.toLowerCase() === provider.toLowerCase())) {
    return { compactor: "pi", source: `skipForProviders ${provider}` };
  }
  return { compactor: settings.overrideDefaultCompaction ? "vcc" : "pi", source: "overrideDefaultCompaction" };
};
