#!/usr/bin/env node
import "dotenv/config";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response, NextFunction } from "express";
import { IntegrationService } from "./integrations.js";
import { createEasyFileServer } from "./server.js";
import { EasyFileService } from "./service.js";
import { JsonStore } from "./store.js";

const argValue = (name: string): string | undefined => process.argv.find(value => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const transportName = argValue("transport") ?? process.env.EASYFILE_TRANSPORT ?? "stdio";
const dataDir = argValue("data-dir") ?? process.env.EASYFILE_DATA_DIR ?? ".easyfile";
const store = new JsonStore(dataDir);
await store.init();
const service = new EasyFileService(store);
const integrations = new IntegrationService(store);

if (transportName === "stdio") {
  const server = createEasyFileServer(service, integrations);
  await server.connect(new StdioServerTransport());
} else if (transportName === "http") {
  const host = process.env.EASYFILE_HOST ?? "127.0.0.1";
  const allowedHosts = (process.env.EASYFILE_ALLOWED_HOSTS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const app = createMcpExpressApp({ host, allowedHosts: allowedHosts.length ? allowedHosts : undefined });
  const apiKey = process.env.EASYFILE_API_KEY;
  const allowedOrigins = new Set((process.env.EASYFILE_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("origin");
    if (origin && allowedOrigins.size && !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok", service: "easyfile-mcp", version: "0.1.0" }));
  app.post("/mcp", async (req: Request, res: Response) => {
    if (apiKey && req.header("authorization") !== `Bearer ${apiKey}`) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    const server = createEasyFileServer(service, integrations);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    } finally {
      await transport.close();
      await server.close();
    }
  });
  app.all("/mcp", (_req: Request, res: Response) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));

  const port = Number(argValue("port") ?? process.env.EASYFILE_PORT ?? 3000);
  app.listen(port, host, error => {
    if (error) throw error;
    console.error(`EasyFile MCP listening on http://${host}:${port}/mcp`);
  });
} else {
  throw new Error(`Unsupported transport: ${transportName}. Use stdio or http.`);
}
