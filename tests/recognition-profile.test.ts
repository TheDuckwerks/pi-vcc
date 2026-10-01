import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadRecognitionProfile, parseRecognitionProfile } from "../src/core/recognition-profile";
import profileJson from "../examples/duckwerks-recognition.json";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const file = (text: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "vcc-profile-"));
  dirs.push(dir);
  const path = join(dir, "profile.json");
  writeFileSync(path, text);
  return path;
};

describe("recognition profile contract", () => {
  test("parses the example and an empty additive profile", () => {
    expect(parseRecognitionProfile(profileJson)).toEqual(profileJson);
    expect(parseRecognitionProfile({ version: 1, commitCommands: [] })).toEqual({ version: 1, commitCommands: [] });
  });

  test.each([
    null, [], {}, { version: 2, commitCommands: [] },
    { version: 1, commitCommands: "quack" },
    { version: 1, commitCommands: [], unknown: true },
    { version: 1, commitCommands: [{ id: "x", tool: "read", argvPrefix: ["quack", "commit"] }] },
    { version: 1, commitCommands: [{ id: "x", tool: "bash", argvPrefix: ["quack"] }] },
    { version: 1, commitCommands: [{ id: "x", tool: "bash", argvPrefix: ["quack", "commit"], execute: "code" }] },
    { version: 1, commitCommands: [{ id: "x", tool: "bash", argvPrefix: ["quack", ".*"] }] },
    { version: 1, commitCommands: [profileJson.commitCommands[0], profileJson.commitCommands[0]] },
    { version: 1, commitCommands: Array.from({ length: 17 }, (_, i) => ({ id: `x${i}`, tool: "bash", argvPrefix: [`q${i}`, "commit"] })) },
  ].map(value => [value]))("rejects invalid or unbounded data %#", value => {
    expect(() => parseRecognitionProfile(value)).toThrow();
  });

  test("does not keep aliases to mutable input arrays", () => {
    const raw = structuredClone(profileJson);
    const parsed = parseRecognitionProfile(raw);
    raw.commitCommands[0].argvPrefix[0] = "other";
    expect(parsed.commitCommands[0].argvPrefix[0]).toBe("quack");
  });
});

describe("read-only profile loading", () => {
  test("disabled without an explicit path", () => {
    expect(loadRecognitionProfile()).toEqual({});
    expect(loadRecognitionProfile("")).toEqual({});
  });

  test("loads the file and picks up an operator edit on the next load", () => {
    const path = file(JSON.stringify(profileJson));
    expect(loadRecognitionProfile(path)).toEqual({ profile: profileJson });
    writeFileSync(path, JSON.stringify({ version: 1, commitCommands: [] }));
    expect(loadRecognitionProfile(path)).toEqual({ profile: { version: 1, commitCommands: [] } });
  });

  test("invalid JSON, schema, missing file and relative paths yield bounded fallback diagnostics", () => {
    for (const path of [file("not json SECRET_MARKER"), file(JSON.stringify({ version: 7 })), join(dirs[0], "missing"), "profile.json"]) {
      const loaded = loadRecognitionProfile(path);
      expect(loaded.profile).toBeUndefined();
      expect(loaded.diagnostic).toContain("Using built-in extraction");
      expect(loaded.diagnostic!.length).toBeLessThan(260);
      expect(loaded.diagnostic).not.toContain("SECRET_MARKER");
    }
  });

  test("rejects oversized files and directories", () => {
    const path = file("x".repeat(65_537));
    expect(loadRecognitionProfile(path).profile).toBeUndefined();
    expect(loadRecognitionProfile(dirs[0]).profile).toBeUndefined();
  });
});
