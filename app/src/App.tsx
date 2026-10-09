import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useSessionStore, applyTheme } from './stores/session.store.ts'
import { useDataStore } from './stores/data.store.ts'
import { ToastProvider } from './ui/components/ui.tsx'
import { AppShell } from './ui/layout/AppShell.tsx'
import { SetupPage } from './ui/pages/SetupPage.tsx'
import { LockPage } from './ui/pages/LockPage.tsx'
import { DashboardPage } from './ui/pages/DashboardPage.tsx'
import { CustomersPage } from './ui/pages/CustomersPage.tsx'
import { LicensesPage } from './ui/pages/LicensesPage.tsx'
import { NotificationsPage } from './ui/pages/NotificationsPage.tsx'
import { SupportPage } from './ui/pages/SupportPage.tsx'
import { ContentPage } from './ui/pages/ContentPage.tsx'
import { AuditPage } from './ui/pages/AuditPage.tsx'
import { SettingsPage } from './ui/pages/SettingsPage.tsx'
import { useConfigStore } from './stores/config.store.ts'

function Guarded() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/licenses" element={<LicensesPage />} />
        <Route path="/features" element={<Navigate to="/customers" replace />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/content" element={<ContentPage />} />
        <Route path="/bot" element={<Navigate to="/settings" replace />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}

export function App() {
  const { status, init, theme } = useSessionStore()
  const loadConfig = useConfigStore((s) => s.load)
  const refreshData = useDataStore((s) => s.refresh)

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { void init() }, [init])
  useEffect(() => {
    if (status === 'unlocked') {
      void loadConfig().then(() => refreshData())
    }
  }, [status, loadConfig, refreshData])

  return (
    <ToastProvider>
      {status === 'loading' ? (
        <div className="center-screen"><div className="spinner" /></div>
      ) : status === 'setup' ? (
        <SetupPage />
      ) : status === 'locked' ? (
        <LockPage />
      ) : (
        <Guarded />
      )}
    </ToastProvider>
  )
}

export function Root() {
  return (
    <HashRouter>
      <App />
    </HashRouter>
  )
}
