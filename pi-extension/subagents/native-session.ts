import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import * as PiCodingAgent from "@mariozechner/pi-coding-agent";
import { join } from "node:path";

/**
 * Keep durable subagent transcripts outside Pi's default `sessions/` tree.
 * They remain addressable by their registered file paths, but are not offered
 * by `/resume` or `pi --resume`.
 */
export function getNativeSubagentSessionDir(agentDir: string): string {
  return join(agentDir, "subagent-sessions");
}

export interface NativeSubagentOptions {
  cwd: string;
  agentDir: string;
  sessionFile?: string;
  parentSessionFile?: string;
  model?: NonNullable<Parameters<typeof createAgentSession>[0]>["model"];
  tools?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
  extensionFactories?: ExtensionFactory[];
  extensionFactory?: (sessionFile: string) => ExtensionFactory;
}

export interface NativeSubagent {
  session: AgentSession;
  sessionFile: string;
  dispose(): void;
}

/**
 * Create an in-process pi session.  There is deliberately no terminal or
 * child process involved: AgentSession owns the model loop and SessionManager
 * owns the durable JSONL transcript.
 */
export async function createNativeSubagent(options: NativeSubagentOptions): Promise<NativeSubagent> {
  const sessionManager = options.sessionFile
    ? SessionManager.open(options.sessionFile, undefined, options.cwd)
    : SessionManager.create(
      options.cwd,
      getNativeSubagentSessionDir(options.agentDir),
      options.parentSessionFile ? { parentSession: options.parentSessionFile } : undefined,
    );
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir);
  const extensionFactories = [
    ...(options.extensionFactories ?? []),
    ...(options.extensionFactory && sessionManager.getSessionFile()
      ? [options.extensionFactory(sessionManager.getSessionFile()!)]
      : []),
  ];
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    extensionFactories,
    systemPrompt: options.systemPrompt ?? options.appendSystemPrompt,
    noExtensions: options.tools !== undefined,
  });
  await resourceLoader.reload();

  // Older pi SDKs expect instantiated tool objects; current pi SDKs expect
  // tool names. Support both because the extension can be loaded by either
  // the bundled runtime or the standalone package test dependencies.
  const legacyCodingTools = (PiCodingAgent as any).codingTools as any[] | undefined;
  const selectedTools = legacyCodingTools
    ? legacyCodingTools.filter((tool) => options.tools!.includes(tool.name))
    : options.tools;

  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager,
    settingsManager,
    resourceLoader,
    model: options.model,
    tools: options.tools ? selectedTools : undefined,
  } as any);

  return {
    session,
    sessionFile: sessionManager.getSessionFile() ?? "",
    dispose() {
      session.dispose();
    },
  };
}
