import { afterEach, expect, test } from "vitest";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { runExecProcess } from "./bash-tools.exec-runtime.js";
import { createExecTool } from "./bash-tools.exec.js";

afterEach(() => {
  resetProcessRegistryForTests();
});

function currentEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null),
  );
}

async function runPtyCommand(command: string) {
  const handle = await runExecProcess({
    command,
    workdir: process.cwd(),
    env: currentEnv(),
    usePty: true,
    warnings: [],
    maxOutput: 20_000,
    pendingMaxOutput: 20_000,
    notifyOnExit: false,
    timeoutSec: 5,
  });
  return await handle.promise;
}

test("exec supports pty output", async () => {
  const result = await runPtyCommand(
    'node -e "process.stdout.write(String.fromCharCode(111,107))"',
  );

  expect(result.status).toBe("completed");
  expect(result.aggregated).toContain("ok");
});

test("exec sets OPENCLAW_SHELL in pty mode", async () => {
  const result = await runPtyCommand(
    "node -e \"process.stdout.write(process.env.OPENCLAW_SHELL || '')\"",
  );

  expect(result.status).toBe("completed");
  expect(result.aggregated).toContain("exec");
});

test("exec injects agent and session markers in pty mode", async () => {
  const tool = createExecTool({
    allowBackground: false,
    security: "full",
    ask: "off",
    sessionKey: "agent:agent1:main",
  });
  const result = await tool.execute("toolcall-openclaw-agent-env", {
    command:
      "node -e \"process.stdout.write([process.env.OPENCLAW_AGENT_ID || '', process.env.OPENCLAW_SESSION_KEY || ''].join('|'))\"",
    pty: true,
  });

  expect(result.details.status).toBe("completed");
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  expect(text).toContain("agent1|agent:agent1:main");
});
