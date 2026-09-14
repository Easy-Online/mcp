import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { IntegrationService } from "../src/integrations.js";
import { createEasyFileServer } from "../src/server.js";
import { EasyFileService } from "../src/service.js";
import { JsonStore } from "../src/store.js";

describe("MCP contract", () => {
  it("negotiates and exposes every EasyFile module", async () => {
    const store = new JsonStore(await mkdtemp(join(tmpdir(), "easyfile-mcp-test-")));
    await store.init();
    const server = createEasyFileServer(new EasyFileService(store), new IntegrationService(store));
    const client = new Client({ name: "easyfile-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(30);
    expect(tools.tools.map(entry => entry.name)).toContain("crm_customer_upsert");
    expect(tools.tools.map(entry => entry.name)).toContain("integration_webhook_dispatch");
    const result = await client.callTool({ name: "easyfile_modules_list", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("Easy Payroll");
    await client.close();
    await server.close();
  });
});
