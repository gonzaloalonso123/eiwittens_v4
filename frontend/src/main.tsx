import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { Layout } from '@/components/layout';
import { ProtectedRoute } from '@/components/protected-route';
import { LoginPage } from '@/pages/login';
import { ProductsPage } from '@/pages/products';
import { ProductDetailPage } from '@/pages/product-detail';
import { ScraperEditorPage } from '@/pages/scraper-editor';
import './index.css';

const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <BrowserRouter>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route element={<ProtectedRoute />}>
                            <Route element={<Layout />}>
                                <Route path="/products" element={<ProductsPage />} />
                                <Route path="/products/new" element={<ProductDetailPage />} />
                                <Route path="/products/:id" element={<ProductDetailPage />} />
                                <Route path="/products/:id/scraper" element={<ScraperEditorPage />} />
                            </Route>
                        </Route>
                        <Route path="*" element={<Navigate to="/products" replace />} />
                    </Routes>
                    </BrowserRouter>
                </AuthProvider>
            </QueryClientProvider>
        </ThemeProvider>
    </React.StrictMode>,
);
