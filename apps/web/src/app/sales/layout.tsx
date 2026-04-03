'use client';

import { useState } from 'react';
import SalesCopilotChat from '@/components/sales/SalesCopilotChat';

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      {/* Main content — shrinks when chat is open */}
      <div className={`transition-all duration-300 ${chatOpen ? 'mr-[420px]' : ''}`}>
        {children}
      </div>

      {/* Floating toggle button */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-full p-4 shadow-lg hover:shadow-xl transition-all group"
          title="Open Sales Copilot"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white" />
          <span className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Sales Copilot 🤖
          </span>
        </button>
      )}

      {/* Chat sidebar */}
      <SalesCopilotChat
        isOpen={chatOpen}
        onToggle={() => setChatOpen(false)}
      />
    </>
  );
}
