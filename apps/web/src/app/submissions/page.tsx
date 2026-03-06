import { getServerAuth, getApiUrl } from '../lib/auth';
import { redirect } from 'next/navigation';
import SubmissionsContent from './SubmissionsContent';

export default async function SubmissionsPage() {
  const { userId, tenantId } = await getServerAuth();
  if (!userId) redirect('/login');

  const API_URL = getApiUrl();
  let submissions = [];
  try {
    const res = await fetch(
      `${API_URL}/api/v1/submissions?tenantId=${tenantId}&userId=${userId}`,
      { cache: 'no-store' },
    );
    submissions = await res.json();
  } catch { /* ignore */ }

  return <SubmissionsContent initialSubmissions={submissions} />;
}
