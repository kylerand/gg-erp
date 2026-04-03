/**
 * Sales AI Copilot — Core agent logic using AWS Bedrock Converse API.
 *
 * Uses Claude with tool-use (function calling) to answer sales questions,
 * look up customers/inventory, create quotes, log activities, and draft emails.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type ToolResultBlock,
  type ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime';

import { PrismaClient } from '@prisma/client';

import { TOOL_CONFIG, executeTool } from './agent-tools.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-sonnet-4-20250514-v1:0';
const REGION = process.env.AWS_REGION || 'us-east-2';
const MAX_TURNS = 10; // max tool-use round-trips per request

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

const SYSTEM_PROMPT = `You are the Golfin' Garage Sales Copilot — an AI assistant helping the sales team at a custom golf cart shop. You have access to the ERP system and can look up customers, inventory, opportunities, quotes, and pipeline data.

## About Golfin' Garage
- Custom golf cart builder and dealer specializing in bespoke builds
- Services: new builds, refurbishments, parts sales, maintenance
- Tagline: "Unique • Bespoke • Badass"
- Target market: golf cart enthusiasts, golf courses, resorts, communities

## Your Capabilities
- Search customers and view their full history (work orders, quotes, spend)
- Search parts inventory and check stock levels
- View sales opportunities and pipeline statistics
- Create draft quotes with line items and pricing
- Log sales activities (calls, emails, meetings, notes, follow-ups)
- Suggest pricing based on volume, loyalty, and margin targets
- Draft personalized follow-up emails

## Guidelines
- Be helpful, concise, and action-oriented
- When discussing pricing, always mention the margin impact
- Proactively suggest next steps (e.g., "Want me to create a quote?" or "Should I log this as a follow-up?")
- Format dollar amounts with $ and commas (e.g., $1,234.56)
- When showing multiple items, use brief bullet points
- If the user asks about something outside your tools, say so and suggest what you CAN help with
- Never fabricate data — always use the tools to look things up
- When creating quotes, confirm the details with the user before creating`;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ChatRequest {
  sessionId?: string;
  message: string;
  opportunityId?: string;
}

export interface ChatResponse {
  sessionId: string;
  message: string;
  toolsUsed: string[];
}

/**
 * Process a chat message: load history, run Bedrock Converse with tool loop, persist, return.
 */
export async function processChat(
  request: ChatRequest,
  userId: string
): Promise<ChatResponse> {
  const db = getDb();
  const toolsUsed: string[] = [];

  // 1. Get or create session
  let sessionId = request.sessionId;
  if (sessionId) {
    await db.agentChatSession.update({
      where: { id: sessionId },
      data: { lastMessageAt: new Date() },
    });
  } else {
    const session = await db.agentChatSession.create({
      data: {
        userId,
        opportunityId: request.opportunityId || null,
      },
    });
    sessionId = session.id;
  }

  // 2. Load conversation history
  const history = await db.agentChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, toolCalls: true },
  });

  // Build Bedrock message array from history
  const messages: Message[] = [];
  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls) {
        // Reconstruct tool use + result messages
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
            toolUse: { toolUseId: tc.toolUseId, name: tc.name, input: tc.input },
          });
          toolResults.push({
            toolUseId: tc.toolUseId,
            content: [{ text: JSON.stringify(tc.result) }],
          });
        }
        messages.push({ role: 'assistant', content: assistantContent });
        messages.push({ role: 'user', content: toolResults.map((tr) => ({ toolResult: tr })) });
      } else {
        messages.push({ role: 'assistant', content: [{ text: msg.content }] });
      }
    }
  }

  // 3. Add the new user message
  messages.push({ role: 'user', content: [{ text: request.message }] });

  // Persist user message
  await db.agentChatMessage.create({
    data: { sessionId, role: 'user', content: request.message },
  });

  // 4. Converse loop (tool-use may require multiple round-trips)
  const bedrock = getBedrock();
  let finalText = '';
  let allToolCalls: Array<{
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
      toolConfig: TOOL_CONFIG,
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.3,
      },
    });

    const response = await bedrock.send(command);
    const stopReason = response.stopReason;
    const outputContent = response.output?.message?.content ?? [];

    // Add assistant response to messages
    messages.push({ role: 'assistant', content: outputContent });

    if (stopReason === 'tool_use') {
      // Extract tool use blocks and execute them
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
          result: null, // filled below
        });

        let result: unknown;
        try {
          result = await executeTool(toolName, toolInput, userId);
        } catch (err: unknown) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        // Update the last tool call with its result
        allToolCalls[allToolCalls.length - 1].result = result;

        toolResults.push({
          toolResult: {
            toolUseId: tu.toolUseId!,
            content: [{ text: JSON.stringify(result) }],
          },
        });
      }

      // Feed tool results back to the model
      messages.push({ role: 'user', content: toolResults });
    } else {
      // End of conversation — extract text
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
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    },
  });

  return { sessionId, message: finalText, toolsUsed: [...new Set(toolsUsed)] };
}
