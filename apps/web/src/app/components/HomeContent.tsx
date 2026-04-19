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

interface FeaturedProcess {
  id: string;
  processCode: string;
  processName: string;
  processCategory?: string | null;
  connector?: {
    id: string;
    name: string;
  } | null;
}

interface HomeContentCache {
  stats: Stats;
  recentActivity: Activity[];
  featuredProcesses: FeaturedProcess[];
  displayName: string;
}

const DEFAULT_STATS: Stats = {
  totalSubmissions: 0,
  monthlySubmissions: 0,
  templateCount: 0,
  connectorCount: 0,
  pendingSubmissions: 0,
  systemHealth: 100,
};

let homeContentCache: HomeContentCache | null = null;

const COLOR_CLASSES: Record<string, { bg: string; text: string }> = {
  purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
  green: { bg: 'bg-green-100', text: 'text-green-600' },
  red: { bg: 'bg-red-100', text: 'text-red-600' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
};

const MOBILE_SHORTCUT_ACCENTS = [
  {
    icon: 'fa-calendar-check',
    cardClass: 'border-emerald-100 bg-emerald-50/70',
    iconClass: 'bg-emerald-100 text-emerald-700',
  },
  {
    icon: 'fa-file-signature',
    cardClass: 'border-sky-100 bg-sky-50/80',
    iconClass: 'bg-sky-100 text-sky-700',
  },
  {
    icon: 'fa-receipt',
    cardClass: 'border-amber-100 bg-amber-50/80',
    iconClass: 'bg-amber-100 text-amber-700',
  },
  {
    icon: 'fa-folder-open',
    cardClass: 'border-violet-100 bg-violet-50/80',
    iconClass: 'bg-violet-100 text-violet-700',
  },
];

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
  const snapshot = useSyncExternalStore(
    subscribeClientAuth,
    getClientAuthSnapshot,
    getClientAuthServerSnapshot,
  );
  const cachedHomeData = homeContentCache;
  const [stats, setStats] = useState<Stats>(cachedHomeData?.stats || DEFAULT_STATS);
  const [recentActivity, setRecentActivity] = useState<Activity[]>(cachedHomeData?.recentActivity || []);
  const [featuredProcesses, setFeaturedProcesses] = useState<FeaturedProcess[]>(cachedHomeData?.featuredProcesses || []);
  const [displayName, setDisplayName] = useState(
    cachedHomeData?.displayName || snapshot.displayName || snapshot.username || '用户',
  );
  const [homeLoading, setHomeLoading] = useState(!cachedHomeData);

  useEffect(() => {
    let cancelled = false;

    const loadHomeData = async () => {
      const [overviewResult, libraryResult] = await Promise.allSettled([
        apiClient.get('/dashboard/overview'),
        apiClient.get('/process-library'),
      ]);

      if (cancelled) {
        return;
      }

      let nextStats = homeContentCache?.stats || DEFAULT_STATS;
      let nextRecentActivity = homeContentCache?.recentActivity || [];
      let nextFeaturedProcesses = homeContentCache?.featuredProcesses || [];
      let nextDisplayName = homeContentCache?.displayName || snapshot.displayName || snapshot.username || '用户';

      if (overviewResult.status === 'fulfilled') {
        const data = overviewResult.value.data || {};
        nextStats = data.stats || DEFAULT_STATS;
        nextRecentActivity = Array.isArray(data.recentActivity) ? data.recentActivity : [];
        nextDisplayName = data.user?.displayName || nextDisplayName;
      }

      if (libraryResult.status === 'fulfilled') {
        const data = Array.isArray(libraryResult.value.data) ? libraryResult.value.data : [];
        nextFeaturedProcesses = data
          .filter((item) => item?.processCode && item?.processName)
          .slice(0, 4);
      }

      homeContentCache = {
        stats: nextStats,
        recentActivity: nextRecentActivity,
        featuredProcesses: nextFeaturedProcesses,
        displayName: nextDisplayName,
      };

      setStats(nextStats);
      setRecentActivity(nextRecentActivity);
      setFeaturedProcesses(nextFeaturedProcesses);
      setDisplayName(nextDisplayName);
      setHomeLoading(false);
    };

    void loadHomeData();

    return () => {
      cancelled = true;
    };
  }, [snapshot.displayName, snapshot.username]);

  const mobileRecentActivity = recentActivity
    .filter((activity) => activity.type !== 'bootstrap')
    .slice(0, 5);
  const shouldShowHomeSkeleton = homeLoading && !cachedHomeData;
  const desktopRecentActivity = recentActivity;

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 pb-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom)+1.5rem)] pt-5 md:hidden">
        <section className="rounded-[1.75rem] bg-gradient-to-br from-sky-600 via-sky-500 to-indigo-500 px-5 py-6 text-white shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-white/85">您好，{displayName}</p>
              <h1 className="mt-2 text-2xl font-semibold">今天想办理什么？</h1>
              <p className="mt-2 text-sm leading-6 text-white/85">
                {new Date().toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                })}
              </p>
            </div>
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <i className="fas fa-comments text-lg"></i>
            </div>
          </div>

          <Link
            href="/chat"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
          >
            <i className="fas fa-plus text-xs"></i>
            发起申请
          </Link>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <div className="text-xs text-slate-500">待处理</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {shouldShowHomeSkeleton ? <div className="h-8 w-10 animate-pulse rounded-xl bg-slate-100" /> : stats.pendingSubmissions}
            </div>
            <div className="mt-1 text-xs text-slate-500">需要继续跟进的申请</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <div className="text-xs text-slate-500">本月提交</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {shouldShowHomeSkeleton ? <div className="h-8 w-10 animate-pulse rounded-xl bg-slate-100" /> : stats.monthlySubmissions}
            </div>
            <div className="mt-1 text-xs text-slate-500">本月已发起的申请数</div>
          </div>
        </section>

        <section className="mt-5 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">常用事项</h2>
              <p className="mt-1 text-xs text-slate-500">从已初始化的流程中快速进入办理</p>
            </div>
            <Link href="/chat" className="text-xs font-medium text-sky-700">
              去对话
            </Link>
          </div>

          {shouldShowHomeSkeleton ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="mb-3 h-10 w-10 animate-pulse rounded-2xl bg-slate-100"></div>
                  <div className="h-4 w-20 animate-pulse rounded-full bg-slate-100"></div>
                  <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-slate-100"></div>
                  <div className="mt-2 h-3 w-2/3 animate-pulse rounded-full bg-slate-100"></div>
                </div>
              ))}
            </div>
          ) : featuredProcesses.length === 0 ? (
            <Link
              href="/chat"
              className="flex items-center justify-between rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600"
            >
              <span>暂未加载到常用流程，去对话页直接描述需求</span>
              <i className="fas fa-arrow-right text-xs text-slate-400"></i>
            </Link>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {featuredProcesses.map((process, index) => {
                const accent = MOBILE_SHORTCUT_ACCENTS[index % MOBILE_SHORTCUT_ACCENTS.length];
                return (
                  <Link
                    key={process.id}
                    href={`/chat?flow=${encodeURIComponent(process.processCode)}`}
                    className={`rounded-3xl border px-4 py-4 transition-colors hover:border-sky-200 hover:shadow-sm ${accent.cardClass}`}
                  >
                    <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-2xl ${accent.iconClass}`}>
                      <i className={`fas ${accent.icon} text-sm`}></i>
                    </div>
                    <div className="min-h-[3rem] overflow-hidden text-sm font-semibold leading-6 text-slate-900">
                      {process.processName}
                    </div>
                    <div className="mt-1 min-h-[2.5rem] overflow-hidden text-xs leading-5 text-slate-500">
                      {process.processCategory || process.connector?.name || process.processCode}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">最近办理</h2>
              <p className="mt-1 text-xs text-slate-500">可前往我的申请查看完整进度</p>
            </div>
            <Link href="/submissions" className="text-xs font-medium text-sky-700">
              查看全部
            </Link>
          </div>

          {shouldShowHomeSkeleton ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-center justify-between rounded-3xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-2xl bg-slate-100"></div>
                    <div className="min-w-0">
                      <div className="h-4 w-24 animate-pulse rounded-full bg-slate-100"></div>
                      <div className="mt-2 h-3 w-20 animate-pulse rounded-full bg-slate-100"></div>
                    </div>
                  </div>
                  <div className="h-3 w-10 animate-pulse rounded-full bg-slate-100"></div>
                </div>
              ))}
            </div>
          ) : mobileRecentActivity.length === 0 ? (
            <div className="rounded-3xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              暂无最近办理记录
            </div>
          ) : (
            <div className="space-y-3">
              {mobileRecentActivity.map((activity) => {
                const { icon, color } = getActivityIcon(activity.type, activity.status);
                const cls = COLOR_CLASSES[color] || COLOR_CLASSES.blue;
                return (
                  <Link
                    key={activity.id}
                    href="/submissions"
                    className="flex items-center justify-between rounded-3xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ${cls.bg}`}>
                        <i className={`fas ${icon} ${cls.text} text-xs`}></i>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{activity.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDate(activity.createdAt)}</div>
                      </div>
                    </div>
                    <div className="ml-3 flex flex-shrink-0 items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">
                        {formatActivityStatus(activity.status)}
                      </span>
                      <i className="fas fa-chevron-right text-[10px] text-slate-300"></i>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="hidden md:block">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="mb-8">
            <h1 className="mb-2 text-2xl font-bold text-gray-900">欢迎回来，{displayName}</h1>
            <p className="text-gray-600">
              今天是 {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Link href="/chat" className="block cursor-pointer rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <i className="fas fa-comments text-blue-600"></i>
                </div>
                <i className="fas fa-arrow-right text-gray-400"></i>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">对话办事</h3>
              <p className="mb-4 text-sm text-gray-600">通过自然语言发起办事申请</p>
              <div className="text-xs text-gray-500">快速开始</div>
            </Link>

            <Link href="/submissions" className="block cursor-pointer rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
                  <i className="fas fa-file-alt text-green-600"></i>
                </div>
                <i className="fas fa-arrow-right text-gray-400"></i>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">我的申请</h3>
              <p className="mb-4 text-sm text-gray-600">查看申请进度和状态</p>
              <div className="text-xs text-gray-500">{stats.pendingSubmissions} 个待处理</div>
            </Link>

            {hasRequiredRole(snapshot.roles, ['admin', 'flow_manager']) ? (
              <Link href="/process-library" className="block cursor-pointer rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100">
                    <i className="fas fa-book text-purple-600"></i>
                  </div>
                  <i className="fas fa-arrow-right text-gray-400"></i>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">流程库</h3>
                <p className="mb-4 text-sm text-gray-600">浏览所有可用流程模板</p>
                <div className="text-xs text-gray-500">{stats.templateCount} 个流程</div>
              </Link>
            ) : null}

            {hasRequiredRole(snapshot.roles, ['admin']) ? (
              <Link href="/bootstrap" className="block cursor-pointer rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-100">
                    <i className="fas fa-cogs text-orange-600"></i>
                  </div>
                  <i className="fas fa-arrow-right text-gray-400"></i>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">初始化中心</h3>
                <p className="mb-4 text-sm text-gray-600">配置OA系统和流程发现</p>
                <div className="text-xs text-gray-500">{stats.connectorCount} 个连接器</div>
              </Link>
            ) : null}

            {hasRequiredRole(snapshot.roles, ['admin']) ? (
              <Link href="/connectors" className="block cursor-pointer rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
                    <i className="fas fa-plug text-slate-700"></i>
                  </div>
                  <i className="fas fa-arrow-right text-gray-400"></i>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">连接器管理</h3>
                <p className="mb-4 text-sm text-gray-600">查看和维护已初始化的业务系统</p>
                <div className="text-xs text-gray-500">{stats.connectorCount} 个连接器</div>
              </Link>
            ) : null}
          </div>

          <div className="mb-8 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">新手指南</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex items-center space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">1</div>
                <div>
                  <p className="font-medium text-gray-900">选择流程</p>
                  <p className="text-sm text-gray-600">从流程库中选择需要办理的事项</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">2</div>
                <div>
                  <p className="font-medium text-gray-900">对话填写</p>
                  <p className="text-sm text-gray-600">通过自然语言填写申请信息</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">3</div>
                <div>
                  <p className="font-medium text-gray-900">提交审批</p>
                  <p className="text-sm text-gray-600">确认信息无误后提交申请</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">总提交数</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalSubmissions}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <i className="fas fa-file-alt text-blue-600"></i>
                </div>
              </div>
              <div className="mt-2 text-sm text-gray-600">累计提交</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">本月提交</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.monthlySubmissions}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                  <i className="fas fa-paper-plane text-green-600"></i>
                </div>
              </div>
              <div className="mt-2 text-sm text-gray-600">本月统计</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">模板数量</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.templateCount}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                  <i className="fas fa-clipboard-list text-purple-600"></i>
                </div>
              </div>
              <div className="mt-2 text-sm text-gray-600">{stats.pendingSubmissions} 个待处理</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">系统健康</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.systemHealth}%</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                  <i className="fas fa-heartbeat text-green-600"></i>
                </div>
              </div>
              <div className="mt-2 text-sm text-green-600">运行正常</div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">最近活动</h3>
            {shouldShowHomeSkeleton ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="flex items-center justify-between rounded-lg p-3">
                    <div className="flex items-center space-x-3">
                      <div className="h-8 w-8 animate-pulse rounded-full bg-slate-100"></div>
                      <div>
                        <div className="h-4 w-28 animate-pulse rounded-full bg-slate-100"></div>
                        <div className="mt-2 h-3 w-24 animate-pulse rounded-full bg-slate-100"></div>
                      </div>
                    </div>
                    <div className="h-3 w-10 animate-pulse rounded-full bg-slate-100"></div>
                  </div>
                ))}
              </div>
            ) : desktopRecentActivity.length === 0 ? (
              <div className="py-8 text-center text-gray-500">暂无活动记录</div>
            ) : (
              <div className="space-y-3">
                {desktopRecentActivity.map((activity) => {
                  const { icon, color } = getActivityIcon(activity.type, activity.status);
                  const cls = COLOR_CLASSES[color] || COLOR_CLASSES.blue;
                  return (
                    <div key={activity.id} className="flex items-center justify-between rounded-lg p-3 hover:bg-gray-50">
                      <div className="flex items-center space-x-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${cls.bg}`}>
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
      </div>
    </main>
  );
}
