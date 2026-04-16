import { VisionTargetResolver } from './vision-target-resolver';

describe('VisionTargetResolver', () => {
  const resolver = new VisionTargetResolver();

  it('does not match unrelated input fields by role alone', () => {
    const result = resolver.resolve({
      type: 'input',
      fieldKey: 'field_8',
      target: {
        kind: 'text',
        label: '请假时间',
        value: '请假时间',
      },
      description: '输入 请假时间',
    }, {
      snapshotId: 'snapshot-1',
      title: '统一认证登录',
      url: 'https://sz.xpu.edu.cn/auth2/login',
      generatedAt: new Date().toISOString(),
      regions: [],
      forms: [],
      tables: [],
      dialogs: [],
      importantTexts: ['账号登录', '扫码登录'],
      structuredText: '账号登录',
      interactiveElements: [
        {
          ref: 'e1',
          role: 'input',
          label: '请输入账号/手机号/身份证号',
          text: undefined,
          fieldKey: undefined,
          selector: 'input[name="username"]',
        },
        {
          ref: 'e2',
          role: 'input',
          label: '请输入密码',
          text: undefined,
          fieldKey: undefined,
          selector: 'input[type="password"]',
        },
        {
          ref: 'e3',
          role: 'button',
          label: '登录',
          text: '登录',
          fieldKey: undefined,
          selector: 'button.login',
        },
      ],
    });

    expect(result.element).toBeUndefined();
    expect(result.strategy).toBe('none');
  });

  it('matches target text when the actual element exists', () => {
    const result = resolver.resolve({
      type: 'click',
      target: {
        kind: 'text',
        label: '保存待发',
        value: '保存待发',
      },
      description: '点击 保存待发',
    }, {
      snapshotId: 'snapshot-2',
      title: '请假申请',
      url: 'https://oa.example.com/leave',
      generatedAt: new Date().toISOString(),
      regions: [],
      forms: [],
      tables: [],
      dialogs: [],
      importantTexts: ['请假申请'],
      structuredText: '请假申请',
      interactiveElements: [
        {
          ref: 'e3',
          role: 'button',
          label: '保存待发',
          text: '保存待发',
          fieldKey: undefined,
          selector: 'button.save-draft',
        },
      ],
    });

    expect(result.element?.ref).toBe('e3');
    expect(result.strategy).toBe('text');
  });
});
