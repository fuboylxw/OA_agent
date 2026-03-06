import { getServerAuth, getApiUrl } from './lib/auth';
import { redirect } from 'next/navigation';
import HomeContent from './components/HomeContent';

export default async function Home() {
  const { userId, tenantId } = await getServerAuth();
  if (!userId) redirect('/login');

  const API_URL = getApiUrl();
  let data = null;
  try {
    const res = await fetch(
      `${API_URL}/api/v1/dashboard/overview?tenantId=${tenantId}&userId=${userId}`,
      { cache: 'no-store' },
    );
    data = await res.json();
  } catch { /* ignore */ }

  const stats = data?.stats || {
    totalSubmissions: 0,
    monthlySubmissions: 0,
    templateCount: 0,
    connectorCount: 0,
    pendingSubmissions: 0,
    systemHealth: 100,
  };
  const recentActivity = data?.recentActivity || [];
  const displayName = data?.user?.displayName || '用户';

  return <HomeContent stats={stats} recentActivity={recentActivity} displayName={displayName} />;
}
