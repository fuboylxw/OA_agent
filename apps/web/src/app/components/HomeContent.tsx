'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { apiClient } from '../lib/api-client';
import { hasRequiredRole } from '../lib/access-control';
import {
  getClientAuthServerSnapshot,
  getClientAuthSnapshot,
  subscribeClientAuth,
} from '../lib/client-auth';

interface Stats {
  totalSubmissions: number;
  monthlySubmissions: number;
  templateCount: number;
  connectorCount: number;
  pendingSubmissions: number;
  systemHealth: number;
}

interface Activity {
  id: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
}

const DEFAULT_STATS: Stats = {
  totalSubmissions: 0,
  monthlySubmissions: 0,
  templateCount: 0,
  connectorCount: 0,
  pendingSubmissions: 0,
  systemHealth: 100,
};

const COLOR_CLASSES: Record<string, { bg: string; text: string }> = {
  purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
  green: { bg: 'bg-green-100', text: 'text-green-600' },
  red: { bg: 'bg-red-100', text: 'text-red-600' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
};

const getActivityIcon = (type: string, status: string) => {
  if (type === 'bootstrap') return { icon: 'fa-sync', color: 'purple' };
  if (status === 'completed') return { icon: 'fa-check-circle', color: 'green' };
  if (status === 'failed') return { icon: 'fa-exclamation-triangle', color: 'red' };
  if (status === 'pending') return { icon: 'fa-clock', color: 'orange' };
  return { icon: 'fa-file-alt', color: 'blue' };
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatActivityStatus = (status: string) => {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'pending':
      return '待处理';
    case 'running':
      return '进行中';
    default:
      return status;
  }
};

export default function HomeContent() {
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);
  const [displayName, setDisplayName] = useState('用户');
  const snapshot = useSyncExternalStore(
    subscribeClientAuth,
    getClientAuthSnapshot,
    getClientAuthServerSnapshot,
  );

  useEffect(() => {
    apiClient.get('/dashboard/overview').then((res) => {
      const data = res.data || {};
      setStats(data.stats || DEFAULT_STATS);
      setRecentActivity(data.recentActivity || []);
      setDisplayName(data.user?.displayName || '用户');
    }).catch(() => {});
  }, []);

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Welcome Section */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">欢迎回来，{displayName}</h1>
        <p className="text-gray-600">今天是 {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
      </div>

      {/* Quick Actions Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Link href="/chat" className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow cursor-pointer block">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-comments text-blue-600"></i>
            </div>
            <i className="fas fa-arrow-right text-gray-400"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">对话办事</h3>
          <p className="text-gray-600 text-sm mb-4">通过自然语言发起办事申请</p>
          <div className="text-xs text-gray-500">快速开始</div>
        </Link>

        <Link href="/submissions" className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow cursor-pointer block">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-file-alt text-green-600"></i>
            </div>
            <i className="fas fa-arrow-right text-gray-400"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">我的申请</h3>
          <p className="text-gray-600 text-sm mb-4">查看申请进度和状态</p>
          <div className="text-xs text-gray-500">{stats.pendingSubmissions} 个待处理</div>
        </Link>

        <Link href="/processes" className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow cursor-pointer block">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-book text-purple-600"></i>
            </div>
            <i className="fas fa-arrow-right text-gray-400"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">流程库</h3>
          <p className="text-gray-600 text-sm mb-4">浏览所有可用流程模板</p>
          <div className="text-xs text-gray-500">{stats.templateCount} 个流程</div>
        </Link>

        {hasRequiredRole(snapshot.roles, ['admin']) ? (
        <Link href="/bootstrap" className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow cursor-pointer block">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-cogs text-orange-600"></i>
            </div>
            <i className="fas fa-arrow-right text-gray-400"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">初始化中心</h3>
          <p className="text-gray-600 text-sm mb-4">配置OA系统和流程发现</p>
          <div className="text-xs text-gray-500">{stats.connectorCount} 个连接器</div>
        </Link>
        ) : null}
      </div>

      {/* New User Guide */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 mb-8 border border-blue-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">新手指南</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">1</div>
            <div>
              <p className="font-medium text-gray-900">选择流程</p>
              <p className="text-sm text-gray-600">从流程库中选择需要办理的事项</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">2</div>
            <div>
              <p className="font-medium text-gray-900">对话填写</p>
              <p className="text-sm text-gray-600">通过自然语言填写申请信息</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">3</div>
            <div>
              <p className="font-medium text-gray-900">提交审批</p>
              <p className="text-sm text-gray-600">确认信息无误后提交申请</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tenant Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">总提交数</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalSubmissions}</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-file-alt text-blue-600"></i>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-600">累计提交</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">本月提交</p>
              <p className="text-2xl font-bold text-gray-900">{stats.monthlySubmissions}</p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-paper-plane text-green-600"></i>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-600">本月统计</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">模板数量</p>
              <p className="text-2xl font-bold text-gray-900">{stats.templateCount}</p>
            </div>
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-clipboard-list text-purple-600"></i>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-600">{stats.pendingSubmissions} 个待处理</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">系统健康</p>
              <p className="text-2xl font-bold text-gray-900">{stats.systemHealth}%</p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-heartbeat text-green-600"></i>
            </div>
          </div>
          <div className="mt-2 text-sm text-green-600">运行正常</div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">最近活动</h3>
        {recentActivity.length === 0 ? (
          <div className="text-center text-gray-500 py-8">暂无活动记录</div>
        ) : (
          <div className="space-y-3">
            {recentActivity.map((activity) => {
              const { icon, color } = getActivityIcon(activity.type, activity.status);
              const cls = COLOR_CLASSES[color] || COLOR_CLASSES.blue;
              return (
                <div key={activity.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 ${cls.bg} rounded-full flex items-center justify-center`}>
                      <i className={`fas ${icon} ${cls.text} text-xs`}></i>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{activity.title}</p>
                      <p className="text-sm text-gray-600">{formatDate(activity.createdAt)}</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">{formatActivityStatus(activity.status)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
