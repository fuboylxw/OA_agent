import AuthGuard from '../components/AuthGuard';
import ProcessesContent from './ProcessesContent';

export default function ProcessesPage() {
  return (
    <AuthGuard>
      <ProcessesContent initialProcesses={[]} />
    </AuthGuard>
  );
}
