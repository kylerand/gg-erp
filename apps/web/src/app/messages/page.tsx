'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, LoadingSkeleton, EmptyState } from '@gg-erp/ui';
import { useRole } from '@/lib/role-context';
import {
  listChannels,
  createChannel,
  listMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  listChannelTodos,
  createChannelTodo,
  updateChannelTodo,
  type Channel,
  type ChannelMessage,
  type ChannelTodo,
} from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Hash,
  Users,
  ShoppingCart,
  MessageSquare,
  Send,
  Plus,
  Check,
  Smile,
  Pencil,
  Trash2,
  Reply,
  ListTodo,
  X,
  Paperclip,
  FileIcon,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChannelTypeFilter = 'ALL' | Channel['type'];

const CHANNEL_TYPE_ICONS: Record<Channel['type'], typeof Hash> = {
  TEAM: Hash,
  WORK_ORDER: ShoppingCart,
  CUSTOMER: Users,
  DIRECT: MessageSquare,
};

const EMOJI_QUICK_PICKS = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '✅', '🙏'];

const FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx';
const MAX_FILES = 5;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { user } = useRole();
  const userId = user?.userId ?? null;

  // Channels
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelTypeFilter>('ALL');
  const [channelSearch, setChannelSearch] = useState('');
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [showCreateChannel, setShowCreateChannel] = useState(false);

  // Messages
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);

  // Threading
  const [_threadParentId, setThreadParentId] = useState<string | null>(null);
  const [_threadReplies, setThreadReplies] = useState<ChannelMessage[]>([]);

  // Editing
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Emoji picker
  const [emojiPickerMessageId, setEmojiPickerMessageId] = useState<string | null>(null);

  // Todos
  const [showTodos, setShowTodos] = useState(false);
  const [todos, setTodos] = useState<ChannelTodo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [newTodoTitle, setNewTodoTitle] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File attachments
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? null;

  // ─── Load Channels ────────────────────────────────────────────────────────

  const loadChannels = useCallback(async () => {
    try {
      const { items } = await listChannels();
      setChannels(items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load channels');
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
    const interval = setInterval(() => void loadChannels(), 15_000);
    return () => clearInterval(interval);
  }, [loadChannels]);

  // ─── Load Messages ────────────────────────────────────────────────────────

  const loadMessages = useCallback(
    async (channelId: string) => {
      setMessagesLoading(true);
      try {
        const { items } = await listMessages(channelId, { limit: 50 });
        setMessages(items.reverse()); // API returns newest first, we want oldest first
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        setMessagesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedChannelId) {
      void loadMessages(selectedChannelId);
      setThreadParentId(null);
      setThreadReplies([]);
      setShowTodos(false);
    }
  }, [selectedChannelId, loadMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll messages
  useEffect(() => {
    if (!selectedChannelId) return;
    const interval = setInterval(() => void loadMessages(selectedChannelId), 10_000);
    return () => clearInterval(interval);
  }, [selectedChannelId, loadMessages]);

  // ─── File Attachments ──────────────────────────────────────────────────────

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const totalAfterAdd = selectedFiles.length + files.length;
    if (totalAfterAdd > MAX_FILES) {
      toast.error(`You can attach up to ${MAX_FILES} files at a time`);
      e.target.value = '';
      return;
    }

    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (oversized.length > 0) {
      toast.error(
        `${oversized.map((f) => f.name).join(', ')} exceed${oversized.length === 1 ? 's' : ''} the 10 MB limit`,
      );
      e.target.value = '';
      return;
    }

    setSelectedFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // ─── Send Message ─────────────────────────────────────────────────────────

  async function handleSend() {
    if ((!composeText.trim() && selectedFiles.length === 0) || !selectedChannelId) return;
    const text = composeText;
    const _filesToUpload = [...selectedFiles];
    setComposeText('');
    setSelectedFiles([]);
    setSending(true);
    try {
      // TODO: Upload files to S3 and attach to message
      const msg = await sendMessage(selectedChannelId, { content: text });
      setMessages((prev) => [...prev, { ...msg, replyCount: 0, reactions: [] }]);
      // Update channel's unread/message count
      setChannels((prev) =>
        prev.map((c) =>
          c.id === selectedChannelId
            ? { ...c, messageCount: c.messageCount + 1, updatedAt: new Date().toISOString() }
            : c,
        ),
      );
    } catch (err) {
      setComposeText(text);
      setSelectedFiles(_filesToUpload);
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  // ─── Edit Message ─────────────────────────────────────────────────────────

  async function handleEdit(messageId: string) {
    if (!editText.trim()) return;
    try {
      const updated = await editMessage(messageId, editText);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, content: updated.content, editedAt: updated.editedAt } : m,
        ),
      );
      setEditingMessageId(null);
      setEditText('');
      toast.success('Message updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to edit');
    }
  }

  // ─── Delete Message ───────────────────────────────────────────────────────

  async function handleDelete(messageId: string) {
    const prev = messages;
    setMessages((m) => m.filter((msg) => msg.id !== messageId));
    try {
      await deleteMessage(messageId);
      toast.success('Message deleted');
    } catch (err) {
      setMessages(prev);
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  async function handleReaction(messageId: string, emoji: string) {
    const msg = messages.find((m) => m.id === messageId);
    const existingReaction = msg?.reactions.find(
      (r) => r.emoji === emoji && r.userIds.includes(userId ?? ''),
    );

    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        if (existingReaction) {
          return {
            ...m,
            reactions: m.reactions
              .map((r) =>
                r.emoji === emoji
                  ? { ...r, count: r.count - 1, userIds: r.userIds.filter((u) => u !== userId) }
                  : r,
              )
              .filter((r) => r.count > 0),
          };
        }
        const existing = m.reactions.find((r) => r.emoji === emoji);
        if (existing) {
          return {
            ...m,
            reactions: m.reactions.map((r) =>
              r.emoji === emoji
                ? { ...r, count: r.count + 1, userIds: [...r.userIds, userId ?? ''] }
                : r,
            ),
          };
        }
        return {
          ...m,
          reactions: [...m.reactions, { emoji, count: 1, userIds: [userId ?? ''] }],
        };
      }),
    );
    setEmojiPickerMessageId(null);

    try {
      if (existingReaction) {
        await removeReaction(messageId, emoji);
      } else {
        await addReaction(messageId, emoji);
      }
    } catch {
      // Reload to reconcile
      if (selectedChannelId) void loadMessages(selectedChannelId);
    }
  }

  // ─── Todos ────────────────────────────────────────────────────────────────

  async function loadTodos(channelId: string) {
    setTodosLoading(true);
    try {
      const { items } = await listChannelTodos(channelId);
      setTodos(items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load todos');
    } finally {
      setTodosLoading(false);
    }
  }

  async function handleCreateTodo() {
    if (!newTodoTitle.trim() || !selectedChannelId) return;
    try {
      const todo = await createChannelTodo(selectedChannelId, { title: newTodoTitle });
      setTodos((prev) => [todo, ...prev]);
      setNewTodoTitle('');
      toast.success('Todo added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create todo');
    }
  }

  async function handleToggleTodo(todo: ChannelTodo) {
    const newStatus = todo.status === 'OPEN' ? 'DONE' : 'OPEN';
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, status: newStatus } : t)));
    try {
      await updateChannelTodo(todo.id, { status: newStatus });
    } catch {
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, status: todo.status } : t)),
      );
    }
  }

  useEffect(() => {
    if (showTodos && selectedChannelId) {
      void loadTodos(selectedChannelId);
    }
  }, [showTodos, selectedChannelId]);

  // ─── Filter Channels ──────────────────────────────────────────────────────

  const filteredChannels = channels.filter((ch) => {
    if (channelFilter !== 'ALL' && ch.type !== channelFilter) return false;
    if (channelSearch && !ch.name.toLowerCase().includes(channelSearch.toLowerCase()))
      return false;
    return true;
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Messages"
        description={`${channels.length} channels`}
        action={
          <Button
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900"
            onClick={() => setShowCreateChannel(true)}
          >
            <Plus size={16} className="mr-1" /> New Channel
          </Button>
        }
      />

      <div className="flex flex-1 overflow-hidden border border-gray-200 rounded-lg bg-white">
        {/* ── Channel Sidebar ────────────────────────────────────────────── */}
        <div className="w-72 border-r border-gray-200 flex flex-col flex-shrink-0">
          {/* Filter tabs */}
          <div className="flex gap-1 px-3 py-2 border-b border-gray-100 overflow-x-auto">
            {(['ALL', 'TEAM', 'CUSTOMER', 'WORK_ORDER', 'DIRECT'] as ChannelTypeFilter[]).map(
              (t) => (
                <button
                  key={t}
                  onClick={() => setChannelFilter(t)}
                  className={`px-2 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                    channelFilter === t
                      ? 'bg-yellow-400 text-gray-900 font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {t === 'ALL' ? 'All' : t === 'WORK_ORDER' ? 'WO' : t.charAt(0) + t.slice(1).toLowerCase()}
                </button>
              ),
            )}
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-gray-100">
            <Input
              placeholder="Search channels…"
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          {/* Channel list */}
          <div className="flex-1 overflow-y-auto">
            {channelsLoading ? (
              <LoadingSkeleton rows={6} cols={1} />
            ) : filteredChannels.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-400">
                {channelSearch ? 'No matching channels' : 'No channels yet'}
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filteredChannels.map((ch) => {
                  const Icon = CHANNEL_TYPE_ICONS[ch.type];
                  const isSelected = ch.id === selectedChannelId;
                  return (
                    <button
                      key={ch.id}
                      onClick={() => setSelectedChannelId(ch.id)}
                      className={`w-full px-3 py-3 text-left hover:bg-gray-50 transition-colors flex items-start gap-2 ${
                        isSelected ? 'bg-yellow-50 border-l-4 border-yellow-400' : 'border-l-4 border-transparent'
                      }`}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 flex-shrink-0 mt-0.5">
                        <Icon size={14} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm text-gray-900 truncate">
                            {ch.name}
                          </span>
                          {ch.unreadCount > 0 && (
                            <span className="ml-1 bg-yellow-400 text-gray-900 text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                              {ch.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {ch.memberCount} members · {ch.messageCount} messages
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Main Content ───────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedChannel ? (
            <>
              {/* Channel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = CHANNEL_TYPE_ICONS[selectedChannel.type];
                    return <Icon size={16} className="text-gray-500" />;
                  })()}
                  <h2 className="font-semibold text-gray-900">{selectedChannel.name}</h2>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {selectedChannel.type}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowTodos(!showTodos)}
                    className={showTodos ? 'bg-yellow-50 border-yellow-300' : ''}
                  >
                    <ListTodo size={14} className="mr-1" />
                    Todos
                    {selectedChannel.todoCount > 0 && (
                      <span className="ml-1 text-xs bg-gray-200 px-1.5 rounded-full">
                        {selectedChannel.todoCount}
                      </span>
                    )}
                  </Button>
                  <span className="text-xs text-gray-400">
                    {selectedChannel.memberCount} members
                  </span>
                </div>
              </div>

              <div className="flex flex-1 overflow-hidden">
                {/* Messages area */}
                <div className="flex-1 flex flex-col min-w-0">
                  {/* Messages list */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
                    {messagesLoading ? (
                      <LoadingSkeleton rows={5} cols={1} />
                    ) : messages.length === 0 ? (
                      <EmptyState
                        icon="💬"
                        title="No messages yet"
                        description="Be the first to say something!"
                      />
                    ) : (
                      messages.map((msg) => (
                        <MessageBubble
                          key={msg.id}
                          message={msg}
                          isOwn={msg.authorId === userId}
                          isEditing={editingMessageId === msg.id}
                          editText={editText}
                          onEditTextChange={setEditText}
                          onStartEdit={() => {
                            setEditingMessageId(msg.id);
                            setEditText(msg.content);
                          }}
                          onCancelEdit={() => {
                            setEditingMessageId(null);
                            setEditText('');
                          }}
                          onSaveEdit={() => handleEdit(msg.id)}
                          onDelete={() => handleDelete(msg.id)}
                          onReply={() => {
                            setComposeText(`@reply `);
                            composeRef.current?.focus();
                          }}
                          showEmojiPicker={emojiPickerMessageId === msg.id}
                          onToggleEmojiPicker={() =>
                            setEmojiPickerMessageId(
                              emojiPickerMessageId === msg.id ? null : msg.id,
                            )
                          }
                          onReaction={(emoji) => handleReaction(msg.id, emoji)}
                        />
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Compose bar */}
                  <div className="border-t border-gray-200 px-4 py-3">
                    {/* File preview strip */}
                    {selectedFiles.length > 0 && (
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {selectedFiles.map((file, idx) => (
                          <div
                            key={`${file.name}-${idx}`}
                            className="relative group flex items-center gap-2 bg-gray-100 rounded-lg p-1.5 pr-3 border border-gray-200"
                          >
                            <button
                              onClick={() => removeFile(idx)}
                              className="absolute -top-1.5 -right-1.5 bg-gray-700 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label={`Remove ${file.name}`}
                            >
                              <X size={12} />
                            </button>
                            {isImageFile(file) ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={URL.createObjectURL(file)}
                                alt={file.name}
                                className="w-12 h-12 rounded object-cover"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center">
                                <FileIcon size={20} className="text-gray-500" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700 truncate max-w-[120px]">
                                {file.name}
                              </p>
                              <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={FILE_ACCEPT}
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="flex gap-2 items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-10 w-10 p-0 flex-shrink-0 text-gray-500 hover:text-gray-700"
                        aria-label="Attach files"
                      >
                        <Paperclip size={18} />
                      </Button>
                      <Textarea
                        ref={composeRef}
                        value={composeText}
                        onChange={(e) => setComposeText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                        placeholder={`Message #${selectedChannel.name}…`}
                        rows={1}
                        className="flex-1 min-h-[2.5rem] max-h-32 resize-none"
                      />
                      <Button
                        onClick={() => void handleSend()}
                        disabled={(!composeText.trim() && selectedFiles.length === 0) || sending}
                        className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 h-10 w-10 p-0 flex-shrink-0"
                      >
                        <Send size={16} />
                      </Button>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Press <kbd className="px-1 bg-gray-100 rounded text-gray-500">Enter</kbd>{' '}
                      to send · <kbd className="px-1 bg-gray-100 rounded text-gray-500">Shift+Enter</kbd>{' '}
                      for new line
                    </div>
                  </div>
                </div>

                {/* Todos panel — always rendered, animated via width transition */}
                <div
                  className="flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
                  style={{ width: showTodos ? 300 : 0 }}
                >
                  <div className="w-[300px] h-full flex flex-col bg-white border-l border-gray-200 shadow-[-2px_0_8px_rgba(0,0,0,0.06)]">
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
                      <h3 className="font-medium text-sm text-gray-900">Channel Todos</h3>
                      <button
                        onClick={() => setShowTodos(false)}
                        className="text-gray-400 hover:text-gray-600 rounded p-0.5 hover:bg-gray-100 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Add todo */}
                    <div className="flex gap-1 px-3 py-2 border-b border-gray-100">
                      <Input
                        placeholder="Add a todo…"
                        value={newTodoTitle}
                        onChange={(e) => setNewTodoTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleCreateTodo();
                        }}
                        className="h-8 text-sm flex-1"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCreateTodo()}
                        disabled={!newTodoTitle.trim()}
                        className="h-8 w-8 p-0"
                      >
                        <Plus size={14} />
                      </Button>
                    </div>

                    {/* Todo list — open items first, then completed */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                      {todosLoading ? (
                        <LoadingSkeleton rows={3} cols={1} />
                      ) : todos.length === 0 ? (
                        <div className="text-center text-xs text-gray-400 py-4">No todos yet</div>
                      ) : (
                        [...todos]
                          .sort((a, b) => {
                            if (a.status === b.status) return 0;
                            return a.status === 'OPEN' ? -1 : 1;
                          })
                          .map((todo) => (
                            <button
                              key={todo.id}
                              onClick={() => void handleToggleTodo(todo)}
                              className="flex items-start gap-2 w-full text-left px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
                            >
                              <span
                                className={`flex h-5 w-5 items-center justify-center rounded border flex-shrink-0 mt-0.5 transition-colors ${
                                  todo.status === 'DONE'
                                    ? 'bg-green-500 border-green-500 text-white'
                                    : 'border-gray-300 group-hover:border-gray-400'
                                }`}
                              >
                                {todo.status === 'DONE' && <Check size={12} />}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span
                                  className={`text-sm block ${
                                    todo.status === 'DONE'
                                      ? 'line-through text-gray-400'
                                      : 'text-gray-700'
                                  }`}
                                >
                                  {todo.title}
                                </span>
                                {(todo.assigneeId || todo.dueDate) && (
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {todo.assigneeId && (
                                      <span className="text-[10px] text-gray-400 font-mono">
                                        {todo.assigneeId.slice(0, 8)}
                                      </span>
                                    )}
                                    {todo.dueDate && (
                                      <span className="text-[10px] text-gray-400">
                                        {new Date(todo.dueDate).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon="💬"
                title="Select a channel"
                description="Choose a channel from the sidebar to start messaging"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Create Channel Dialog ────────────────────────────────────────── */}
      <CreateChannelDialog
        open={showCreateChannel}
        onClose={() => setShowCreateChannel(false)}
        onCreated={(ch) => {
          setChannels((prev) => [ch, ...prev]);
          setSelectedChannelId(ch.id);
          setShowCreateChannel(false);
          toast.success(`Channel #${ch.name} created`);
        }}
      />
    </div>
  );
}

// ─── Message Bubble Component ───────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChannelMessage;
  isOwn: boolean;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  showEmojiPicker: boolean;
  onToggleEmojiPicker: () => void;
  onReaction: (emoji: string) => void;
}

function MessageBubble({
  message,
  isOwn,
  isEditing,
  editText,
  onEditTextChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  showEmojiPicker,
  onToggleEmojiPicker,
  onReaction,
}: MessageBubbleProps) {
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`group flex gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 ${isOwn ? '' : ''}`}>
      {/* Avatar placeholder */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-500 mt-0.5">
        {message.authorId.slice(0, 2).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        {/* Author line */}
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm text-gray-900">
            {message.authorId.slice(0, 8)}
          </span>
          <span className="text-xs text-gray-400">{time}</span>
          {message.editedAt && (
            <span className="text-xs text-gray-400 italic">(edited)</span>
          )}
        </div>

        {/* Content */}
        {isEditing ? (
          <div className="mt-1 flex gap-2">
            <Input
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
              className="flex-1 h-8 text-sm"
              autoFocus
            />
            <Button size="sm" variant="outline" onClick={onCancelEdit} className="h-8">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onSaveEdit}
              className="h-8 bg-yellow-400 hover:bg-yellow-300 text-gray-900"
            >
              Save
            </Button>
          </div>
        ) : (
          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
            {message.content}
          </p>
        )}

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReaction(r.emoji)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs border transition-colors ${
                  r.userIds.includes(message.authorId)
                    ? 'bg-yellow-50 border-yellow-300'
                    : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                }`}
              >
                <span>{r.emoji}</span>
                <span className="text-gray-500">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Reply count */}
        {(message.replyCount ?? 0) > 0 && (
          <button className="text-xs text-blue-500 hover:underline mt-1 flex items-center gap-1">
            <Reply size={10} />
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-start gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={onToggleEmojiPicker}
          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
          title="React"
        >
          <Smile size={14} />
        </button>
        <button
          onClick={onReply}
          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
          title="Reply"
        >
          <Reply size={14} />
        </button>
        {isOwn && (
          <>
            <button
              onClick={onStartEdit}
              className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
              title="Edit"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      {/* Emoji quick picker popover */}
      {showEmojiPicker && (
        <div className="absolute right-4 mt-6 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1 z-50">
          {EMOJI_QUICK_PICKS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onReaction(emoji)}
              className="p-1.5 rounded hover:bg-gray-100 text-lg leading-none"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Channel Dialog ──────────────────────────────────────────────────

interface CreateChannelDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}

function CreateChannelDialog({ open, onClose, onCreated }: CreateChannelDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Channel['type']>('TEAM');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const channel = await createChannel({ name: name.trim(), type, description: description.trim() || undefined });
      onCreated(channel as Channel);
      setName('');
      setDescription('');
      setType('TEAM');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Channel</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Channel Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., general, front-office"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Type</label>
            <div className="flex gap-2">
              {(['TEAM', 'CUSTOMER', 'WORK_ORDER', 'DIRECT'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                    type === t
                      ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-medium'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t === 'WORK_ORDER' ? 'Work Order' : t.charAt(0) + t.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Description (optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this channel about?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={!name.trim() || creating}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900"
          >
            {creating ? 'Creating…' : 'Create Channel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
