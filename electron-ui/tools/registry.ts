import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

/** One registration surface for MCP and direct, in-process CLI calls. */
export type ToolRegistrar = Pick<McpServer, 'registerTool'>;
export class ToolRegistry implements ToolRegistrar {
  private entries = new Map<string, { config: any; handler: any }>();
  registerTool: McpServer['registerTool'] = ((name: string, config: any, handler: any) => {
    if (this.entries.has(name)) throw new Error(`Duplicate tool: ${name}`);
    this.entries.set(name, { config, handler });
    return {};
  }) as McpServer['registerTool'];
  list() {
    return [...this.entries].map(([name, { config }]) => ({ name, description: config.description,
      inputSchema: z.toJSONSchema(config.inputSchema, { target: 'draft-7', io: 'input' }),
      ...(config.annotations ? { annotations: config.annotations } : {}) }));
  }
  async call(name: string, args: unknown, signal: AbortSignal = new AbortController().signal) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unknown tool: ${name}`);
    return entry.handler(entry.config.inputSchema.parse(args), { mcpReq: { signal } });
  }
}
