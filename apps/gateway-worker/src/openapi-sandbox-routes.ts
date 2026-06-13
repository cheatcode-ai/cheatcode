import {
  type JsonValue,
  jsonBody,
  jsonResponse,
  type OpenApiRoute,
  schemaRef,
} from "./openapi-builder";

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
