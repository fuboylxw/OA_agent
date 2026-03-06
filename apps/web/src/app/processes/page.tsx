import { getServerAuth, getApiUrl } from '../lib/auth';
import { redirect } from 'next/navigation';
import ProcessesContent from './ProcessesContent';

export default async function ProcessesPage() {
  const { tenantId, userId } = await getServerAuth();
  if (!userId) redirect('/login');

  const API_URL = getApiUrl();
  let processes = [];
  try {
    const res = await fetch(
      `${API_URL}/api/v1/process-library?tenantId=${tenantId}`,
      { cache: 'no-store' },
    );
    processes = await res.json();
  } catch { /* ignore */ }

  return <ProcessesContent initialProcesses={processes} />;
}
