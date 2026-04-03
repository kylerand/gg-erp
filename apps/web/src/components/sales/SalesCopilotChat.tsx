'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  sendAgentChat,
  listAgentSessions,
  getAgentSession,
  type AgentChatMessage,
  type AgentChatSession,
  type AgentChatResponse,
} from '@/lib/api-client';

// ── Tool display names ──────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  search_customers: '🔍 Searched customers',
  get_customer_history: '📋 Loaded customer history',
  search_inventory: '📦 Searched inventory',
  check_stock: '📊 Checked stock levels',
  get_opportunity: '🎯 Looked up opportunity',
  get_pipeline_overview: '📊 Pulled pipeline stats',
  create_draft_quote: '📄 Created draft quote',
  log_activity: '📝 Logged activity',
  suggest_pricing: '💰 Analyzed pricing',
  draft_follow_up_email: '✉️ Drafted follow-up email',
};

// ── Quick-action suggestions ────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: '📊 Pipeline overview', prompt: 'Give me an overview of the current sales pipeline' },
  { label: '🔍 Search customers', prompt: 'Search for customers' },
  { label: '📦 Check inventory', prompt: 'What parts do we have in stock?' },
  { label: '💰 Pricing help', prompt: 'Help me with pricing for a quote' },
  { label: '✉️ Draft follow-up', prompt: 'Help me draft a follow-up email' },
];

// ── Types ───────────────────────────────────────────────────────────────────

interface Props {
  /** Pre-scoped to a specific opportunity */
  opportunityId?: string;
  /** Controls visibility */
  isOpen: boolean;
  /** Toggle callback */
  onToggle: () => void;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed: string[];
  createdAt: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SalesCopilotChat({ opportunityId, isOpen, onToggle }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Load session history
  const loadSessions = useCallback(async () => {
    try {
      const res = await listAgentSessions({ limit: 10 });
      setSessions(res.items);
    } catch {
      // Silent fail for history
    }
  }, []);

  // Resume a previous session
  const resumeSession = useCallback(async (sid: string) => {
    try {
      const data = await getAgentSession(sid);
      setSessionId(sid);
      setMessages(
        data.messages.map((m: AgentChatMessage) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolsUsed: m.toolsUsed ?? [],
          createdAt: m.createdAt,
        }))
      );
      setShowHistory(false);
    } catch {
      setError('Failed to load session');
    }
  }, []);

  // Send a message
  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;
      setError(null);

      const userMsg: DisplayMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        toolsUsed: [],
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setSending(true);

      try {
        const res: AgentChatResponse = await sendAgentChat({
          message: text.trim(),
          sessionId: sessionId ?? undefined,
          opportunityId,
        });

        if (!sessionId) setSessionId(res.sessionId);

        const assistantMsg: DisplayMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.message,
          toolsUsed: res.toolsUsed,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        setSending(false);
      }
    },
    [sending, sessionId, opportunityId]
  );

  // Start a new conversation
  const newConversation = () => {
    setSessionId(null);
    setMessages([]);
    setError(null);
    setShowHistory(false);
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-yellow-50 to-yellow-100/50">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <div>
            <h3 className="font-semibold text-sm text-gray-900">Sales Copilot</h3>
            <p className="text-[11px] text-gray-500">AI-powered sales assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              loadSessions();
              setShowHistory(!showHistory);
            }}
            className="p-1.5 hover:bg-yellow-200/50 rounded text-gray-500 hover:text-gray-700 transition-colors"
            title="Chat history"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={newConversation}
            className="p-1.5 hover:bg-yellow-200/50 rounded text-gray-500 hover:text-gray-700 transition-colors"
            title="New conversation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 hover:bg-yellow-200/50 rounded text-gray-500 hover:text-gray-700 transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session history panel */}
      {showHistory && (
        <div className="border-b border-gray-200 bg-gray-50 max-h-60 overflow-y-auto">
          <div className="px-4 py-2">
            <div className="text-xs font-medium text-gray-500 mb-2">Recent Conversations</div>
            {sessions.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No previous conversations.</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => resumeSession(s.id)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white text-xs mb-1 transition-colors"
                >
                  <div className="text-gray-800 font-medium truncate">
                    {s.lastMessage ?? 'Empty conversation'}
                  </div>
                  <div className="text-gray-400 mt-0.5">
                    {new Date(s.lastMessageAt).toLocaleString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !sending && (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">🏌️</div>
            <h4 className="font-semibold text-sm text-gray-800 mb-1">
              Hey! I&apos;m your Sales Copilot
            </h4>
            <p className="text-xs text-gray-500 mb-4">
              I can search customers, check inventory, create quotes, analyze pricing, and draft
              follow-up emails. What can I help with?
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => send(qa.prompt)}
                  className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-yellow-100 rounded-full text-gray-700 hover:text-gray-900 transition-colors"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-yellow-400 text-gray-900 rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}
            >
              {/* Tool usage badges */}
              {msg.toolsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.toolsUsed.map((tool, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center text-[10px] bg-white/60 text-gray-600 px-1.5 py-0.5 rounded-full"
                    >
                      {TOOL_LABELS[tool] ?? tool}
                    </span>
                  ))}
                </div>
              )}
              {/* Message content with basic markdown-like formatting */}
              <div className="whitespace-pre-wrap leading-relaxed text-[13px]">
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Sending indicator */}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Thinking & looking things up...</div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3 bg-white">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything about sales..."
            rows={1}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent placeholder-gray-400"
            disabled={sending}
          />
          <button
            onClick={() => send(input)}
            disabled={sending || !input.trim()}
            className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 rounded-xl p-2.5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-gray-400">Shift+Enter for new line</span>
          {sessionId && (
            <span className="text-[10px] text-gray-400">Session active</span>
          )}
        </div>
      </div>
    </div>
  );
}
