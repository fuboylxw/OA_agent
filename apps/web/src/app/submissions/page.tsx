import AuthGuard from '../components/AuthGuard';
import SubmissionsContent from './SubmissionsContent';

export default function SubmissionsPage() {
  return (
    <AuthGuard>
      <SubmissionsContent initialSubmissions={[]} />
    </AuthGuard>
  );
}
