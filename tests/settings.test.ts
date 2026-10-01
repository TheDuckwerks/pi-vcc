import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { debugPath, loadSettings, scaffoldSettings } from "../src/core/settings";
import { PI_VCC_COMPACT_INSTRUCTION, registerBeforeCompactHook } from "../src/hooks/before-compact";

let dir: string;
let prior: Record<string, string | undefined>;
const keys = ["PI_CODING_AGENT_DIR", "PI_VCC_CONFIG_PATH", "PI_VCC_DEBUG_PATH"];
beforeEach(() => {
  prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  dir = mkdtempSync(join(tmpdir(), "vcc-settings-"));
  process.env.PI_CODING_AGENT_DIR = join(dir, "selected-agent");
  delete process.env.PI_VCC_CONFIG_PATH;
  delete process.env.PI_VCC_DEBUG_PATH;
});
afterEach(() => {
  for (const key of keys) {
    if (prior[key] == null) delete process.env[key];
    else process.env[key] = prior[key];
  }
  rmSync(dir, { recursive: true, force: true });
});
const configPath = () => join(getAgentDir(), "pi-vcc-config.json");

describe("VCC runtime paths", () => {
  test("scaffold and load follow Pi's selected agent directory", () => {
    scaffoldSettings();
    expect(existsSync(configPath())).toBe(true);
    const existing = JSON.parse(readFileSync(configPath(), "utf8"));
    writeFileSync(configPath(), JSON.stringify({ ...existing, smartKeepTail: false }));
    expect(loadSettings().smartKeepTail).toBe(false);
    expect(debugPath()).toBe(join(getAgentDir(), "pi-vcc-debug.json"));
  });

  test("the hook's default debug writer uses the selected agent directory", () => {
    scaffoldSettings();
    const config = JSON.parse(readFileSync(configPath(), "utf8"));
    writeFileSync(configPath(), JSON.stringify({ ...config, debug: true }));
    const entries = ["user", "assistant", "user", "assistant"].map((role, i) => ({
      type: "message", id: `m${i}`, parentId: i ? `m${i - 1}` : null,
      message: { role, content: "Check the runtime debug path", timestamp: 0 },
    }));
    let handler: any;
    registerBeforeCompactHook({ on: (name: string, fn: any) => { if (name === "session_before_compact") handler = fn; } } as any);
    const response = handler({
      branchEntries: entries, reason: "manual", customInstructions: `${PI_VCC_COMPACT_INSTRUCTION} keep:0`,
      preparation: { fileOps: { read: [], written: [], edited: [] }, tokensBefore: 1000 },
    }, { sessionManager: { getEntries: () => entries } });
    expect(response.compaction).toBeDefined();
    expect(existsSync(debugPath())).toBe(true);
    expect(JSON.parse(readFileSync(debugPath(), "utf8"))).toBeObject();
  });

  test("explicit trial overrides stay isolated from the normal agent directory", () => {
    process.env.PI_VCC_CONFIG_PATH = join(dir, "scratch", "config.json");
    process.env.PI_VCC_DEBUG_PATH = join(dir, "scratch", "debug.json");
    scaffoldSettings();
    expect(existsSync(process.env.PI_VCC_CONFIG_PATH)).toBe(true);
    expect(existsSync(configPath())).toBe(false);
    expect(debugPath()).toBe(process.env.PI_VCC_DEBUG_PATH);
  });

  test("missing keys are filled without changing preferences or unknown keys", () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ overrideDefaultCompaction: false, skipForProviders: ["xai"], custom: "retained" }));
    scaffoldSettings();
    const config = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(config.overrideDefaultCompaction).toBe(false);
    expect(config.skipForProviders).toEqual(["xai"]);
    expect(config.custom).toBe("retained");
    expect(config.recognitionProfilePath).toBe("");
    const before = readFileSync(configPath(), "utf8");
    scaffoldSettings();
    expect(readFileSync(configPath(), "utf8")).toBe(before);
  });

  test("malformed config is preserved, and loading falls back without rewriting it", () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), "not json");
    scaffoldSettings();
    expect(readFileSync(configPath(), "utf8")).toBe("not json");
    expect(loadSettings().recognitionProfilePath).toBe("");
    expect(readFileSync(configPath(), "utf8")).toBe("not json");
  });
});
