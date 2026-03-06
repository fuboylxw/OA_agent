import { getServerAuth, getApiUrl } from '../lib/auth';
import { redirect } from 'next/navigation';
import ConnectorsContent from './ConnectorsContent';

export default async function ConnectorsPage() {
  const { userId, tenantId, roles } = await getServerAuth();
  if (!userId) redirect('/login');
  if (!roles.includes('admin') && !roles.includes('flow_manager')) redirect('/');

  const API_URL = getApiUrl();
  let connectors = [];
  try {
    const res = await fetch(
      `${API_URL}/api/v1/connectors?tenantId=${tenantId}`,
      { cache: 'no-store' },
    );
    connectors = await res.json();
  } catch { /* ignore */ }

  return <ConnectorsContent initialConnectors={connectors} />;
}
