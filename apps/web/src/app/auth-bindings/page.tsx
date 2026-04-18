import AuthGuard from '../components/AuthGuard';

export default function AuthBindingsPage() {
  return (
    <AuthGuard allowedRoles={['admin']}>
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-amber-950">认证绑定已停用</h1>
          <p className="mt-4 text-sm leading-7 text-amber-900">
            当前系统已经切换到统一登录和委托凭据方案，不再使用手工维护 token、cookie
            或浏览器会话的认证绑定流程。
          </p>
          <p className="mt-3 text-sm leading-7 text-amber-900">
            测试阶段由系统在登录后自动为当前用户准备 mock 委托凭据；后续接入真实认证平台后，
            将替换为标准的委托令牌交换。
          </p>
        </div>
      </div>
    </AuthGuard>
  );
}
