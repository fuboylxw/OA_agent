'use client';

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const QUICK_ACTIONS = [
  { label: '报销差旅费', icon: 'fa-money-bill-wave', color: 'text-blue-600 bg-blue-100', message: '我要报销差旅费' },
  { label: '请假申请', icon: 'fa-calendar-alt', color: 'text-green-600 bg-green-100', message: '我要请假三天' },
  { label: '采购申请', icon: 'fa-shopping-cart', color: 'text-purple-600 bg-purple-100', message: '我要采购办公用品' },
  { label: '查看进度', icon: 'fa-chart-bar', color: 'text-orange-600 bg-orange-100', message: '查看我的申请进度' },
];

interface ChatSession {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: Date;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const userId = localStorage.getItem('userId') || 'default-user';
      const response = await axios.get(`${API_URL}/api/v1/assistant/sessions`, {
        params: { userId },
      });
      setSessions(response.data || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const loadSession = async (id: string) => {
    try {
      const response = await axios.get(`${API_URL}/api/v1/assistant/sessions/${id}/messages`);
      setMessages(response.data || []);
      setSessionId(id);
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const createNewChat = () => {
    setMessages([]);
    setSessionId(null);
    setShowHistory(false);
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg) return;

    const userMessage = { role: 'user', content: msg };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/v1/assistant/chat`, {
        sessionId,
        message: msg,
        userId: localStorage.getItem('userId') || 'default-user',
      });

      const data = response.data;
      setSessionId(data.sessionId);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.message }]);

      // Reload sessions to update history
      loadSessions();
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '抱歉，服务暂时不可用，请稍后重试。' }]);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return new Date(date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  return (
    <div className="h-full flex">
      {/* Mobile Drawer Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile Drawer Panel */}
      <div
        className={`fixed inset-y-0 left-0 w-72 bg-white z-50 lg:hidden flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Close Button */}
        <div className="p-4 flex items-center justify-between border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">菜单</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <i className="fas fa-times text-gray-500"></i>
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-4 flex-shrink-0">
          <button
            onClick={() => {
              createNewChat();
              setSidebarOpen(false);
            }}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <i className="fas fa-plus"></i>
            新建对话
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-gray-200 px-4">
          <button
            onClick={() => setShowHistory(false)}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              !showHistory
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            快捷操作
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              showHistory
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            历史对话
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          {!showHistory ? (
            // Quick Actions
            <div className="p-4">
              <div className="space-y-1.5">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => {
                      sendMessage(action.message);
                      setSidebarOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all flex items-center gap-2.5"
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center ${action.color}`}>
                      <i className={`fas ${action.icon} text-xs`}></i>
                    </div>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // History Sessions
            <div className="p-2">
              {sessions.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <i className="fas fa-history text-gray-300 text-2xl mb-2"></i>
                  <p className="text-sm text-gray-500">暂无历史对话</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => {
                        loadSession(session.id);
                        setSidebarOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-all group ${
                        sessionId === session.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <i className="fas fa-comment-dots text-gray-400 text-xs mt-1 flex-shrink-0"></i>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {session.title || '新对话'}
                          </p>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {session.lastMessage}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatTime(session.timestamp)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Info */}
        <div className="p-4 border-t border-gray-200 flex-shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {['发起申请', '查进度', '撤回', '催办'].map((intent) => (
              <span key={intent} className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">
                {intent}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex-shrink-0 hidden lg:flex flex-col">
        <div className="p-4 flex-shrink-0">
          <button
            onClick={createNewChat}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <i className="fas fa-plus"></i>
            新建对话
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-gray-200 px-4">
          <button
            onClick={() => setShowHistory(false)}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              !showHistory
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            快捷操作
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              showHistory
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            历史对话
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          {!showHistory ? (
            // Quick Actions
            <div className="p-4">
              <div className="space-y-1.5">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.message)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all flex items-center gap-2.5"
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center ${action.color}`}>
                      <i className={`fas ${action.icon} text-xs`}></i>
                    </div>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // History Sessions
            <div className="p-2">
              {sessions.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <i className="fas fa-history text-gray-300 text-2xl mb-2"></i>
                  <p className="text-sm text-gray-500">暂无历史对话</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => loadSession(session.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-all group ${
                        sessionId === session.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <i className="fas fa-comment-dots text-gray-400 text-xs mt-1 flex-shrink-0"></i>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {session.title || '新对话'}
                          </p>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {session.lastMessage}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatTime(session.timestamp)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Info */}
        <div className="p-4 border-t border-gray-200 flex-shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {['发起申请', '查进度', '撤回', '催办'].map((intent) => (
              <span key={intent} className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">
                {intent}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header */}
        <div className="border-b border-gray-200 px-4 py-3 flex-shrink-0 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors lg:hidden"
              >
                <i className="fas fa-bars text-gray-600 text-sm"></i>
              </button>
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
                <i className="fas fa-robot text-white text-sm"></i>
              </div>
              <div>
                <h1 className="text-base font-semibold text-gray-900">智能助手</h1>
                <p className="text-xs text-gray-500">告诉我您想办理什么，我来帮您完成</p>
              </div>
            </div>
            {sessionId && (
              <button
                onClick={createNewChat}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5"
              >
                <i className="fas fa-plus text-xs"></i>
                新对话
              </button>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-3xl mx-auto px-4 py-4 space-y-3 min-h-full flex flex-col">
            {messages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mb-3">
                  <i className="fas fa-comments text-blue-600 text-xl"></i>
                </div>
                <h2 className="text-lg font-bold text-gray-900 mb-1.5">您好，有什么可以帮您？</h2>
                <p className="text-gray-500 text-sm mb-5">
                  您可以用自然语言告诉我您想办理的事务，比如&ldquo;我要报销差旅费1000元&rdquo;
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-md">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => sendMessage(action.message)}
                      className="bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all text-left p-3"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-1.5 ${action.color}`}>
                        <i className={`fas ${action.icon} text-sm`}></i>
                      </div>
                      <span className="text-sm font-medium text-gray-900">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center mr-2.5 flex-shrink-0 mt-0.5">
                    <i className="fas fa-robot text-white text-xs"></i>
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 shadow-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center mr-2.5 flex-shrink-0">
                  <i className="fas fa-robot text-white text-xs"></i>
                </div>
                <div className="bg-white border border-gray-200 shadow-sm rounded-2xl px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }}></span>
                    </div>
                    <span className="text-sm text-gray-500">正在思考...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-200 bg-white flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="max-w-3xl mx-auto px-4 py-3">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-3.5 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                placeholder="输入您的需求，例如：我要报销差旅费..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                disabled={loading}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-lg flex items-center gap-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <i className="fas fa-paper-plane text-xs"></i>
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
