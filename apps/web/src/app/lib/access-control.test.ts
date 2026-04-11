import { getHomeQuickActionHrefs, isRouteAllowed } from './access-control';

describe('access control', () => {
  it('hides bootstrap quick action from regular users', () => {
    expect(getHomeQuickActionHrefs(['user'])).not.toContain('/bootstrap');
  });

  it('keeps bootstrap quick action for admins', () => {
    expect(getHomeQuickActionHrefs(['admin'])).toContain('/bootstrap');
  });

  it('blocks api-upload for regular users', () => {
    expect(isRouteAllowed('/api-upload', ['user'])).toBe(false);
  });

  it('allows api-upload for admins and flow managers', () => {
    expect(isRouteAllowed('/api-upload', ['admin'])).toBe(true);
    expect(isRouteAllowed('/api-upload', ['flow_manager'])).toBe(true);
  });
});
