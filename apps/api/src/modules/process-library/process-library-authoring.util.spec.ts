import { buildProcessLibraryFlowDefinitions } from './process-library-authoring.util';

describe('process-library-authoring util', () => {
  it('prefers the structured flow page over conflicting step urls in direct-link preflight generation', () => {
    const content = [
      '# 系统基本信息',
      '系统名称: 示例 OA',
      '认证入口: https://auth.example.com/login',
      '系统网址: https://oa.example.com/',
      '',
      '## 流程: 请假申请',
      '描述: 教职工请假申请',
      '流程页面: https://oa.example.com/workflow/new?templateId=correct',
      '用户办理时需要补充的信息:',
      '- 请假事由 | 必填 | 说明: 请假原因 | 示例: 家中有事',
      '办理步骤:',
      '- 访问 https://auth.example.com/login',
      '- 访问 https://oa.example.com/',
      '- 访问 https://oa.example.com/workflow/new?templateId=stale',
      '- 输入 请假事由',
      '- 点击 保存待发',
      '测试样例:',
      '- 请假事由: 家中有事',
    ].join('\n');

    const result = buildProcessLibraryFlowDefinitions({
      content,
      accessMode: 'url',
      authoringMode: 'text',
      connectorBaseUrl: 'https://oa.example.com/',
    });

    expect(result.definitions).toHaveLength(1);

    const flow = result.definitions[0] as Record<string, any>;
    const preflightSteps = Array.isArray(flow.runtime?.preflight?.steps)
      ? flow.runtime.preflight.steps as Array<Record<string, any>>
      : [];
    const gotoUrls = preflightSteps
      .filter((step) => String(step?.type || '').trim().toLowerCase() === 'goto')
      .map((step) => String(step?.value || '').trim())
      .filter(Boolean);

    expect(flow.description).toBe('教职工请假申请');
    expect(flow.platform?.jumpUrlTemplate).toBe('https://oa.example.com/workflow/new?templateId=correct');
    expect(gotoUrls).toContain('https://auth.example.com/login');
    expect(gotoUrls).toContain('https://oa.example.com/workflow/new?templateId=correct');
    expect(gotoUrls).not.toContain('https://oa.example.com/workflow/new?templateId=stale');
  });
});
