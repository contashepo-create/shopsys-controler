import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/* ─── Toasts ─── */

interface Toast {
  id: number
  text: string
  kind: 'ok' | 'error' | 'info'
}

interface ToastContextValue {
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = useCallback((text: string, kind: 'ok' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  const value = useMemo(() => ({ toast }), [toast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : t.kind === 'ok' ? 'ok' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (text: string, kind?: 'ok' | 'error' | 'info') => void {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx.toast
}

/* ─── Form controls ─── */

export function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  dir?: string
  mono?: boolean
  hint?: string
  required?: boolean
}) {
  return (
    <div className="field">
      <label>{props.label}{props.required ? ' *' : ''}</label>
      <input
        className={`input${props.mono ? ' input-mono' : ''}`}
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        dir={props.dir}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  )
}

export function Textarea(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <div className="field">
      <label>{props.label}</label>
      <textarea
        className="textarea"
        value={props.value}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  )
}

export function Select(props: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly { value: string; label: string }[]
}) {
  return (
    <div className="field">
      <label>{props.label}</label>
      <select className="select" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ─── Buttons / badges ─── */

export function Btn(props: {
  children: ReactNode
  onClick?: () => void
  kind?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'default' | 'sm'
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
}) {
  const cls = `btn${props.kind === 'primary' ? ' btn-primary' : props.kind === 'danger' ? ' btn-danger' : props.kind === 'ghost' ? ' btn-ghost' : ''}${props.size === 'sm' ? ' btn-sm' : ''}`
  return (
    <button className={cls} onClick={props.onClick} disabled={props.disabled} type={props.type ?? 'button'} title={props.title}>
      {props.children}
    </button>
  )
}

export function Badge(props: { children: ReactNode; kind?: 'ok' | 'warn' | 'danger' | 'muted' | 'accent' }) {
  const cls = `badge badge-${props.kind ?? 'muted'}`
  return <span className={cls}>{props.children}</span>
}

export function Spinner() {
  return <span className="spinner" />
}

export function EmptyState(props: { icon?: string; text: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon ?? '📭'}</div>
      <div>{props.text}</div>
      {props.hint ? <div className="muted" style={{ fontSize: 12.5 }}>{props.hint}</div> : null}
    </div>
  )
}

/* ─── Modal ─── */

export function Modal(props: {
  open: boolean
  title: string
  sub?: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
}) {
  if (!props.open) return null
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" style={props.wide ? { inlineSize: 'min(820px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{props.title}</div>
        {props.sub ? <div className="modal-sub">{props.sub}</div> : null}
        {props.children}
        {props.actions ? <div className="modal-actions">{props.actions}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog(props: {
  open: boolean
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.onCancel}
      actions={
        <>
          <Btn onClick={props.onCancel}>إلغاء</Btn>
          <Btn kind={props.danger ? 'danger' : 'primary'} onClick={props.onConfirm}>{props.confirmText ?? 'تأكيد'}</Btn>
        </>
      }
    >
      <p style={{ margin: 0 }}>{props.message}</p>
    </Modal>
  )
}
