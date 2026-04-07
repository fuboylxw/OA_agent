import AuthGuard from '../components/AuthGuard';
import BootstrapContent from './BootstrapContent';

export default function BootstrapPage() {
  return (
    <AuthGuard allowedRoles={['admin']}>
      <BootstrapContent initialJobs={[]} />
    </AuthGuard>
  );
}
