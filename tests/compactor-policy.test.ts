import { buildSessionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { COMPACTOR_STATE, registerCompactorCommand, resolveCompactor, sessionCompactor } from "../src/core/compactor-policy";
import { loadSettings } from "../src/core/settings";

let dir: string;
let prior: string | undefined;
beforeEach(() => {
  prior = process.env.PI_VCC_CONFIG_PATH;
  dir = mkdtempSync(join(tmpdir(), "vcc-policy-"));
  process.env.PI_VCC_CONFIG_PATH = join(dir, "config.json");
});
afterEach(() => {
  if (prior == null) delete process.env.PI_VCC_CONFIG_PATH;
  else process.env.PI_VCC_CONFIG_PATH = prior;
  rmSync(dir, { recursive: true, force: true });
});

const save = (data: unknown) => writeFileSync(process.env.PI_VCC_CONFIG_PATH!, JSON.stringify(data));

describe("compactor policy", () => {
  test("defaults to Pi and retains the legacy boolean mapping when no new key exists", () => {
    save({});
    expect(loadSettings().defaultCompactor).toBe("pi");
    save({ overrideDefaultCompaction: true });
    expect(loadSettings().defaultCompactor).toBe("vcc");
    save({ overrideDefaultCompaction: true, defaultCompactor: "pi" });
    expect(loadSettings().defaultCompactor).toBe("pi");
  });

  test("one-shot, session, exact-model, provider and default precedence", () => {
    save({
      defaultCompactor: "pi",
      compactorsByProvider: { OpenAI: "vcc" },
      compactorsByModel: { "openai/gpt-x": "pi" },
    });
    const settings = loadSettings();
    const ctx = { model: { provider: "openai", id: "gpt-x" }, sessionManager: { getBranch: () => [] } };
    expect(resolveCompactor(settings, ctx).compactor).toBe("pi");
    expect(resolveCompactor(settings, { ...ctx, model: { provider: "openai", id: "other" } }).compactor).toBe("vcc");
    expect(resolveCompactor(settings, { ...ctx, model: undefined }).compactor).toBe("pi");
    expect(resolveCompactor(settings, ctx, true).source).toBe("/pi-vcc");
  });

  test("session selection survives compaction without changing model context", async () => {
    save({ defaultCompactor: "pi" });
    const base = [
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "hello" } },
      { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: "reply" } },
    ];
    let branch: any[] = [...base];
    let command: any;
    const pi = {
      registerCommand: (name: string, registration: any) => {
        expect(name).toBe("compactor");
        command = registration;
      },
      appendEntry: (customType: string, data: unknown) => {
        branch = [...branch, { type: "custom", id: "choice", parentId: "a1", customType, data }];
      },
    };
    const ctx = { model: undefined, sessionManager: { getBranch: () => branch }, ui: { notify: () => {} } };
    registerCompactorCommand(pi as any);
    await command.handler("vcc", ctx);

    expect(branch.at(-1).customType).toBe(COMPACTOR_STATE);
    expect(buildSessionContext(base, "a1").messages).toEqual(buildSessionContext(branch, "choice").messages);

    branch = [
      ...branch,
      { type: "message", id: "u2", parentId: "choice", message: { role: "user", content: "next" } },
      { type: "message", id: "a2", parentId: "u2", message: { role: "assistant", content: "reply" } },
      { type: "compaction", id: "c1", parentId: "a2", firstKeptEntryId: "u2", summary: "summary" },
      { type: "message", id: "u3", parentId: "c1", message: { role: "user", content: "continue" } },
    ];
    expect(sessionCompactor(ctx)).toBe("vcc");
    const context = buildSessionContext(branch, "u3").messages;
    expect(context.some((message: any) => message.role === "custom" && message.customType === COMPACTOR_STATE)).toBe(false);
  });

  test("session override wins and auto resets to configured policy", () => {
    save({ defaultCompactor: "pi", compactorsByProvider: { openai: "vcc" } });
    const settings = loadSettings();
    const ctx = { model: { provider: "openai", id: "gpt-x" }, sessionManager: { getBranch: () => [
      { type: "custom", customType: "pi-vcc:compactor", data: { compactor: "vcc" } },
      { type: "custom", customType: "pi-vcc:compactor", data: { compactor: "pi" } },
    ] } };
    const branch = ctx.sessionManager.getBranch();
    expect(resolveCompactor(settings, ctx).compactor).toBe("pi");
    ctx.sessionManager.getBranch = () => [...branch,
      { type: "custom", customType: "pi-vcc:compactor", data: { compactor: "auto" } }];
    expect(resolveCompactor(settings, ctx).compactor).toBe("vcc");
  });
});
