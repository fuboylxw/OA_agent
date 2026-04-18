import { getChatPollingStage, shouldPollChatSession } from './chat-process-polling';

describe('chat process polling', () => {
  it('polls while the latest assistant process card is executing', () => {
    const messages = [
      { role: 'assistant', processCard: { stage: 'submitted' } },
      { role: 'assistant', processCard: { stage: 'executing' } },
    ];

    expect(getChatPollingStage(null, messages)).toBe('executing');
    expect(shouldPollChatSession(null, messages)).toBe(true);
  });

  it('stops polling after the session reaches submitted', () => {
    const sessionState = {
      hasActiveProcess: false,
      stage: 'submitted',
      activeProcessCard: {
        stage: 'submitted',
      },
    };
    const messages = [
      { role: 'assistant', processCard: { stage: 'executing' } },
    ];

    expect(getChatPollingStage(sessionState, messages)).toBe('submitted');
    expect(shouldPollChatSession(sessionState, messages)).toBe(false);
  });

  it('does not keep polling after the session reaches draft-saved', () => {
    const sessionState = {
      hasActiveProcess: false,
      stage: 'draft',
      activeProcessCard: {
        stage: 'draft',
      },
    };
    const messages = [
      { role: 'assistant', processCard: { stage: 'executing' } },
    ];

    expect(getChatPollingStage(sessionState, messages)).toBe('draft');
    expect(shouldPollChatSession(sessionState, messages)).toBe(false);
  });
});
