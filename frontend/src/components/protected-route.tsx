import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

export function ProtectedRoute() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    if (!user) return <Navigate to="/login" replace />;

    return <Outlet />;
}
