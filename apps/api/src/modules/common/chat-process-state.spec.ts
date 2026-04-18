import {
  ChatProcessStatus,
  isTerminalChatProcessStatus,
  mapSubmissionStatusToChatProcessStatus,
} from './chat-process-state';

describe('chat-process-state', () => {
  it('maps draft_saved submissions to the dedicated draft-saved chat status', () => {
    expect(mapSubmissionStatusToChatProcessStatus('draft_saved')).toBe(ChatProcessStatus.DRAFT_SAVED);
  });

  it('treats draft-saved chat status as terminal for the current chat flow', () => {
    expect(isTerminalChatProcessStatus(ChatProcessStatus.DRAFT_SAVED)).toBe(true);
  });
});
