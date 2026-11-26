import { readFileSync, statSync } from "fs";
import { isAbsolute } from "path";

export interface CommitCommandRule {
  id: string;
  tool: "bash";
  /** Literal executable/subcommand tokens, followed by exactly one body file. */
  argvPrefix: string[];
}

export interface RecognitionProfile {
  version: 1;
  commitCommands: CommitCommandRule[];
}

const MAX_PROFILE_BYTES = 65_536;
const MAX_RULES = 16;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

/** A deliberately small data contract, not an executable plugin/regex language. */
export const parseRecognitionProfile = (value: unknown): RecognitionProfile => {
  if (!isRecord(value) || value.version !== 1 || !onlyKeys(value, ["version", "commitCommands"]) ||
      !Array.isArray(value.commitCommands) || value.commitCommands.length > MAX_RULES) {
    throw new Error("expected version 1 and at most 16 commitCommands");
  }
  const ids = new Set<string>();
  const prefixes = new Set<string>();
  const commitCommands = value.commitCommands.map((rule): CommitCommandRule => {
    if (!isRecord(rule) || !onlyKeys(rule, ["id", "tool", "argvPrefix"]) ||
        typeof rule.id !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(rule.id) ||
        rule.tool !== "bash" || !Array.isArray(rule.argvPrefix) ||
        rule.argvPrefix.length < 2 || rule.argvPrefix.length > 4 ||
        !rule.argvPrefix.every((token) => typeof token === "string" && /^[a-zA-Z0-9_./-]{1,120}$/.test(token))) {
      throw new Error("invalid commit command: expected id, bash tool and 2–4 literal argvPrefix tokens");
    }
    const key = rule.argvPrefix.join("\0");
    if (ids.has(rule.id) || prefixes.has(key)) throw new Error("duplicate commit command id or argvPrefix");
    ids.add(rule.id);
    prefixes.add(key);
    return { id: rule.id, tool: "bash", argvPrefix: [...rule.argvPrefix] as string[] };
  });
  return { version: 1, commitCommands };
};

export interface ProfileLoadResult {
  profile?: RecognitionProfile;
  diagnostic?: string;
}

/** Explicit absolute path only. Never scaffolds or executes profile content. */
export const loadRecognitionProfile = (path?: string): ProfileLoadResult => {
  if (!path) return {};
  try {
    if (!isAbsolute(path)) throw new Error("recognitionProfilePath must be absolute");
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) throw new Error("profile must be a file of at most 64 KiB");
    const text = readFileSync(path, "utf8");
    if (Buffer.byteLength(text) > MAX_PROFILE_BYTES) throw new Error("profile exceeds 64 KiB");
    return { profile: parseRecognitionProfile(JSON.parse(text)) };
  } catch (error) {
    // No path, profile body or arbitrary parser error content in the diagnostic.
    const reason = error instanceof SyntaxError ? "invalid JSON" :
      (error as NodeJS.ErrnoException)?.code ? "profile could not be read" :
      error instanceof Error ? error.message : "invalid profile";
    return { diagnostic: `pi-vcc: recognition profile disabled (${reason.slice(0, 160)}). Using built-in extraction.` };
  }
};
