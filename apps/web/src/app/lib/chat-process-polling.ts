type PollableProcessCard = {
  stage?: string | null;
};

type PollableSessionState = {
  stage?: string | null;
  activeProcessCard?: PollableProcessCard | null;
} | null | undefined;

type PollableMessage = {
  role?: string | null;
  processCard?: PollableProcessCard | null;
};

export function getChatPollingStage(
  sessionState: PollableSessionState,
  messages: PollableMessage[],
) {
  const activeCardStage = sessionState?.activeProcessCard?.stage || null;
  if (activeCardStage) {
    return activeCardStage;
  }

  const sessionStage = sessionState?.stage || null;
  if (sessionStage) {
    return sessionStage;
  }

  const latestProcessCard = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.processCard)?.processCard;

  return latestProcessCard?.stage || null;
}

export function shouldPollChatSession(
  sessionState: PollableSessionState,
  messages: PollableMessage[],
) {
  return getChatPollingStage(sessionState, messages) === 'executing';
}
