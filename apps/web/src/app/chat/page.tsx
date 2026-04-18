'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ProcessConversationCard, {
  ActionButton,
  ProcessCard,
} from '../components/ProcessConversationCard';
import { apiClient } from '../lib/api-client';
import { shouldPollChatSession } from '../lib/chat-process-polling';
import { sortChatSessions } from '../lib/chat-session-list';
import { getClientSessionToken, hasClientSession } from '../lib/client-auth';
import { withBrowserApiBase } from '../lib/browser-api-base-url';

const QUICK_ACTIONS = [
  { label: '报销差旅费', icon: 'fa-money-bill-wave', color: 'text-sky-700 bg-sky-100', message: '我要报销差旅费' },
  { label: '请假申请', icon: 'fa-calendar-alt', color: 'text-emerald-700 bg-emerald-100', message: '我要请假三天' },
  { label: '采购申请', icon: 'fa-shopping-cart', color: 'text-amber-700 bg-amber-100', message: '我要采购办公用品' },
  { label: '查看进度', icon: 'fa-chart-bar', color: 'text-slate-700 bg-slate-100', message: '查看我的申请进度' },
];

const CHAT_REQUEST_TIMEOUT_MS = 90000;

interface ChatAttachment {
  attachmentId: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fieldKey?: string | null;
  bindScope?: 'field' | 'general';
  previewStatus?: string;
  canPreview?: boolean;
  previewUrl?: string;
  downloadUrl?: string;
}

interface SessionState {
  hasActiveProcess: boolean;
  processInstanceId?: string;
  processCode?: string;
  processName?: string;
  processCategory?: string | null;
  processStatus?: string;
  stage?: ProcessCard['stage'];
  reworkHint?: ProcessCard['reworkHint'];
  reworkReason?: string | null;
  isTerminal?: boolean;
  activeProcessCard?: ProcessCard | null;
}

interface AuthChallenge {
  connectorId: string;
  connectorName?: string;
  provider: string;
  startUrl: string;
  statusUrl: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  messageKind?: 'text' | 'process_card';
  actionButtons?: ActionButton[];
  formData?: Record<string, any>;
  processStatus?: string;
  needsAttachment?: boolean;
  attachments?: ChatAttachment[];
  authChallenge?: AuthChallenge;
  missingFields?: Array<{
    key: string;
    label: string;
    question: string;
    type?: string;
    description?: string;
    example?: string;
    multiple?: boolean;
  }>;
  processCard?: ProcessCard;
}

interface ChatSession {
  id: string;
  title: string;
  lastMessage: string;
  messageCount: number;
  timestamp: string;
  status: string;
  archivedAt?: string | null;
  archivedSource?: string | null;
  restorableUntil?: string | null;
  hasActiveProcess?: boolean;
  processName?: string | null;
  processStatus?: string | null;
  processStatusText?: string | null;
  processStage?: ProcessCard['stage'] | null;
  reworkHint?: ProcessCard['reworkHint'] | null;
  hasBusinessRecord?: boolean;
  canRestoreConversation?: boolean;
}

interface ChatSidebarProps {
  currentSessionId: string | null;
  deletingSessionId: string | null;
  sessions: ChatSession[];
  showHistory: boolean;
  onCreateNewChat: () => void;
  onDeleteRequest: (session: ChatSession) => void;
  onQuickAction: (message: string) => void;
  onSelectSession: (sessionId: string) => void;
  onShowHistoryChange: (show: boolean) => void;
  onAction?: () => void;
}

function formatRelativeTime(date: string) {
  const now = new Date();
  const target = new Date(date);
  const diff = now.getTime() - target.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return target.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function getSessionBadge(session: ChatSession) {
  const resolvedStatusText = session.processStatusText?.trim();

  if (session.processStage === 'rework') {
    return {
      label: resolvedStatusText || '驳回待处理',
      className: 'bg-amber-100 text-amber-800',
    };
  }

  if (session.hasActiveProcess) {
    if (session.processStatus === 'auth_required') {
      return { label: resolvedStatusText || '待授权', className: 'bg-amber-100 text-amber-800' };
    }
    if (session.processStage === 'confirming') {
      return { label: resolvedStatusText || '待确认', className: 'bg-amber-100 text-amber-800' };
    }
    if (session.processStage === 'collecting') {
      return { label: resolvedStatusText || '待补充', className: 'bg-sky-100 text-sky-700' };
    }
    if (session.processStage === 'executing') {
      return { label: resolvedStatusText || '提交执行中', className: 'bg-indigo-100 text-indigo-700' };
    }
    return {
      label: resolvedStatusText || '继续办理',
      className: 'bg-sky-100 text-sky-700',
    };
  }

  switch (session.processStage) {
    case 'draft':
      return { label: resolvedStatusText || '已保存待发', className: 'bg-amber-100 text-amber-800' };
    case 'submitted':
      return { label: resolvedStatusText || '审批中', className: 'bg-indigo-100 text-indigo-700' };
    case 'completed':
      return { label: resolvedStatusText || '已完成', className: 'bg-emerald-100 text-emerald-700' };
    case 'failed':
      return { label: resolvedStatusText || '失败', className: 'bg-rose-100 text-rose-700' };
    case 'cancelled':
      return { label: resolvedStatusText || '已取消', className: 'bg-slate-100 text-slate-600' };
    case 'executing':
      return { label: resolvedStatusText || '提交执行中', className: 'bg-indigo-100 text-indigo-700' };
    default:
      return null;
  }
}

function getActionMarker(action: string) {
  const actionMap: Record<string, string> = {
    confirm: '__ACTION_CONFIRM__',
    cancel: '__ACTION_CANCEL__',
    modify: '__ACTION_MODIFY__',
  };
  return actionMap[action] || action;
}

function ChatSidebar({
  currentSessionId,
  deletingSessionId,
  sessions,
  showHistory,
  onCreateNewChat,
  onDeleteRequest,
  onQuickAction,
  onSelectSession,
  onShowHistoryChange,
  onAction,
}: ChatSidebarProps) {
  return (
    <>
      <div className="p-4">
        <button
          onClick={() => {
            onCreateNewChat();
            onAction?.();
          }}
          className="w-full rounded-2xl bg-sky-600 py-3 text-sm font-medium text-white transition-colors hover:bg-sky-700"
        >
          <i className="fas fa-plus mr-2 text-xs"></i>
          新建对话
        </button>
      </div>

      <div className="border-b border-slate-200 px-4">
        <button
          onClick={() => onShowHistoryChange(true)}
          className={`mr-6 border-b-2 py-3 text-sm font-medium transition-colors ${
            showHistory ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          历史对话
        </button>
        <button
          onClick={() => onShowHistoryChange(false)}
          className={`border-b-2 py-3 text-sm font-medium transition-colors ${
            !showHistory ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          快捷入口
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showHistory ? (
          <div className="space-y-2 p-3">
            {sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                暂无历史对话
              </div>
            ) : (
              sessions.map((session) => {
                const badge = getSessionBadge(session);
                return (
                  <div
                    key={session.id}
                    className={`w-full rounded-2xl border px-4 py-3 transition-all ${
                      currentSessionId === session.id
                        ? 'border-sky-200 bg-sky-50 shadow-sm'
                        : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectSession(session.id);
                        onAction?.();
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {session.title || '新对话'}
                          </div>
                          <div className="mt-1 truncate text-xs text-slate-500">
                            {session.processName || session.lastMessage || '暂无摘要'}
                          </div>
                        </div>
                        {badge ? (
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${badge.className}`}>
                            {badge.label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                        <span>{session.messageCount} 条消息</span>
                        <div className="flex items-center gap-3">
                          <span>{formatRelativeTime(session.timestamp)}</span>
                        </div>
                      </div>
                    </button>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteRequest(session);
                        }}
                        disabled={deletingSessionId === session.id}
                        className="rounded-full px-2 py-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title={session.hasBusinessRecord ? '从历史中移除，可在我的申请中恢复' : '永久删除'}
                      >
                        <i className="fas fa-trash text-[11px]"></i>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              快捷办理
            </div>
            <div className="space-y-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => {
                    onQuickAction(action.message);
                    onAction?.();
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${action.color}`}>
                      <i className={`fas ${action.icon} text-sm`}></i>
                    </div>
                    <div className="text-sm font-medium text-slate-900">{action.label}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 px-4 py-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {['发起申请', '继续办理', '查进度', '撤回', '催办'].map((intent) => (
            <span
              key={intent}
              className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700"
            >
              {intent}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const flowCode = searchParams.get('flow');
  const requestedSessionId = searchParams.get('sessionId');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadTargetFieldKey, setUploadTargetFieldKey] = useState<string | null>(null);
  const [authorizingMessageId, setAuthorizingMessageId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const flowBootstrappedRef = useRef<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteConfirmSession, setDeleteConfirmSession] = useState<ChatSession | null>(null);

  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return true;
    }

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceToBottom <= 120;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  const syncScrollState = useCallback(() => {
    const nearBottom = isNearBottom();
    shouldAutoScrollRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }, [isNearBottom]);

  useEffect(() => {
    if (showHistory) {
      return;
    }

    if (!shouldAutoScrollRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom(messages.length <= 1 ? 'auto' : 'smooth');
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [loading, messages, scrollToBottom, showHistory]);

  const ensureSession = useCallback(() => {
    if (hasClientSession()) {
      return true;
    }

    router.replace('/login');
    return false;
  }, [router]);

  const loadSessions = useCallback(async () => {
    try {
      if (!ensureSession()) {
        return;
      }

      const response = await apiClient.get('/assistant/sessions');
      setSessions(sortChatSessions(Array.isArray(response.data) ? response.data : []));
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, [ensureSession]);

  const loadSession = useCallback(async (
    id: string,
    options?: { source?: 'manual' | 'poll' },
  ) => {
    try {
      const response = await apiClient.get(`/assistant/sessions/${id}/messages`);
      const data = response.data || {};
      const isPassiveRefresh = options?.source === 'poll';
      if (!isPassiveRefresh) {
        shouldAutoScrollRef.current = true;
        setShowScrollToBottom(false);
      }
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setSessionId(id);
      setSessionState(data.session?.sessionState || null);
      if (!isPassiveRefresh) {
        setSidebarOpen(false);
        setShowHistory(true);
        setUploadError('');
        setAuthorizingMessageId(null);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  }, []);

  const sendMessage = useCallback(async (
    text?: string,
    options?: { displayText?: string; silent?: boolean },
  ) => {
    const messageText = text || input.trim();
    if (!messageText && pendingFiles.length === 0) {
      return;
    }

    if (!options?.silent) {
      const createdAt = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: options?.displayText || messageText || `[已上传 ${pendingFiles.length} 个文件]`,
        createdAt,
        attachments: pendingFiles.length > 0 ? pendingFiles : undefined,
      };

      setMessages((prev) => [...prev, userMessage]);
    }
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
    setInput('');
    setUploadError('');
    const filesToSend = [...pendingFiles];
    setPendingFiles([]);
    setLoading(true);

    try {
      if (!ensureSession()) {
        setLoading(false);
        return;
      }
      const response = await apiClient.post(
        '/assistant/chat',
        {
          sessionId,
          message: messageText || '已上传文件',
          attachments: filesToSend.length > 0 ? filesToSend : undefined,
        },
        {
          // Chat turns can include LLM reasoning and server-side orchestration,
          // so they need a higher timeout than ordinary CRUD endpoints.
          timeout: CHAT_REQUEST_TIMEOUT_MS,
        },
      );

      const data = response.data || {};
      setSessionId(data.sessionId || null);
      setSessionState(data.sessionState || null);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: typeof data.message === 'string' ? data.message : '',
        createdAt: new Date().toISOString(),
        messageKind: data.processCard ? 'process_card' : 'text',
        actionButtons: data.actionButtons,
        formData: data.formData,
        processStatus: data.processStatus,
        needsAttachment: data.needsAttachment,
        authChallenge: data.authChallenge,
        missingFields: data.missingFields,
        processCard: data.processCard,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      void loadSessions();
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: '抱歉，服务暂时不可用，请稍后重试。',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [ensureSession, input, loadSessions, pendingFiles, sessionId]);

  useEffect(() => {
    if (!hasClientSession()) {
      router.replace('/login');
      return;
    }

    setAuthReady(true);
  }, [router]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    void loadSessions();
  }, [authReady, loadSessions]);

  useEffect(() => {
    if (!authReady || !requestedSessionId) {
      return;
    }
    if (sessionId === requestedSessionId) {
      return;
    }

    void loadSession(requestedSessionId, { source: 'manual' });
  }, [authReady, loadSession, requestedSessionId, sessionId]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    if (!flowCode) {
      return;
    }
    if (flowBootstrappedRef.current === flowCode) {
      return;
    }
    if (sessionId || messages.length > 0 || loading) {
      return;
    }

    flowBootstrappedRef.current = flowCode;
    void (async () => {
      try {
        if (!ensureSession()) {
          return;
        }
        const response = await apiClient.get(`/process-library/${encodeURIComponent(flowCode)}`);
        const processName = response.data?.processName || flowCode;
        setShowHistory(false);
        await sendMessage(`我要办理${processName}`);
      } catch {
        setShowHistory(false);
        await sendMessage(`我要办理${flowCode}`);
      }
    })();
  }, [authReady, ensureSession, flowCode, loading, messages.length, sendMessage, sessionId]);

  useEffect(() => {
    if (!authReady || !sessionId || !shouldPollChatSession(sessionState, messages)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadSession(sessionId, { source: 'poll' });
      void loadSessions();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authReady, loadSession, loadSessions, messages, sessionId, sessionState]);

  const clearConversationState = useCallback((options?: { keepHistoryView?: boolean }) => {
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
    setMessages([]);
    setInput('');
    setSessionId(null);
    setSessionState(null);
    setPendingFiles([]);
    setUploadError('');
    setUploadTargetFieldKey(null);
    setAuthorizingMessageId(null);
    setDeleteConfirmSession(null);
    if (!options?.keepHistoryView) {
      setShowHistory(false);
    }
    if (flowCode) {
      flowBootstrappedRef.current = flowCode;
    }
  }, [flowCode]);

  const createNewChat = useCallback(() => {
    clearConversationState();
  }, [clearConversationState]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setUploading(true);
    setUploadError('');

    try {
      if (!ensureSession()) {
        setUploading(false);
        return;
      }
      const formData = new FormData();
      for (let index = 0; index < files.length; index += 1) {
        formData.append('files', files[index]);
      }
      const query = new URLSearchParams();
      if (sessionId) {
        query.set('sessionId', sessionId);
      }
      if (uploadTargetFieldKey) {
        query.set('fieldKey', uploadTargetFieldKey);
        query.set('bindScope', 'field');
      } else {
        query.set('bindScope', 'general');
      }
      const response = await apiClient.post(`/attachments/upload?${query.toString()}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPendingFiles((prev) => [...prev, ...(Array.isArray(response.data) ? response.data : [])]);
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || '文件上传失败';
      setUploadError(typeof message === 'string' ? message : JSON.stringify(message));
    } finally {
      setUploading(false);
      setUploadTargetFieldKey(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removePendingFile = (fileId: string) => {
    setPendingFiles((prev) => prev.filter((file) => file.fileId !== fileId));
  };

  const openFilePicker = (fieldKey?: string) => {
    setUploadTargetFieldKey(fieldKey || null);
    fileInputRef.current?.click();
  };

  const resolveFieldLabel = (fieldKey?: string | null) => {
    if (!fieldKey) {
      return '通用材料';
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const found = message.missingFields?.find((field) => field.key === fieldKey);
      if (found) {
        return found.label;
      }
    }

    return fieldKey;
  };

  const handleAuthorize = (messageId: string, challenge?: AuthChallenge) => {
    if (!challenge) {
      return;
    }

    const sessionToken = getClientSessionToken();
    if (!sessionToken) {
      router.replace('/login');
      return;
    }

    const popupUrl = new URL(withBrowserApiBase(challenge.startUrl));
    popupUrl.searchParams.set('token', sessionToken);

    setUploadError('');
    setAuthorizingMessageId(messageId);

    const popup = window.open(
      popupUrl.toString(),
      `delegated-auth-${challenge.connectorId}`,
      'popup=yes,width=640,height=760',
    );
    if (!popup) {
      setAuthorizingMessageId(null);
      setUploadError('授权窗口被浏览器拦截，请允许弹窗后重试。');
      return;
    }

    let settled = false;
    const pollTimer = { current: undefined as number | undefined };

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimer.current !== undefined) {
        window.clearInterval(pollTimer.current);
      }
      window.removeEventListener('message', onMessage);
      setAuthorizingMessageId((current) => (current === messageId ? null : current));
    };

    const finishAuthorized = () => {
      cleanup();
      void sendMessage('__ACTION_AUTHORIZED__', { silent: true });
    };

    const finishWithError = (message: string) => {
      cleanup();
      setUploadError(message);
    };

    const pollStatus = async () => {
      try {
        const statusUrl = /^https?:\/\//i.test(challenge.statusUrl)
          ? challenge.statusUrl
          : challenge.statusUrl.replace(/^\/api\/v1/, '');
        const response = await apiClient.get(statusUrl);
        const status = response.data?.status;
        if (status === 'bound') {
          finishAuthorized();
          return;
        }
        if (status === 'failed' || status === 'expired') {
          finishWithError(response.data?.errorMessage || '授权未完成，请重试。');
          return;
        }
        if (popup.closed) {
          cleanup();
        }
      } catch {
        if (popup.closed) {
          cleanup();
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      const data = (event.data && typeof event.data === 'object')
        ? event.data as Record<string, any>
        : null;
      if (!data || data.type !== 'delegated-auth-result') {
        return;
      }
      if (data.connectorId !== challenge.connectorId) {
        return;
      }
      if (data.success) {
        void pollStatus();
        return;
      }
      finishWithError(typeof data.message === 'string' ? data.message : '授权失败，请重试。');
    };

    window.addEventListener('message', onMessage);
    pollTimer.current = window.setInterval(() => {
      void pollStatus();
    }, 1500);
  };

  const handleActionButton = (messageId: string, action: string) => {
    const sourceMessage = messages.find((message) => message.id === messageId);
    const actionLabel = sourceMessage?.actionButtons?.find((button) => button.action === action)?.label || action;

    if (action === 'authorize') {
      handleAuthorize(messageId, sourceMessage?.authChallenge);
      return;
    }

    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        return {
          ...message,
          actionButtons: undefined,
          processCard: message.processCard
            ? {
              ...message.processCard,
              actionState: 'readonly',
            }
            : undefined,
        };
      }),
    );

    void sendMessage(getActionMarker(action), { displayText: actionLabel });
  };

  const handleResetSession = async () => {
    if (!sessionId) {
      return;
    }

    try {
      await apiClient.post(`/assistant/sessions/${sessionId}/reset`);
      await loadSession(sessionId, { source: 'manual' });
    } catch (error) {
      console.error('Failed to reset session:', error);
    }
  };

  const handleRequestDeleteSession = useCallback((targetSession: ChatSession) => {
    setDeleteConfirmSession(targetSession);
  }, []);

  const handleDeleteSession = useCallback(async () => {
    if (!deleteConfirmSession) {
      return;
    }

    const targetSession = deleteConfirmSession;
    setDeletingSessionId(targetSession.id);
    try {
      const mode = targetSession.hasBusinessRecord ? 'archive' : 'purge';
      await apiClient.delete(`/assistant/sessions/${targetSession.id}`, {
        params: { mode },
      });

      if (sessionId === targetSession.id) {
        clearConversationState({ keepHistoryView: true });
      }
      setDeleteConfirmSession(null);
      await loadSessions();
    } catch (error) {
      console.error('Failed to delete session:', error);
    } finally {
      setDeletingSessionId(null);
    }
  }, [clearConversationState, deleteConfirmSession, loadSessions, sessionId]);

  if (!authReady) {
    return (
      <div className="flex h-full items-center justify-center bg-[linear-gradient(180deg,#f7fbff_0%,#f5f7fb_100%)] px-6 text-sm text-slate-500">
        正在验证登录状态...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[linear-gradient(180deg,#f7fbff_0%,#f5f7fb_100%)]">
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-950/35 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-80 flex-col border-r border-slate-200 bg-white transition-transform duration-300 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 lg:hidden">
          <div className="text-base font-semibold text-slate-900">工作台菜单</div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <ChatSidebar
          currentSessionId={sessionId}
          deletingSessionId={deletingSessionId}
          sessions={sessions}
          showHistory={showHistory}
          onCreateNewChat={createNewChat}
          onDeleteRequest={handleRequestDeleteSession}
          onQuickAction={(message) => {
            void sendMessage(message);
          }}
          onSelectSession={(nextSessionId) => {
            void loadSession(nextSessionId, { source: 'manual' });
          }}
          onShowHistoryChange={setShowHistory}
          onAction={() => setSidebarOpen(false)}
        />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="px-4 pt-4 lg:hidden">
          <div className="mx-auto flex max-w-5xl">
            <button
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
            >
              <i className="fas fa-bars text-xs"></i>
              菜单
            </button>
          </div>
        </div>

        {sessionState?.hasActiveProcess && sessionState.activeProcessCard ? (
          <div className="border-b border-sky-200 bg-sky-50/90 px-4 py-3">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-sky-900">
                  正在继续办理：{sessionState.processName}
                </div>
                <div className="mt-1 text-xs text-sky-700">
                  当前状态：{sessionState.activeProcessCard.statusText}
                  {sessionState.processCategory ? ` · ${sessionState.processCategory}` : ''}
                </div>
                {sessionState.activeProcessCard.reworkReason ? (
                  <div className="mt-1 text-xs text-sky-700/90">
                    驳回原因：{sessionState.activeProcessCard.reworkReason}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-sky-700 shadow-sm">
                  继续办理
                </span>
                <button
                  onClick={() => void handleResetSession()}
                  className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100"
                >
                  重置上下文
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="relative flex-1 min-h-0">
          <div
            ref={messagesContainerRef}
            onScroll={syncScrollState}
            className="h-full min-h-0 overflow-y-auto"
          >
            <div className="mx-auto flex min-h-full max-w-5xl flex-col px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-sky-100 text-sky-700">
                  <i className="fas fa-file-signature text-2xl"></i>
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">开始一段新的 OA 办理对话</h2>
                <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500">
                  直接告诉我您想办理什么，我会按正式单据的方式为您补全信息、确认表单并提交。
                </p>

                <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => void sendMessage(action.message)}
                      className="rounded-3xl border border-slate-200 bg-white px-5 py-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md"
                    >
                      <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-2xl ${action.color}`}>
                        <i className={`fas ${action.icon} text-base`}></i>
                      </div>
                      <div className="text-base font-semibold text-slate-900">{action.label}</div>
                      <div className="mt-1 text-sm text-slate-500">{action.message}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <div key={message.id}>
                    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {message.role === 'assistant' ? (
                        <div className="mr-3 mt-1 flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-sm">
                          <i className="fas fa-robot text-xs"></i>
                        </div>
                      ) : null}

                      <div className={`${message.role === 'user' ? 'max-w-[78%]' : 'max-w-[88%]'} min-w-0`}>
                        <div
                          className={`rounded-3xl px-4 py-3 text-sm leading-7 shadow-sm ${
                            message.role === 'user'
                              ? 'bg-sky-600 text-white'
                              : 'border border-slate-200 bg-white text-slate-800'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>

                          {message.attachments && message.attachments.length > 0 ? (
                            <div className={`mt-3 flex flex-wrap gap-2 border-t pt-3 ${
                              message.role === 'user' ? 'border-white/20' : 'border-slate-200'
                            }`}>
                              {message.attachments.map((attachment) => (
                                <div
                                  key={attachment.fileId}
                                  className={`inline-flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-xs ${
                                    message.role === 'user'
                                      ? 'bg-white/20 text-white'
                                      : 'border border-slate-200 bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  <i className="fas fa-paperclip text-[10px]"></i>
                                  <span className="max-w-[180px] truncate">{attachment.fileName}</span>
                                  {attachment.previewUrl ? (
                                    <a
                                      href={attachment.previewUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`rounded-full px-2 py-1 ${
                                        message.role === 'user'
                                          ? 'bg-white/20 text-white'
                                          : 'bg-white text-slate-700 hover:bg-sky-100 hover:text-sky-700'
                                      }`}
                                    >
                                      预览
                                    </a>
                                  ) : null}
                                  {attachment.downloadUrl ? (
                                    <a
                                      href={attachment.downloadUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`rounded-full px-2 py-1 ${
                                        message.role === 'user'
                                          ? 'bg-white/20 text-white'
                                          : 'bg-white text-slate-700 hover:bg-slate-200'
                                      }`}
                                    >
                                      下载
                                    </a>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        {message.role === 'assistant' && message.processCard ? (
                          <div className="mt-3">
                            <ProcessConversationCard
                              card={message.processCard}
                              actionButtons={message.actionButtons}
                              onAction={(action) => handleActionButton(message.id, action)}
                              onUploadField={(fieldKey) => openFilePicker(fieldKey)}
                              disabled={loading || authorizingMessageId === message.id}
                            />
                          </div>
                        ) : null}

                        {message.role === 'assistant' && message.needsAttachment && !message.processCard ? (
                          <div className="mt-3">
                            {message.missingFields?.filter((field) => field.type === 'file').length ? (
                              <div className="flex flex-wrap gap-2">
                                {message.missingFields
                                  ?.filter((field) => field.type === 'file')
                                  .map((field) => (
                                    <button
                                      key={field.key}
                                      onClick={() => openFilePicker(field.key)}
                                      disabled={loading || uploading}
                                      className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                                    >
                                      <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'} mr-2`}></i>
                                      上传{field.label}
                                    </button>
                                  ))}
                              </div>
                            ) : (
                              <button
                                onClick={() => openFilePicker()}
                                disabled={loading || uploading}
                                className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                              >
                                <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'} mr-2`}></i>
                                上传附件
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loading ? (
              <div className="mt-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-600 text-white">
                  <i className="fas fa-robot text-xs"></i>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                  <span className="mr-2 inline-flex gap-1 align-middle">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400"></span>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" style={{ animationDelay: '0.15s' }}></span>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" style={{ animationDelay: '0.3s' }}></span>
                  </span>
                  正在处理您的单据...
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>
          </div>
          {showScrollToBottom && !loading && messages.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                shouldAutoScrollRef.current = true;
                setShowScrollToBottom(false);
                scrollToBottom('smooth');
              }}
              className="absolute bottom-5 right-5 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-medium text-sky-700 shadow-sm transition-colors hover:bg-sky-50"
            >
              回到底部
            </button>
          ) : null}
        </div>

        <div className="border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="mx-auto max-w-5xl">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.zip,.rar,.7z,.mp3,.wav,.ogg,.mp4,.webm"
              onChange={handleFileUpload}
            />

            {uploadError ? (
              <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {uploadError}
              </div>
            ) : null}

            {pendingFiles.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {pendingFiles.map((file) => (
                  <div
                    key={file.fileId}
                    className="flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-700"
                  >
                    <i className="fas fa-paperclip text-[10px]"></i>
                    <span className="max-w-[180px] truncate">{file.fileName}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-sky-700">
                      {resolveFieldLabel(file.fieldKey)}
                    </span>
                    <button
                      onClick={() => removePendingFile(file.fileId)}
                      className="text-sky-400 transition-colors hover:text-rose-500"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-3">
              <button
                onClick={() => openFilePicker()}
                disabled={loading || uploading}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50"
                title="上传附件"
              >
                <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-paperclip'}`}></i>
              </button>

              <div className="flex-1 rounded-[1.75rem] border border-slate-200 bg-slate-50 px-4 py-3 shadow-inner">
                <textarea
                  rows={1}
                  className="max-h-40 min-h-[24px] w-full resize-none border-0 bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="请输入您的办理需求，或继续补充当前单据信息..."
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  disabled={loading}
                />
              </div>

              <button
                onClick={() => void sendMessage()}
                disabled={loading || (!input.trim() && pendingFiles.length === 0)}
                className="rounded-2xl bg-sky-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i className="fas fa-paper-plane mr-2 text-xs"></i>
                发送
              </button>
            </div>
          </div>
        </div>
      </main>

      {deleteConfirmSession ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4"
          onClick={() => {
            if (!deletingSessionId) {
              setDeleteConfirmSession(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-900">确认删除这条对话？</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {deleteConfirmSession.hasBusinessRecord
                  ? '删除后，这条对话会从左侧历史中移除，但不会删除对应的业务记录。后续仍可在“我的申请”中恢复。'
                  : '删除后，这条对话会被永久删除，且无法恢复。'}
              </p>
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="font-medium text-slate-900">{deleteConfirmSession.title || '新对话'}</div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {deleteConfirmSession.processName || deleteConfirmSession.lastMessage || '暂无摘要'}
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setDeleteConfirmSession(null)}
                disabled={Boolean(deletingSessionId)}
                className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSession()}
                disabled={deletingSessionId === deleteConfirmSession.id}
                className="flex-1 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingSessionId === deleteConfirmSession.id ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
