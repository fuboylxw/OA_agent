import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function getServerAuth() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')?.value || '';
  const tenantId = cookieStore.get('tenantId')?.value || '';
  const rolesCookie = cookieStore.get('roles')?.value;
  let roles: string[] = [];
  try {
    roles = rolesCookie ? JSON.parse(decodeURIComponent(rolesCookie)) : [];
  } catch { /* ignore parse error */ }
  return { userId, tenantId, roles };
}

export function getApiUrl() {
  return API_URL;
}
