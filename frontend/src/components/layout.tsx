import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { LogOut, Moon, Sun } from 'lucide-react';

export function Layout() {
    const { logout } = useAuth();
    const { resolvedTheme, setTheme } = useTheme();
    const location = useLocation();

    const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');

    return (
        <div className="min-h-screen bg-muted/30">
            <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-sm">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
                    <div className="flex items-center gap-6">
                        <Link to="/products" className="text-lg font-bold">
                            Eiwittens
                        </Link>
                        <nav className="flex items-center gap-4 text-sm">
                            <Link
                                to="/products"
                                className={location.pathname === '/products' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}
                            >
                                Products
                            </Link>
                        </nav>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
                            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={logout}>
                            <LogOut className="mr-2 h-4 w-4" />
                            Logout
                        </Button>
                    </div>
                </div>
            </header>
            <main className="mx-auto max-w-7xl p-4">
                <Outlet />
            </main>
        </div>
    );
}
