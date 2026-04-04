'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { sendCopilotChat, listCopilotSessions, type CopilotSession } from '@/lib/api-client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  timestamp: Date;
}

const TOOL_LABELS: Record<string, string> = {
  search_customers: '🔍 Customers',
  get_customer_detail: '👤 Customer Detail',
  search_inventory: '📦 Inventory',
  search_work_orders: '🔧 Work Orders',
  get_work_order_detail: '📋 WO Detail',
  search_employees: '👥 Employees',
  get_dashboard_summary: '📊 Dashboard',
  search_sales_pipeline: '💰 Sales',
  search_vehicles: '🏎️ Vehicles',
  get_training_status: '📚 Training',
  search_purchase_orders: '🛒 POs',
  run_custom_query: '🔎 Custom Query',
};

export default function GlobalCopilotChat({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await listCopilotSessions();
      setSessions(res.sessions || []);
    } catch {
      /* ignore */
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text || loading) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setLoading(true);

      try {
        const currentPage = typeof window !== 'undefined' ? window.location.pathname : '';
        const res = await sendCopilotChat({
          message: text,
          sessionId,
          context: currentPage,
        });
        setSessionId(res.sessionId);
        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.message,
          toolsUsed: res.toolsUsed,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            content: 'Sorry, something went wrong. Please try again.',
            timestamp: new Date(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId]
  );

  const handleSend = useCallback(() => {
    sendMessage(input.trim());
  }, [input, sendMessage]);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(undefined);
    setShowHistory(false);
  }, []);

  const quickActions = [
    { label: '📊 Dashboard summary', prompt: 'Give me a high-level overview of the business right now.' },
    { label: '🔧 Active work orders', prompt: 'Show me all active and in-progress work orders.' },
    { label: '📦 Low stock alerts', prompt: 'Are there any parts that are low on stock or out of stock?' },
    { label: '💰 Open opportunities', prompt: 'What does the sales pipeline look like right now?' },
    { label: '📚 Training overdue', prompt: 'Are there any overdue training assignments?' },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-yellow-400 to-amber-500">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          <div>
            <h2 className="text-sm font-bold text-gray-900">ERP Copilot</h2>
            <p className="text-xs text-gray-700">Ask me anything about the business</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              loadSessions();
              setShowHistory(!showHistory);
            }}
            className="p-1.5 rounded hover:bg-yellow-300 text-gray-800"
            title="Chat history"
          >
            📜
          </button>
          <button
            onClick={startNewChat}
            className="p-1.5 rounded hover:bg-yellow-300 text-gray-800"
            title="New chat"
          >
            ✨
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-yellow-300 text-gray-800"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Session history panel */}
      {showHistory && (
        <div className="border-b border-gray-200 bg-gray-50 max-h-48 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
            Recent Chats
          </div>
          {sessions.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">No previous chats</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSessionId(s.id);
                setShowHistory(false);
                setMessages([]);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-b border-gray-100"
            >
              <span className="text-gray-800 line-clamp-1">{s.preview || 'Chat session'}</span>
              <span className="text-gray-400">
                {new Date(s.lastMessageAt).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 text-center mt-4">
              👋 How can I help you today?
            </p>
            <div className="space-y-2">
              {quickActions.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => sendMessage(qa.prompt)}
                  className="w-full text-left px-3 py-2 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-yellow-300 transition"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-yellow-400 text-gray-900'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {msg.toolsUsed.map((t) => (
                    <span
                      key={t}
                      className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-white/60 text-gray-600"
                    >
                      {TOOL_LABELS[t] || t}
                    </span>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-500">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 px-3 py-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about customers, inventory, work orders..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-yellow-400 text-gray-900 rounded-lg text-sm font-medium hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
