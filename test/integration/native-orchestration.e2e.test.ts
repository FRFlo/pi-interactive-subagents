import { describe, it, afterAll } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerFauxProvider, fauxAssistantMessage } from "@mariozechner/pi-ai";
import { createNativeSubagent } from "../../pi-extension/subagents/native-session.ts";
import { findLastAssistantMessage, getNewEntries } from "../../pi-extension/subagents/session.ts";

const faux = registerFauxProvider({
  api: "interactive-subagents-e2e",
  // The SDK checks provider credentials before dispatching the request. The
  // faux API never sends a network request, so a process-local dummy key is
  // sufficient to exercise the complete AgentSession loop.
  provider: "openai",
  models: [{ id: "e2e-model", name: "Interactive subagents E2E" }],
});
process.env.OPENAI_API_KEY ??= "e2e-dummy-key";

afterAll(() => faux.unregister());

function sandbox() {
  return mkdtempSync(join(tmpdir(), "pi-interactive-subagents-e2e-"));
}

async function createChild(cwd: string, sessionFile?: string) {
  return createNativeSubagent({
    cwd,
    agentDir: join(cwd, ".pi", "agent"),
    sessionFile,
    model: faux.getModel("e2e-model"),
    // An explicit empty allowlist proves that the native session starts with
    // no ambient project/global tools or extensions.
    tools: [],
  });
}

describe("native subagent orchestration (E2E)", () => {
  it("runs a prompt through the native session and persists its result", async () => {
    const cwd = sandbox();
    faux.setResponses([fauxAssistantMessage("native result: alpha")]);
    const child = await createChild(cwd);

    try {
      await child.session.prompt("Return the alpha result.");
      const entries = getNewEntries(child.sessionFile, 0);
      assert.equal(findLastAssistantMessage(entries), "native result: alpha");
      assert.ok(existsSync(child.sessionFile));
      assert.equal(child.session.getActiveToolNames().length, 0);
    } finally {
      child.dispose();
    }
  });

  it("runs parallel native sessions without sharing transcripts", async () => {
    const firstCwd = sandbox();
    const secondCwd = sandbox();
    faux.setResponses([
      fauxAssistantMessage("parallel result: first"),
      fauxAssistantMessage("parallel result: second"),
    ]);
    const first = await createChild(firstCwd);
    const second = await createChild(secondCwd);

    try {
      await Promise.all([
        first.session.prompt("Complete the first task."),
        second.session.prompt("Complete the second task."),
      ]);
      assert.equal(findLastAssistantMessage(getNewEntries(first.sessionFile, 0)), "parallel result: first");
      assert.equal(findLastAssistantMessage(getNewEntries(second.sessionFile, 0)), "parallel result: second");
      assert.notEqual(first.sessionFile, second.sessionFile);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("resumes a persisted native session with the same transcript", async () => {
    const cwd = sandbox();
    faux.setResponses([fauxAssistantMessage("initial result")]);
    const first = await createChild(cwd);
    const sessionFile = first.sessionFile;
    await first.session.prompt("Complete the initial task.");
    first.dispose();

    faux.setResponses([fauxAssistantMessage("resumed result")]);
    const resumed = await createChild(cwd, sessionFile);
    try {
      await resumed.session.prompt("Continue the task.");
      const entries = getNewEntries(sessionFile, 0);
      assert.equal(findLastAssistantMessage(entries), "resumed result");
      assert.equal(resumed.sessionFile, sessionFile);
    } finally {
      resumed.dispose();
    }
  });
});
