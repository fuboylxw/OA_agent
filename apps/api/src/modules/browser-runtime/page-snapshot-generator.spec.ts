import { BrowserSecurityPolicy } from './browser-security-policy';
import { ElementRefCache } from './element-ref-cache';
import { PageSnapshotGenerator } from './page-snapshot-generator';

describe('PageSnapshotGenerator', () => {
  it('builds snapshot from captured page state and keeps stable element refs', () => {
    const generator = new PageSnapshotGenerator(new ElementRefCache(), new BrowserSecurityPolicy());
    const session: any = { sessionId: 'session-1' };
    const tab: any = {
      tabId: 'tab-1',
      url: 'https://portal.example.com/form',
      title: 'Expense Form',
      action: 'submit',
      flow: {
        processCode: 'expense_submit',
        processName: 'Expense Submit',
      },
      payload: {
        formData: {
          amount: 100,
        },
      },
      ticket: {},
      history: [],
      formValues: {},
      uploads: [],
      extractedValues: {},
      artifacts: {},
      pageVersion: 1,
      lastInteractionAt: new Date().toISOString(),
    };

    const first = generator.generate(session, tab, {
      title: 'Expense Form',
      url: 'https://portal.example.com/form',
      importantTexts: ['Expense form'],
      regions: [{
        id: 'main',
        role: 'main',
        name: 'Main',
        elementSelectors: ['#amount', '#submit'],
      }],
      forms: [{
        id: 'form-main',
        name: 'Expense Form',
        fields: [{
          label: 'Amount',
          fieldKey: 'amount',
          required: true,
          selector: '#amount',
        }],
      }],
      interactiveElements: [
        {
          role: 'input',
          label: 'Amount',
          fieldKey: 'amount',
          selector: '#amount',
          required: true,
        },
        {
          role: 'button',
          label: 'Submit',
          text: 'Submit',
          selector: '#submit',
          targetHints: [{
            kind: 'image',
            value: 'submit-button.png',
            imageUrl: '/assets/submit-button.png',
          }],
        },
      ],
    });

    const second = generator.generate(session, tab, {
      title: 'Expense Form',
      url: 'https://portal.example.com/form',
      interactiveElements: [
        {
          role: 'input',
          label: 'Amount',
          fieldKey: 'amount',
          selector: '#amount',
          required: true,
        },
        {
          role: 'button',
          label: 'Submit',
          text: 'Submit',
          selector: '#submit',
          targetHints: [{
            kind: 'image',
            value: 'submit-button.png',
            imageUrl: '/assets/submit-button.png',
          }],
        },
      ],
    });

    expect(first.interactiveElements[0]?.ref).toBe('e1');
    expect(first.interactiveElements[1]?.ref).toBe('e2');
    expect(first.forms[0]?.fieldRefs).toEqual(['e1']);
    expect(first.regions[0]?.elementRefs).toEqual(['e1', 'e2']);
    expect(first.structuredText).toContain('e1');
    expect(second.interactiveElements[0]?.ref).toBe('e1');
    expect(second.interactiveElements[1]?.ref).toBe('e2');
  });
});
