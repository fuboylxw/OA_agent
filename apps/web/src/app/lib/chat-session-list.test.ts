import { sortChatSessions } from './chat-session-list';

describe('chat-session-list', () => {
  it('sorts sessions by latest update time descending', () => {
    const sessions = [
      { id: 'a', timestamp: '2026-04-18T09:00:00.000Z', createdAt: '2026-04-18T08:00:00.000Z' },
      { id: 'b', timestamp: '2026-04-18T11:00:00.000Z', createdAt: '2026-04-18T07:00:00.000Z' },
      { id: 'c', timestamp: '2026-04-18T10:00:00.000Z', createdAt: '2026-04-18T06:00:00.000Z' },
    ];

    expect(sortChatSessions(sessions).map((session) => session.id)).toEqual(['b', 'c', 'a']);
  });

  it('falls back to createdAt when updatedAt is tied or missing', () => {
    const sessions = [
      { id: 'a', timestamp: '2026-04-18T10:00:00.000Z', createdAt: '2026-04-18T08:00:00.000Z' },
      { id: 'b', timestamp: '2026-04-18T10:00:00.000Z', createdAt: '2026-04-18T09:00:00.000Z' },
      { id: 'c', timestamp: undefined, createdAt: '2026-04-18T07:00:00.000Z' },
    ];

    expect(sortChatSessions(sessions).map((session) => session.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not mutate the input array', () => {
    const sessions = [
      { id: 'a', timestamp: '2026-04-18T09:00:00.000Z' },
      { id: 'b', timestamp: '2026-04-18T11:00:00.000Z' },
    ];

    const originalIds = sessions.map((session) => session.id);
    void sortChatSessions(sessions);

    expect(sessions.map((session) => session.id)).toEqual(originalIds);
  });
});
