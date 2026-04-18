import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>(null!);

const STORAGE_KEY = 'eiwittens-theme';

function getSystemTheme(): ResolvedTheme {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
    return theme === 'system' ? getSystemTheme() : theme;
}

function applyTheme(resolved: ResolvedTheme) {
    const root = document.documentElement;
    root.classList.add('transition-theme');
    root.classList.toggle('dark', resolved === 'dark');
    // Remove transition class after animation completes
    setTimeout(() => root.classList.remove('transition-theme'), 250);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => {
        const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
        return stored ?? 'system';
    });

    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

    const setTheme = (next: Theme) => {
        setThemeState(next);
        localStorage.setItem(STORAGE_KEY, next);
        const resolved = resolveTheme(next);
        setResolvedTheme(resolved);
        applyTheme(resolved);
    };

    // Apply on mount (no transition)
    useEffect(() => {
        const resolved = resolveTheme(theme);
        setResolvedTheme(resolved);
        document.documentElement.classList.toggle('dark', resolved === 'dark');
    }, []);

    // Listen for system theme changes when set to 'system'
    useEffect(() => {
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            const resolved = getSystemTheme();
            setResolvedTheme(resolved);
            applyTheme(resolved);
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
