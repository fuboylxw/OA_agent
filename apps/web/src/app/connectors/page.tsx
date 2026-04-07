import AuthGuard from '../components/AuthGuard';
import ConnectorsContent from './ConnectorsContent';

export default function ConnectorsPage() {
  return (
    <AuthGuard allowedRoles={['admin', 'flow_manager']}>
      <ConnectorsContent initialConnectors={[]} />
    </AuthGuard>
  );
}
