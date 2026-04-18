'use client';

import AuthGuard from '../components/AuthGuard';
import ProcessesContent from './ProcessesContent';

export default function ProcessesPage() {
  return (
    <AuthGuard allowedRoles={['admin', 'flow_manager']}>
      <ProcessesContent initialProcesses={[]} />
    </AuthGuard>
  );
}
