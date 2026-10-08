import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, KeyRound, SlidersHorizontal, BellRing, Headset,
  Info, Bot, ScrollText, Settings, Lock, RefreshCw,
} from 'lucide-react'
import { useSessionStore } from '../../stores/session.store.ts'
import { useConfigStore } from '../../stores/config.store.ts'
import { useDataStore } from '../../stores/data.store.ts'
import { APP_NAME } from '../../core/settings.ts'
import { Badge, Spinner } from '../components/ui.tsx'

const NAV = [
  { to: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { to: '/customers', label: 'العملاء', icon: Users },
  { to: '/licenses', label: 'التراخيص', icon: KeyRound },
  { to: '/features', label: 'الميزات والأقسام', icon: SlidersHorizontal },
  { to: '/notifications', label: 'الإشعارات', icon: BellRing },
  { to: '/support', label: 'الدعم', icon: Headset },
  { to: '/content', label: '«حول» والتحديثات', icon: Info },
  { to: '/bot', label: 'البوت', icon: Bot },
  { to: '/audit', label: 'سجل التدقيق', icon: ScrollText },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
] as const

export function AppShell() {
  const navigate = useNavigate()
  const { lock, profile } = useSessionStore()
  const { botUsername, hasBotToken } = useConfigStore()
  const { loading, lastSyncAt, refresh, customers } = useDataStore()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ت</div>
          <div>
            <div className="brand-name">{APP_NAME}</div>
            <div className="brand-sub">Shopsys Controler</div>
          </div>
        </div>
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
        <div className="foot">
          {profile ? <div>👤 {profile.name}</div> : null}
          <div>© {APP_NAME}</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => refresh()} disabled={loading} title="تحديث البيانات">
              {loading ? <Spinner /> : <RefreshCw size={15} />}
              <span>تحديث</span>
            </button>
            {lastSyncAt ? <span className="muted" style={{ fontSize: 12 }}>آخر مزامنة: {lastSyncAt.slice(11, 19)}</span> : null}
          </div>
          <div className="spacer" />
          <div className="row">
            <Badge kind={hasBotToken ? (botUsername ? 'ok' : 'warn') : 'muted'}>
              🤖 {botUsername ? `@${botUsername}` : hasBotToken ? 'بوت متصل' : 'بدون بوت'}
            </Badge>
            <Badge kind="accent">👥 {customers.length} عميل</Badge>
            <button className="btn btn-ghost btn-sm" onClick={() => { lock(); navigate('/') }} title="قفل اللوحة">
              <Lock size={15} />
              <span>قفل</span>
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
