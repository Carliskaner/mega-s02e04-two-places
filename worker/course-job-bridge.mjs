import { writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const endpointVariable = "MEGA_JOB_MCP_URL";
const resultVariable = "MEGA_JOB_RESULT_PATH";
const courseToolNames = new Set([
  "search",
  "read",
  "redact",
  "submit",
  "transcribe",
  "memo_write",
  "memo_search",
]);

async function main() {
  const endpoint = process.env[endpointVariable];
  if (!endpoint) throw new Error("missing endpoint");

  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "hq.mega.dev" ||
    !/^\/mcp\/job\/v1\.[A-Za-z0-9._-]+$/.test(url.pathname) ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error("invalid endpoint");
  }

  const upstream = new Client(
    { name: "s02e04-course-bridge", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const server = new McpServer({ name: "s02e04-course-job", version: "1.0.0" });
  await upstream.connect(new StreamableHTTPClientTransport(url));

  const { tools } = await upstream.listTools();
  for (const tool of tools) {
    if (!courseToolNames.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        title: sanitize(tool.title),
        description: sanitize(tool.description),
        annotations: sanitize(tool.annotations),
        inputSchema: jsonSchema(tool.inputSchema),
        ...(tool.outputSchema ? { outputSchema: jsonSchema(tool.outputSchema) } : {}),
      },
      async (args) => {
        try {
          const result = await upstream.callTool({ name: tool.name, arguments: args });
          if (tool.name === "submit") await captureSubmitResult(result);
          return sanitize(result);
        } catch {
          throw new Error("Course MCP request failed");
        }
      },
    );
  }

  const { resources } = await upstream.listResources();
  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: sanitize(resource.title),
        description: sanitize(resource.description),
        mimeType: resource.mimeType,
        annotations: sanitize(resource.annotations),
      },
      async (uri) => {
        try {
          return sanitize(await upstream.readResource({ uri: uri.href }));
        } catch {
          throw new Error("Course MCP resource read failed");
        }
      },
    );
  }

  const { prompts } = await upstream.listPrompts();
  for (const prompt of prompts) {
    const properties = Object.fromEntries(
      (prompt.arguments ?? []).map((argument) => [
        argument.name,
        { type: "string", description: sanitize(argument.description) },
      ]),
    );
    const required = (prompt.arguments ?? [])
      .filter((argument) => argument.required)
      .map((argument) => argument.name);
    server.registerPrompt(
      prompt.name,
      {
        title: sanitize(prompt.title),
        description: sanitize(prompt.description),
        argsSchema: jsonSchema({ type: "object", properties, required }),
      },
      async (args) => {
        try {
          return sanitize(await upstream.getPrompt({ name: prompt.name, arguments: args }));
        } catch {
          throw new Error("Course MCP prompt request failed");
        }
      },
    );
  }

  const handle = serveStdio(() => server, { onerror: () => {} });
  process.stdin.once("end", () => {
    void upstream.close().catch(() => {});
  });
  process.once("SIGTERM", () => {
    void upstream.close().finally(() => handle.close().finally(() => process.exit(0)));
  });

  async function captureSubmitResult(result) {
    const resultPath = process.env[resultVariable];
    if (!resultPath) throw new Error("missing private result path");
    const serialized = JSON.stringify(result);
    if (serialized.includes(endpoint) || serialized.includes(url.pathname)) {
      throw new Error("submit result contains endpoint data");
    }
    try {
      await writeFile(resultPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch {
      throw new Error("Submit may have succeeded, but private receipt capture failed; do not retry automatically.");
    }
  }

  function jsonSchema(schema) {
    const record = schema && typeof schema === "object" && !Array.isArray(schema)
      ? schema
      : { type: "object", properties: {} };
    return {
      "~standard": {
        version: 1,
        vendor: "s02e04-course-bridge",
        validate(value) {
          return value && typeof value === "object" && !Array.isArray(value)
            ? { value }
            : { issues: [{ message: "Arguments must be an object" }] };
        },
        jsonSchema: {
          input: () => record,
          output: () => record,
        },
      },
    };
  }

  function sanitize(value) {
    if (typeof value === "string") {
      return value
        .replaceAll(endpoint, "[redacted endpoint]")
        .replaceAll(url.pathname, "[redacted job path]")
        .replaceAll(url.origin, "[redacted course host]");
    }
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
    }
    return value;
  }
}

main().catch(() => {
  process.stderr.write("Course MCP bridge failed.\n");
  process.exitCode = 1;
});
