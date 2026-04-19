const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const BASE_URL = String(process.env.MOBILE_UI_WEB_BASE_URL || 'http://localhost:3000')
  .trim()
  .replace(/\/+$/, '');

const OUTPUT_DIR = path.join(process.cwd(), '.logs', 'mobile-ui-check');

const DASHBOARD_OVERVIEW = {
  stats: {
    totalSubmissions: 12,
    monthlySubmissions: 5,
    templateCount: 8,
    connectorCount: 2,
    pendingSubmissions: 3,
    systemHealth: 100,
  },
  recentActivity: [
    {
      id: 'activity-leave',
      title: '请假申请',
      type: 'submission',
      status: 'pending',
      createdAt: '2026-04-18T08:30:00.000Z',
    },
    {
      id: 'activity-seal',
      title: '用印申请',
      type: 'submission',
      status: 'completed',
      createdAt: '2026-04-17T09:10:00.000Z',
    },
    {
      id: 'activity-bootstrap',
      title: '系统初始化',
      type: 'bootstrap',
      status: 'completed',
      createdAt: '2026-04-16T10:00:00.000Z',
    },
  ],
  user: { displayName: '测试用户' },
};

const PROCESS_LIBRARY = [
  {
    id: 'process-leave',
    processCode: 'leave_request',
    processName: '请假申请',
    processCategory: '人事服务',
    connector: { id: 'connector-oa', name: '西安工程大学OA系统' },
  },
  {
    id: 'process-seal',
    processCode: 'seal_request',
    processName: '用印申请',
    processCategory: '综合服务',
    connector: { id: 'connector-oa', name: '西安工程大学OA系统' },
  },
  {
    id: 'process-expense',
    processCode: 'expense_submit',
    processName: '报销申请',
    processCategory: '财务服务',
    connector: { id: 'connector-oa', name: '西安工程大学OA系统' },
  },
  {
    id: 'process-purchase',
    processCode: 'procurement_apply',
    processName: '采购申请',
    processCategory: '采购服务',
    connector: { id: 'connector-oa', name: '西安工程大学OA系统' },
  },
];

const CHAT_SESSIONS = [
  {
    id: 'session-leave',
    title: '请假申请',
    lastMessage: '我想请假三天',
    messageCount: 6,
    timestamp: new Date().toISOString(),
    status: 'active',
    hasActiveProcess: true,
    processName: '请假申请',
    processStatus: 'collecting',
    processStatusText: '待补充',
    processStage: 'collecting',
    hasBusinessRecord: true,
  },
  {
    id: 'session-seal',
    title: '用印申请',
    lastMessage: '请上传附件',
    messageCount: 4,
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    status: 'active',
    hasActiveProcess: false,
    processName: '用印申请',
    processStatusText: '已完成',
    processStage: 'completed',
    hasBusinessRecord: true,
  },
];

const SUBMISSIONS = [
  {
    id: 'submission-leave',
    sourceType: 'submission',
    submissionId: 'submission-leave',
    oaSubmissionId: 'OA-2026-001',
    processCode: 'leave_request',
    processName: '请假申请',
    processCategory: '人事服务',
    connectorName: '西安工程大学OA系统',
    sessionId: 'session-leave',
    canRestoreConversation: true,
    status: 'submitted',
    statusText: '审批中',
    formData: {},
    formDataWithLabels: [
      {
        key: 'reason',
        label: '请假事由',
        value: '家中有事',
        displayValue: '家中有事',
        type: 'text',
      },
      {
        key: 'start_date',
        label: '开始日期',
        value: '2026-04-20',
        displayValue: '2026-04-20',
        type: 'date',
      },
    ],
    user: { id: 'u1', username: 'tester', displayName: '测试用户' },
    submittedAt: '2026-04-18T08:30:00.000Z',
    createdAt: '2026-04-18T08:25:00.000Z',
    updatedAt: '2026-04-18T08:30:00.000Z',
  },
  {
    id: 'draft-seal',
    sourceType: 'draft',
    draftId: 'draft-seal',
    processCode: 'seal_request',
    processName: '用印申请',
    processCategory: '综合服务',
    connectorName: '西安工程大学OA系统',
    sessionId: 'session-seal',
    canRestoreConversation: true,
    status: 'editing',
    statusText: '待补充信息',
    formData: {},
    formDataWithLabels: [
      {
        key: 'file_name',
        label: '文件类型、名称及份数',
        value: '证明材料 1 份',
        displayValue: '证明材料 1 份',
        type: 'text',
      },
    ],
    user: { id: 'u1', username: 'tester', displayName: '测试用户' },
    createdAt: '2026-04-17T08:25:00.000Z',
    updatedAt: '2026-04-17T09:20:00.000Z',
  },
];

async function installMockAuth(context) {
  await context.addCookies([
    {
      name: 'auth_session',
      value: 'mock-session-token',
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

async function installMockStorage(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sessionToken', 'mock-session-token');
    localStorage.setItem('userId', 'u1');
    localStorage.setItem('username', 'tester');
    localStorage.setItem('displayName', '测试用户');
    localStorage.setItem('roles', JSON.stringify(['user']));
    localStorage.setItem('tenantId', 'tenant-1');
  });
}

async function installMockApi(page) {
  await page.route('**/api/v1/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    const method = route.request().method();

    const respondJson = (data, headers = {}) => route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      headers,
      body: JSON.stringify(data),
    });

    if (pathname === '/api/v1/auth/me') {
      return respondJson({
        userId: 'u1',
        username: 'tester',
        displayName: '测试用户',
        roles: ['user'],
        tenantId: 'tenant-1',
      });
    }
    if (pathname === '/api/v1/dashboard/overview') {
      return respondJson(DASHBOARD_OVERVIEW);
    }
    if (pathname === '/api/v1/process-library' && method === 'GET') {
      return respondJson(PROCESS_LIBRARY);
    }
    if (pathname === '/api/v1/assistant/sessions' && method === 'GET') {
      return respondJson(CHAT_SESSIONS);
    }
    if (pathname === '/api/v1/submissions' && method === 'GET') {
      return respondJson(SUBMISSIONS);
    }
    if (pathname === '/api/v1/submissions/events') {
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
        body: '',
      });
    }
    if (pathname === '/api/v1/assistant/sessions/restore' && method === 'POST') {
      return respondJson({
        sessionId: 'session-leave',
        session: { id: 'session-leave' },
      });
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: false, pathname }),
    });
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await installMockAuth(context);

  const page = await context.newPage();
  await installMockStorage(page);
  await installMockApi(page);

  const results = {};

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.getByText('发起申请', { exact: true }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const recentActivitySection = page.locator('section').filter({ hasText: '最近办理' }).first();
  const recentActivityLink = recentActivitySection.locator('a').first();
  let recentLinkTargetOk = false;
  results.home = {
    currentUrl: page.url(),
    launchButton: await page.getByText('发起申请', { exact: true }).isVisible().catch(() => false),
    commonSection: await page.getByText('常用事项', { exact: true }).isVisible().catch(() => false),
    recentSection: await page.getByText('最近办理', { exact: true }).isVisible().catch(() => false),
    bottomNav: await page.getByRole('link', { name: /我的申请/ }).isVisible().catch(() => false),
    adminEntryVisible: await page.getByText('初始化中心', { exact: true }).isVisible().catch(() => false),
    recentLinkVisible: await recentActivityLink.isVisible().catch(() => false),
  };
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-home.png'), fullPage: true });
  if (await recentActivityLink.isVisible().catch(() => false)) {
    await recentActivityLink.click();
    await page.waitForTimeout(400);
    recentLinkTargetOk = page.url().includes('/submissions');
  }
  results.home.recentLinkTargetOk = recentLinkTargetOk;

  await page.goto(`${BASE_URL}/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const aside = page.locator('aside').first();
  const historyButton = page.getByRole('button', { name: /^历史$/ });
  const quickShortcutVisible = await page.getByRole('button', { name: /报销差旅费/ }).isVisible().catch(() => false);
  await historyButton.click();
  await page.waitForTimeout(300);
  const asideOpenBox = await aside.boundingBox();
  const drawerVisible = Boolean(asideOpenBox && asideOpenBox.x > -10);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-chat-drawer.png'), fullPage: true });
  await page.mouse.click(350, 120);
  await page.waitForTimeout(500);
  const asideClosedBox = await aside.boundingBox();
  const drawerClosed = Boolean(asideClosedBox && asideClosedBox.x < 0);
  results.chat = {
    historyButton: await historyButton.isVisible(),
    newChatButton: await page.getByTitle('新建对话').isVisible(),
    titleVisible:
      await page.locator('text=新对话').first().isVisible().catch(() => false)
      || await page.locator('text=当前对话').first().isVisible().catch(() => false),
    brandHidden: !(await page.getByText('UniFlow', { exact: true }).isVisible().catch(() => false)),
    quickShortcutHidden: !quickShortcutVisible,
    drawerVisible,
    drawerClosed,
    sessionItemVisible: await page.locator('aside').getByText('请假申请', { exact: true }).first().isVisible().catch(() => false),
  };
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-chat.png'), fullPage: true });

  await page.goto(`${BASE_URL}/submissions`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const processingChip = page.getByRole('button', { name: /处理中/ });
  await processingChip.click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /查看详情/ }).first().click();
  await page.waitForTimeout(300);
  results.submissions = {
    brandHidden: !(await page.getByText('UniFlow', { exact: true }).isVisible().catch(() => false)),
    topLaunchHidden: !(await page.getByRole('link', { name: /^发起$/ }).isVisible().catch(() => false)),
    topTitleVisible: await page.locator('main').getByText('我的申请', { exact: true }).first().isVisible().catch(() => false),
    systemNameVisible: await page.locator('main').getByText('西安工程大学OA系统', { exact: true }).first().isVisible().catch(() => false),
    filterAllVisible: await page.getByRole('button', { name: /全部/ }).isVisible(),
    filterProcessingVisible: await processingChip.isVisible(),
    cardVisible: await page.getByText('请假申请', { exact: true }).first().isVisible(),
    detailVisible: await page.locator('text=请假事由').first().isVisible(),
    restoreVisible: await page.getByRole('button', { name: /恢复对话/ }).first().isVisible(),
  };
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-submissions.png'), fullPage: true });

  const outputPath = path.join(OUTPUT_DIR, `result-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ outputPath, results }, null, 2));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
