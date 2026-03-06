import { getServerAuth, getApiUrl } from '../lib/auth';
import { redirect } from 'next/navigation';
import BootstrapContent from './BootstrapContent';

export default async function BootstrapPage() {
  const { userId, tenantId, roles } = await getServerAuth();
  if (!userId) redirect('/login');
  if (!roles.includes('admin')) redirect('/');

  const API_URL = getApiUrl();
  let jobs = [];
  try {
    const res = await fetch(
      `${API_URL}/api/v1/bootstrap/jobs?tenantId=${tenantId}`,
      { cache: 'no-store' },
    );
    jobs = await res.json();
  } catch { /* ignore */ }

  return <BootstrapContent initialJobs={jobs} tenantId={tenantId} />;
}
