import UiKitPage from './ui/UiKitPage.jsx'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
const TracePage = lazy(() => import('./features/trace/TracePage.jsx'))
import { WorkspaceRouteContent, workspaceRoutes } from './features/workspace/workspace-routes.jsx'
import { canPreviewPath } from './features/workspace/workspace-paths.js'
const DemoApp = lazy(() => import('./demo/DemoApp.jsx'))
import LoginPage from './features/auth/LoginPage.jsx'
import ProtectedRoute from './features/auth/ProtectedRoute.jsx'
import PublicOnlyRoute from './features/auth/PublicOnlyRoute.jsx'
import RegisterPage from './features/auth/RegisterPage.jsx'
import LandingPage from './features/landing/LandingPage.jsx'
import LegalPage from './features/legal/LegalPage.jsx'
import OnboardingPage from './features/onboarding/PrismOnboarding.jsx'

function App() {
  return (
    <Routes>
      <Route path="/demo/*" element={<Suspense fallback={<div role="status" style={{ padding: 32 }}>Loading OwnTrace design studio…</div>}><DemoApp /></Suspense>} />
      {import.meta.env.DEV ? <Route path="/ui-kit" element={<UiKitPage />} /> : null}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />
      <Route path="/privacy-policy" element={<LegalPage type="privacy" />} />
      <Route path="/terms" element={<LegalPage type="terms" />} />
      <Route
        path="/onboarding"
        element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>}
      />
      {workspaceRoutes.map((route) => <Route key={route.path} path={`/${route.path}`} element={<ProtectedRoute><WorkspaceRouteContent route={route} /></ProtectedRoute>} />)}
      <Route path="/trace" element={<ProtectedRoute><Suspense fallback={<div role="status">Loading TRACE…</div>}><TracePage /></Suspense></ProtectedRoute>}>
        {workspaceRoutes.filter((route) => canPreviewPath(`/${route.path}`) || route.path === 'accounts/:id').map((route) => <Route key={route.path} path={`view/${route.path}`} element={<WorkspaceRouteContent route={route} />} />)}
        <Route path="*" element={<Navigate to="/trace" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
