type MaybeDateValue = string | null | undefined;

export interface ChatSessionSortValue {
  id?: string | null;
  timestamp?: MaybeDateValue;
  createdAt?: MaybeDateValue;
}

function toTime(value: MaybeDateValue) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortChatSessions<T extends ChatSessionSortValue>(sessions: readonly T[]) {
  return [...sessions].sort((left, right) => {
    const updatedDiff = toTime(right.timestamp) - toTime(left.timestamp);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }

    const createdDiff = toTime(right.createdAt) - toTime(left.createdAt);
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return String(right.id || '').localeCompare(String(left.id || ''));
  });
}
