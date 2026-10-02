// Opt-in installed-host proof: PI_VCC_TEST_HOST=/path/to/pi-coding-agent node --test ...
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const host = process.env.PI_VCC_TEST_HOST;
test('installed Pi loads goal controls and preserves branch-local metadata without inference', { skip: !host }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const scratch = mkdtempSync(path.join(root, 'node_modules/.tmp/installed-goal-'));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = scratch;
  process.env.PI_OFFLINE = '1';
  process.env.PI_TELEMETRY = '0';
  let session;
  try {
    const sdk = await import(`${host}/dist/index.js`);
    const settingsManager = sdk.SettingsManager.inMemory({
      defaultTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'codemode'],
      codemode: { mode: 'on' }, cacheWarming: 'off', enableInstallTelemetry: false,
    });
    const loader = new sdk.DefaultResourceLoader({
      cwd: scratch, agentDir: scratch, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: [path.join(root, 'index.ts')],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const manager = sdk.SessionManager.inMemory(scratch);
    ({ session } = await sdk.createAgentSession({ cwd: scratch, agentDir: scratch, settingsManager,
      resourceLoader: loader, sessionManager: manager }));
    const errors = [];
    await session.bindExtensions({ onError: e => errors.push(e.message) });
    const runner = session.extensionRunner;
    const command = runner.getCommand('goal');
    assert(command);
    const ctx = runner.createContext();
    await command.handler('Fix the receipt bug; leave other work parked', ctx);
    const pin = manager.getBranch().find(e => e.type === 'custom' && e.customType === 'pi-vcc-goal');
    assert(pin);
    const original = [{ role: 'user', content: 'Latest instruction', timestamp: 0 }];
    const outgoing = await runner.emitContext(original);
    assert.equal(outgoing[0].customType, 'pi-vcc-goal-reference');
    assert.match(outgoing[0].content, /Fix the receipt bug/);
    assert.equal(original.length, 1);
    assert.equal(manager.getBranch().filter(e => e.type === 'message').length, 0);
    const converted = sdk.convertToLlm(outgoing);
    assert(converted.some(m => JSON.stringify(m.content).includes('Fix the receipt bug')));
    assert(session.getActiveToolNames().includes('vcc_goal'));
    const goalTool = loader.getExtensions().extensions[0].tools.get('vcc_goal').definition;
    const result = await goalTool.execute('get', { action: 'get' }, undefined, undefined, ctx);
    assert.equal(result.details.goal.entryId, pin.id);
    // The actual native host's compaction hook, not an alternate compiler.
    for (let i = 0; i < 3; i++) {
      manager.appendMessage({ role: 'user', content: `Do bounded task ${i}`, timestamp: i });
      manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Recorded' }], timestamp: i });
    }
    const compacted = await runner.emit({ type: 'session_before_compact',
      branchEntries: manager.getBranch(), customInstructions: 'pi-vcc keep:0', reason: 'manual', willRetry: false,
      preparation: { fileOps: { read: [], written: [], edited: [] }, tokensBefore: 2000 } });
    assert(compacted?.compaction?.summary.startsWith('[User-pinned Goal]'));
    manager.appendCompaction(compacted.compaction.summary, '', 2000, compacted.compaction.details);
    const exportHost = await import(`${host}/dist/core/session-export.js`);
    const file = exportHost.exportSessionToJsonl(manager, path.join(scratch, 'export.jsonl'));
    const resumed = sdk.SessionManager.open(file);
    assert(resumed.getBranch().some(e => e.id === pin.id));
    await goalTool.execute('clear', { action: 'clear', expectedId: pin.id, reason: 'Agreed result verified' }, undefined, undefined, ctx);
    const after = await runner.emitContext([{ role: 'compactionSummary', summary: compacted.compaction.summary, timestamp: 0 }]);
    assert(!JSON.stringify(after).includes('User-pinned Goal'));
    assert.deepEqual(errors, []);
  } finally {
    session?.dispose();
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    rmSync(scratch, { recursive: true, force: true });
  }
});
