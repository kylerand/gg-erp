/**
 * Global ERP Copilot — Core agent logic using AWS Bedrock Converse API.
 *
 * A general-purpose AI assistant for the entire Golfin' Garage ERP system.
 * Can look up customers, inventory, work orders, employees, sales, training, and more.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type ToolResultBlock,
  type ToolUseBlock,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';

import { PrismaClient, type Prisma } from '@prisma/client';

import { TOOL_CONFIG, executeTool } from './copilot-tools.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0';
const REGION = process.env.AWS_REGION || 'us-east-2';
const MAX_TURNS = 10;

let bedrockClient: BedrockRuntimeClient | undefined;
function getBedrock(): BedrockRuntimeClient {
  bedrockClient ??= new BedrockRuntimeClient({ region: REGION });
  return bedrockClient;
}

let prisma: PrismaClient | undefined;
function getDb(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Golfin' Garage ERP Copilot — an AI assistant that helps employees navigate and use the entire ERP system. You have deep access to the database and can look up virtually anything.

## About Golfin' Garage
- Custom golf cart builder and dealer: new builds, refurbishments, parts sales, maintenance
- Tagline: "Unique • Bespoke • Badass"
- Target market: golf cart enthusiasts, golf courses, resorts, communities

## What You Can Help With

### Customers & Sales
- Search and view customer profiles, history, vehicles
- Look up sales opportunities, pipeline status, forecasts
- Find quotes, their status, and line items

### Inventory & Parts
- Search parts by name, SKU, or description
- Check stock levels and availability
- Find purchase orders and vendor information
- Identify low-stock or out-of-stock items

### Work Orders & Operations
- Search and view work orders and their details
- Check operation status, parts requirements, assignments
- Track blocked or overdue work

### Employees & Training
- Search employees by name, number, or skills
- Check training assignments, certifications, and compliance
- Find employees with specific skills or certifications

### Vehicles
- Search vehicles by VIN, serial number, or model
- View vehicle build status and history

### General
- Get dashboard summaries and KPIs
- Answer questions about how the system works
- Run custom queries for data not covered by other tools

## Guidelines
- Be helpful, concise, and action-oriented
- Format dollar amounts with $ and commas (e.g., $1,234.56)
- Use brief bullet points for multiple items
- Never fabricate data — always use tools to look things up
- If you can't find something, suggest what to search for instead
- Proactively offer to dig deeper (e.g., "Want me to look up the details on that work order?")
- When showing counts or summaries, offer to drill down
- Keep responses focused — answer the question, then offer next steps`;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CopilotChatRequest {
  sessionId?: string;
  message: string;
  context?: string; // page context (e.g., "inventory", "work-orders/WO-00042")
}

export interface CopilotChatResponse {
  sessionId: string;
  message: string;
  toolsUsed: string[];
}

/**
 * Process a chat message through the global copilot.
 */
export async function processCopilotChat(
  request: CopilotChatRequest,
  userId: string
): Promise<CopilotChatResponse> {
  const db = getDb();
  const toolsUsed: string[] = [];

  // 1. Get or create session (reuse AgentChatSession table)
  let sessionId = request.sessionId;
  if (sessionId) {
    await db.agentChatSession.update({
      where: { id: sessionId },
      data: { lastMessageAt: new Date() },
    });
  } else {
    const session = await db.agentChatSession.create({
      data: { userId },
    });
    sessionId = session.id;
  }

  // 2. Load conversation history
  const history = await db.agentChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, toolCalls: true },
  });

  const messages: Message[] = [];
  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls) {
        const toolData = msg.toolCalls as Array<{
          toolUseId: string;
          name: string;
          input: Record<string, unknown>;
          result: unknown;
        }>;
        const assistantContent: ContentBlock[] = [];
        const toolResults: ToolResultBlock[] = [];
        for (const tc of toolData) {
          assistantContent.push({
            toolUse: {
              toolUseId: tc.toolUseId,
              name: tc.name,
              input: tc.input as Record<string, unknown> & { length?: never },
            },
          } as ContentBlock);
          toolResults.push({
            toolUseId: tc.toolUseId,
            content: [{ text: JSON.stringify(tc.result) }],
          });
        }
        messages.push({ role: 'assistant', content: assistantContent });
        messages.push({
          role: 'user',
          content: toolResults.map((tr) => ({ toolResult: tr })),
        });
      } else {
        messages.push({ role: 'assistant', content: [{ text: msg.content }] });
      }
    }
  }

  // 3. Add user message (with optional page context)
  const userText = request.context
    ? `[Current page: ${request.context}]\n\n${request.message}`
    : request.message;
  messages.push({ role: 'user', content: [{ text: userText }] });

  await db.agentChatMessage.create({
    data: { sessionId, role: 'user', content: request.message },
  });

  // 4. Converse loop
  const bedrock = getBedrock();
  let finalText = '';
  const allToolCalls: Array<{
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
    result: unknown;
  }> = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages,
      toolConfig: TOOL_CONFIG as unknown as ToolConfiguration,
      inferenceConfig: { maxTokens: 4096, temperature: 0.3 },
    });

    const response = await bedrock.send(command);
    const stopReason = response.stopReason;
    const outputContent = response.output?.message?.content ?? [];

    messages.push({ role: 'assistant', content: outputContent });

    if (stopReason === 'tool_use') {
      const toolUseBlocks = outputContent.filter(
        (block): block is ContentBlock.ToolUseMember => 'toolUse' in block
      );

      const toolResults: ContentBlock[] = [];
      for (const block of toolUseBlocks) {
        const tu = block.toolUse as ToolUseBlock;
        const toolName = tu.name!;
        const toolInput = (tu.input ?? {}) as Record<string, unknown>;

        toolsUsed.push(toolName);
        allToolCalls.push({
          toolUseId: tu.toolUseId!,
          name: toolName,
          input: toolInput,
          result: null,
        });

        let result: unknown;
        try {
          result = await executeTool(toolName, toolInput, userId);
        } catch (err: unknown) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        allToolCalls[allToolCalls.length - 1].result = result;

        toolResults.push({
          toolResult: {
            toolUseId: tu.toolUseId!,
            content: [{ text: JSON.stringify(result) }],
          },
        });
      }

      messages.push({ role: 'user', content: toolResults });
    } else {
      for (const block of outputContent) {
        if ('text' in block && block.text) {
          finalText += block.text;
        }
      }
      break;
    }
  }

  // 5. Persist assistant response
  await db.agentChatMessage.create({
    data: {
      sessionId,
      role: 'assistant',
      content: finalText,
      toolCalls:
        allToolCalls.length > 0
          ? (allToolCalls as unknown as Prisma.InputJsonValue)
          : undefined,
    },
  });

  return { sessionId, message: finalText, toolsUsed: [...new Set(toolsUsed)] };
}
