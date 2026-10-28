import { ToolFailure } from './failures.js';
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
    if (!entry) throw new ToolFailure('unknown_tool', `Unknown tool: ${name}`);
    const parsed=entry.config.inputSchema.safeParse(args);
    if(!parsed.success) {
      const schema=z.toJSONSchema(entry.config.inputSchema,{target:'draft-7',io:'input'});
      const accepted=Object.keys(schema.properties??{});
      const unknown=parsed.error.issues.flatMap((issue:z.core.$ZodIssue)=>issue.code==='unrecognized_keys'?issue.keys:[]);
      const message=unknown.length?`Unknown option${unknown.length===1?'':'s'}: ${unknown.map((k:string)=>'--'+k).join(', ')}. Accepted parameters: ${accepted.map(k=>'--'+k).join(', ')}.${name==='run_frames'&&unknown.includes('count')?' Use run_frames --n instead of --count.':''}`:`Invalid parameters for ${name}: ${parsed.error.issues.map((i:z.core.$ZodIssue)=>`${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`;
      throw new ToolFailure('invalid_parameters',message,{tool:name,accepted_parameters:accepted,issues:parsed.error.issues});
    }
    return entry.handler(parsed.data, { mcpReq: { signal } });
  }
}
