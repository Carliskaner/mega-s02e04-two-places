import { spawn } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const endpoint = process.env.MEGA_JOB_MCP_URL;
const copilotHome = process.env.COPILOT_HOME;
const runnerTemp = process.env.RUNNER_TEMP;
const resultPath = runnerTemp ? join(runnerTemp, "job2-result.json") : "";

function validEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "hq.mega.dev" &&
      /^\/mcp\/job\/v1\.[A-Za-z0-9._-]+$/.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function directoryContains(directory, values) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContains(path, values)) return true;
    } else {
      const content = await readFile(path, "utf8").catch(() => "");
      if (values.some((value) => value && content.includes(value))) return true;
    }
  }
  return false;
}

async function main() {
  if (!endpoint || !validEndpoint(endpoint) || !copilotHome || !runnerTemp) {
    process.stderr.write("worker_status=blocked\n");
    process.exitCode = 1;
    return;
  }

  const url = new URL(endpoint);
  const childEnvironment = { ...process.env };
  delete process.env.MEGA_JOB_MCP_URL;
  const argumentsList = [
    "--model=gpt-6-luna",
    "--max-ai-credits=30",
    "--output-format=json",
    "--log-level=none",
    `--log-dir=${join(runnerTemp, "copilot-logs")}`,
    "--disable-builtin-mcps",
    "--enable-mcp-server=course-job",
    "--secret-env-vars=COPILOT_GITHUB_TOKEN",
    "--available-tools=course-job-transcribe",
    "--available-tools=course-job-memo_write",
    "--available-tools=course-job-memo_search",
    "--available-tools=course-job-submit",
    "--allow-tool=course-job",
    "--prompt=Perform only job 2 using the verified voice-to-memo v1 contract; do not try to read the skill URI. Call transcribe on the supplied clip. Write one memo per fault, freeze/stall, hold, or reset occurrence in the format <what happened> @m:ss, using the clip offset; talk around an event is not a finding. Call memo_search with no query, confirm every finding and offset is present, fill gaps, then search again. Submit exactly the notes, one per line, with skillVersion: 1. Pass each step token to the next tool except transcribe. Preserve spoken times separately from clip offsets. Do not retry an ambiguous submit. Do not delegate or reveal credentials or endpoint data.",
  ];

  const stdoutChunks = [];
  const stderrChunks = [];
  let childError = false;
  const child = spawn("copilot", argumentsList, {
    cwd: process.env.GITHUB_WORKSPACE,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  delete childEnvironment.MEGA_JOB_MCP_URL;
  child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  child.once("error", () => {
    childError = true;
  });
  const exitCode = await new Promise((resolve) => child.once("close", resolve));

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  const sensitiveValues = [endpoint, url.pathname, url.origin];
  let outputClean = !sensitiveValues.some((value) => stdout.includes(value) || stderr.includes(value));
  const scanDirectories = [
    join(copilotHome, "logs"),
    join(copilotHome, "session-state"),
    join(runnerTemp, "copilot-logs"),
  ];
  for (const directory of scanDirectories) {
    if (await directoryContains(directory, sensitiveValues)) outputClean = false;
  }
  for (const directory of scanDirectories) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }

  const resultExists = await readFile(resultPath).then(() => true).catch(() => false);
  process.env.MEGA_JOB_MCP_URL = "";
  stdoutChunks.length = 0;
  stderrChunks.length = 0;
  const complete = !childError && exitCode === 0 && outputClean && resultExists;
  process.stdout.write(`worker_status=${complete ? "complete" : "failed"};endpoint_scan=${outputClean ? "clean" : "failed"}\n`);
  if (!complete) process.exitCode = 1;
}

main().catch(() => {
  process.stderr.write("worker_status=failed\n");
  process.exitCode = 1;
  delete process.env.MEGA_JOB_MCP_URL;
});
