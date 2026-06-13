import {
  type JsonValue,
  jsonBody,
  jsonResponse,
  nullableStringSchema,
  type OpenApiRoute,
  schemaRef,
  stringSchema,
} from "./openapi-builder";

export const sandboxSchemas: Record<string, JsonValue> = {
  SandboxConsoleLine: {
    additionalProperties: false,
    properties: {
      stream: { enum: ["stdout", "stderr"], type: "string" },
      text: stringSchema({ maxLength: 2_000 }),
    },
    required: ["stream", "text"],
    type: "object",
  },
  SandboxConsoleProcess: {
    additionalProperties: false,
    properties: {
      command: stringSchema(),
      id: stringSchema(),
      pid: nullableStringSchema(),
      status: stringSchema(),
    },
    required: ["command", "id", "pid", "status"],
    type: "object",
  },
  SandboxConsoleSnapshot: {
    additionalProperties: false,
    properties: {
      cursor: {
        additionalProperties: false,
        properties: {
          stderr: { minimum: 0, type: "integer" },
          stdout: { minimum: 0, type: "integer" },
        },
        required: ["stderr", "stdout"],
        type: "object",
      },
      lines: { items: schemaRef("SandboxConsoleLine"), maxItems: 500, type: "array" },
      process: { anyOf: [schemaRef("SandboxConsoleProcess"), { type: "null" }] },
      reset: { type: "boolean" },
      truncated: { type: "boolean" },
    },
    required: ["cursor", "lines", "process", "reset", "truncated"],
    type: "object",
  },
};

const sandboxEncodingParameter: JsonValue = {
  in: "query",
  name: "encoding",
  schema: { enum: ["utf8", "base64"], type: "string" },
};

const sandboxFilePathParameter: JsonValue = {
  in: "query",
  name: "path",
  required: true,
  schema: { type: "string" },
};

const sandboxFileListParameters: JsonValue[] = [
  { in: "query", name: "path", schema: { default: "/workspace/app/src/app", type: "string" } },
  { in: "query", name: "recursive", schema: { default: true, type: "boolean" } },
  { in: "query", name: "includeHidden", schema: { default: false, type: "boolean" } },
];

export const sandboxRoutes: OpenApiRoute[] = [
  {
    method: "get",
    operationId: "readSandboxConsole",
    parameters: [
      { in: "query", name: "processId", schema: { default: "app-preview", type: "string" } },
      { in: "query", name: "stdoutCursor", schema: { default: 0, minimum: 0, type: "integer" } },
      { in: "query", name: "stderrCursor", schema: { default: 0, minimum: 0, type: "integer" } },
      { in: "query", name: "lastPid", schema: { type: "string" } },
      {
        in: "query",
        name: "tail",
        schema: { default: 200, maximum: 500, minimum: 1, type: "integer" },
      },
    ],
    path: "/v1/threads/{threadId}/sandbox/console",
    responses: {
      "200": jsonResponse("Sandbox console snapshot", schemaRef("SandboxConsoleSnapshot")),
    },
    security: [{ bearerAuth: [] }],
    summary: "Tail dev-server console output for a thread's sandbox",
    tags: ["sandbox"],
  },
  {
    method: "get",
    operationId: "listSandboxFiles",
    parameters: sandboxFileListParameters,
    path: "/v1/threads/{threadId}/sandbox/files",
    responses: { "200": jsonResponse("Sandbox files", schemaRef("SandboxFileList")) },
    security: [{ bearerAuth: [] }],
    summary: "List sandbox files for a thread",
    tags: ["sandbox"],
  },
  {
    method: "get",
    operationId: "readSandboxFile",
    parameters: [sandboxFilePathParameter, sandboxEncodingParameter],
    path: "/v1/threads/{threadId}/sandbox/file",
    responses: { "200": jsonResponse("Sandbox file", schemaRef("SandboxFile")) },
    security: [{ bearerAuth: [] }],
    summary: "Read a sandbox file by path",
    tags: ["sandbox"],
  },
  {
    method: "patch",
    operationId: "writeSandboxFile",
    path: "/v1/threads/{threadId}/sandbox/file",
    requestBody: jsonBody(schemaRef("WriteSandboxFile")),
    responses: { "200": jsonResponse("Sandbox file write", schemaRef("SandboxFileWrite")) },
    security: [{ bearerAuth: [] }],
    summary: "Write a sandbox file by path",
    tags: ["sandbox"],
  },
  {
    method: "get",
    operationId: "readSandboxFileByKey",
    parameters: [sandboxEncodingParameter],
    path: "/v1/threads/{threadId}/sandbox/files/{fileKey}",
    responses: { "200": jsonResponse("Sandbox file", schemaRef("SandboxFile")) },
    security: [{ bearerAuth: [] }],
    summary: "Read a sandbox file by encoded key",
    tags: ["sandbox"],
  },
  {
    method: "patch",
    operationId: "writeSandboxFileByKey",
    path: "/v1/threads/{threadId}/sandbox/files/{fileKey}",
    requestBody: jsonBody(schemaRef("WriteSandboxFile")),
    responses: { "200": jsonResponse("Sandbox file write", schemaRef("SandboxFileWrite")) },
    security: [{ bearerAuth: [] }],
    summary: "Write a sandbox file by encoded key",
    tags: ["sandbox"],
  },
  {
    method: "post",
    operationId: "openSandboxTerminal",
    path: "/v1/threads/{threadId}/sandbox/terminal",
    requestBody: jsonBody(schemaRef("OpenSandboxTerminal")),
    responses: { "200": jsonResponse("Terminal preview", schemaRef("TerminalPreview")) },
    security: [{ bearerAuth: [] }],
    summary: "Run a sandbox terminal command",
    tags: ["sandbox"],
  },
];
