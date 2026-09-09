import { describe, it, afterAll } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerFauxProvider, fauxAssistantMessage, fauxToolCall } from "@mariozechner/pi-ai";
import { createNativeSubagent } from "../../pi-extension/subagents/native-session.ts";
import { createSubagentDoneExtension } from "../../pi-extension/subagents/subagent-done.ts";
import subagentsExtension, { __test__ as extensionTestApi } from "../../pi-extension/subagents/index.ts";
import {
  findLastAssistantMessage,
  getNewEntries,
  readSubagentEvents,
  registerName,
  writeSubagentLoadout,
} from "../../pi-extension/subagents/session.ts";

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

  it("delivers progress and artifact publications through native tool calls", async () => {
    const cwd = sandbox();
    const artifact = join(cwd, "result.md");
    writeFileSync(artifact, "native artifact");
    let sessionFile = "";
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("report_progress", { message: "Artifact ready", percent: 90 }),
        fauxToolCall("publish_artifact", { path: "result.md", description: "E2E result" }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("protocol complete"),
    ]);
    const child = await createNativeSubagent({
      cwd,
      agentDir: join(cwd, ".pi", "agent"),
      model: faux.getModel("e2e-model"),
      tools: [],
      extensionFactory: (createdSessionFile) => {
        sessionFile = createdSessionFile;
        return createSubagentDoneExtension({ sessionFile: createdSessionFile, cwd, autoExit: false });
      },
    });
    try {
      await child.session.prompt("Publish the prepared result and report progress.");
      const events = readSubagentEvents(sessionFile);
      assert.deepEqual(events.map((event) => event.type), ["progress", "artifact"]);
      assert.equal(events[0].percent, 90);
      assert.equal(events[1].path, artifact);
      assert.equal(findLastAssistantMessage(getNewEntries(sessionFile, 0)), "protocol complete");
    } finally {
      child.dispose();
    }
  });

  it("forks and restarts finished sessions through the parent tools", async () => {
    const cwd = sandbox();
    const parentId = "parent-e2e";
    const artifactDir = join(cwd, "artifacts", parentId);
    const source = join(cwd, "source.jsonl");
    writeFileSync(source, [
      JSON.stringify({ type: "session", version: 3, id: "source-e2e", timestamp: new Date().toISOString(), cwd }),
      JSON.stringify({ type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "source task" }] } }),
      JSON.stringify({ type: "message", id: "a1", message: {
        role: "assistant", content: [{ type: "text", text: "source result" }],
        api: faux.api, provider: "openai", model: "e2e-model", stopReason: "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: Date.now(),
      } }),
    ].join("\n") + "\n");
    registerName(artifactDir, "source", { sessionFile: source, sessionId: "source-e2e" });
    writeSubagentLoadout(source, {
      agent: null, toolAllowlist: "", model: null, thinking: null,
      systemPromptMode: null, identity: null, spawnable: null, autoExit: true,
      cwd, agentDir: join(cwd, ".pi", "agent"),
    });
    const tools: any[] = [];
    const completions: any[] = [];
    let resolveCompletion: (() => void) | undefined;
    const completion = () => new Promise<void>((resolve) => { resolveCompletion = resolve; });
    const api = {
      on() {}, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
      registerTool(tool: any) { tools.push(tool); },
      sendMessage(message: any) {
        if (message.customType === "subagent_result") {
          completions.push(message);
          resolveCompletion?.();
        }
      },
      sendUserMessage() {}, getAllTools() { return []; },
    } as any;
    subagentsExtension(api);
    const ctx = {
      cwd,
      model: faux.getModel("e2e-model"),
      sessionManager: {
        getSessionDir: () => cwd,
        getSessionId: () => parentId,
        getSessionFile: () => join(cwd, "parent.jsonl"),
      },
    } as any;
    extensionTestApi.runningSubagents.clear();
    try {
      faux.setResponses([fauxAssistantMessage("fork complete")]);
      let done = completion();
      const fork = tools.find((tool) => tool.name === "subagent_fork");
      const forked = await fork.execute("fork-1", { name: "source", newName: "branch", task: "Continue independently." }, undefined, undefined, ctx);
      assert.equal(forked.details.status, "started");
      await done;
      assert.match(completions.at(-1).content, /fork complete/);

      faux.setResponses([fauxAssistantMessage("restart complete")]);
      done = completion();
      const restart = tools.find((tool) => tool.name === "subagent_restart");
      const restarted = await restart.execute("restart-1", { name: "source", task: "Start fresh." }, undefined, undefined, ctx);
      assert.equal(restarted.details.status, "started");
      await done;
      assert.match(completions.at(-1).content, /restart complete/);
    } finally {
      extensionTestApi.runningSubagents.clear();
    }
  });
});
