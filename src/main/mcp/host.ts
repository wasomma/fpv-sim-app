/*
 * MCP host — loopback Streamable HTTP endpoint.
 *
 * Mirrors fpv-sim-mcp's own http.ts pattern (bearer auth with
 * timingSafeEqual, 1 MB body cap, STATELESS transport: a fresh server +
 * transport pair per request), but composes the server here so the app
 * can register its live-session tools on top of the five batch tools
 * that stay defined upstream in buildServer(). Live state lives in the
 * main process singletons the tools close over, so per-request servers
 * remain correct.
 *
 * Loopback only by design: the endpoint exists for MCP clients on this
 * machine (Claude Code, etc.). The bearer token still gates it because
 * "loopback" includes every local process.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "fpv-sim-mcp/server";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { getSettings } from "../settings.js";

const HOST = "127.0.0.1";
const BODY_LIMIT_BYTES = 1024 * 1024;

export type ServerExtender = (server: McpServer) => void;

interface HostState {
  server: http.Server;
  port: number;
  lastError: string | null;
}

let state: HostState | null = null;
let extender: ServerExtender | null = null;

/** Registered once by the live-session layer; applied to every request's server. */
export function setServerExtender(fn: ServerExtender): void {
  extender = fn;
}

function authorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${getSettings().mcp.token}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: http.ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, name: "fpv-sim-app", version: process.env.npm_package_version ?? "dev" });
    return;
  }
  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "not found; MCP endpoint is POST /mcp" });
    return;
  }
  if (!authorized(req)) {
    jsonRpcError(res, 401, -32000, "Unauthorized: missing or invalid bearer token.");
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonRpcError(res, 405, -32000, "Method not allowed: stateless server, use POST.");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    jsonRpcError(res, 400, -32700, "Parse error: body must be JSON.");
    return;
  }

  const server = buildServer();
  if (extender !== null) extender(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  } catch (err) {
    console.error("mcp host: request failed:", err);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error.");
  }
}

export function startMcpHost(): Promise<{ ok: boolean; port: number; error?: string }> {
  return new Promise((resolve) => {
    const port = getSettings().mcp.port;
    const server = http.createServer((req, res) => {
      void handle(req, res);
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      state = { server, port, lastError: err.code === "EADDRINUSE" ? `port ${port} is in use` : err.message };
      resolve({ ok: false, port, error: state.lastError ?? undefined });
    });
    server.listen(port, HOST, () => {
      state = { server, port, lastError: null };
      console.log(`mcp host ready on http://${HOST}:${port}/mcp (bearer auth)`);
      resolve({ ok: true, port });
    });
  });
}

export async function restartMcpHost(): Promise<{ ok: boolean; port: number; error?: string }> {
  if (state !== null) {
    await new Promise<void>((r) => state?.server.close(() => r()));
    state = null;
  }
  return startMcpHost();
}

export function mcpHostStatus(): { running: boolean; port: number; url: string; lastError: string | null } {
  const port = state?.port ?? getSettings().mcp.port;
  return {
    running: state !== null && state.lastError === null,
    port,
    url: `http://${HOST}:${port}/mcp`,
    lastError: state?.lastError ?? null,
  };
}
