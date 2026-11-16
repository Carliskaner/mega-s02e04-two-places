import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const workspace = process.env.GITHUB_WORKSPACE;
const runnerTemp = process.env.RUNNER_TEMP;
const copilotHome = process.env.COPILOT_HOME;
if (!workspace || !runnerTemp || !copilotHome) {
  process.stderr.write("Worker configuration is incomplete.\n");
  process.exit(1);
}

const configPath = join(copilotHome, "mcp-config.json");
const resultPath = join(runnerTemp, "job2-result.json");
const config = {
  mcpServers: {
    "course-job": {
      type: "local",
      command: "node",
      args: [join(workspace, "worker", "course-job-bridge.mjs")],
      env: { MEGA_JOB_RESULT_PATH: resultPath },
      tools: ["*"],
    },
  },
};

await mkdir(copilotHome, { recursive: true });
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
