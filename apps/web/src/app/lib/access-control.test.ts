import { getHomeQuickActionHrefs, getRoleDisplayName, isRouteAllowed } from './access-control';

describe('access control', () => {
  it('limits regular users to chat and submissions quick actions', () => {
    expect(getHomeQuickActionHrefs(['user'])).toEqual(['/chat', '/submissions']);
  });

  it('shows process-library quick action for flow managers', () => {
    expect(getHomeQuickActionHrefs(['flow_manager'])).toEqual([
      '/chat',
      '/submissions',
      '/process-library',
    ]);
  });

  it('keeps admin quick actions for admins', () => {
    expect(getHomeQuickActionHrefs(['admin'])).toContain('/bootstrap');
    expect(getHomeQuickActionHrefs(['admin'])).toContain('/connectors');
  });

  it('blocks process library for regular users', () => {
    expect(isRouteAllowed('/process-library', ['user'])).toBe(false);
  });

  it('blocks legacy processes page for regular users', () => {
    expect(isRouteAllowed('/processes', ['user'])).toBe(false);
  });

  it('allows process library for flow managers and admins', () => {
    expect(isRouteAllowed('/process-library', ['flow_manager'])).toBe(true);
    expect(isRouteAllowed('/process-library', ['admin'])).toBe(true);
    expect(isRouteAllowed('/processes', ['flow_manager'])).toBe(true);
  });

  it('blocks connectors for flow managers', () => {
    expect(isRouteAllowed('/connectors', ['flow_manager'])).toBe(false);
  });

  it('allows api-upload only for admins', () => {
    expect(isRouteAllowed('/api-upload', ['admin'])).toBe(true);
    expect(isRouteAllowed('/api-upload', ['flow_manager'])).toBe(false);
  });

  it('allows auth-bindings only for admins', () => {
    expect(isRouteAllowed('/auth-bindings', ['admin'])).toBe(true);
    expect(isRouteAllowed('/auth-bindings', ['flow_manager'])).toBe(false);
  });

  it('returns localized role labels', () => {
    expect(getRoleDisplayName(['user'])).toBe('普通用户');
    expect(getRoleDisplayName(['flow_manager'])).toBe('管理员');
    expect(getRoleDisplayName(['admin'])).toBe('超级管理员');
  });
});
