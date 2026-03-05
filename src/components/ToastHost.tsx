import type { ChangeEvent } from 'react'

export type BasicToast = {
  kind: 'success' | 'error' | 'info'
  title?: string
  message: string
}

export type ConfirmToast = {
  kind: 'confirm'
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

export type PromptNumberToast = {
  kind: 'promptNumber'
  title: string
  message: string
  inputLabel: string
  value: string
  placeholder?: string
  min?: number
  confirmText?: string
  cancelText?: string
  busy?: boolean
  error?: string | null
  onConfirm: (value: number) => void | Promise<void>
  onCancel?: () => void
}

export type ToastState = BasicToast | ConfirmToast | PromptNumberToast

type Props = {
  toast: ToastState | null
  setToast: (next: ToastState | null) => void
  disabled?: boolean
}

function toPositiveInt(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i > 0 ? i : null
}

export function ToastHost({ toast, setToast, disabled }: Props) {
  if (!toast) return null

  const isInteractive = toast.kind === 'confirm' || toast.kind === 'promptNumber'
  const isBusy = Boolean(disabled) || (isInteractive && Boolean(toast.busy))
  const ariaLive = toast.kind === 'error' ? 'assertive' : 'polite'

  const title =
    toast.kind === 'success'
      ? toast.title ?? 'Éxito'
      : toast.kind === 'error'
        ? toast.title ?? 'Error'
        : toast.kind === 'info'
          ? toast.title ?? 'Aviso'
          : toast.title

  const close = () => setToast(null)

  const handleConfirm = async () => {
    if (toast.kind === 'confirm') {
      await toast.onConfirm()
      return
    }
    if (toast.kind === 'promptNumber') {
      const n = toPositiveInt(toast.value)
      const min = toast.min ?? 1
      if (!n || n < min) {
        setToast({
          ...toast,
          error: `Valor inválido (debe ser un entero >= ${min}).`,
        })
        return
      }
      await toast.onConfirm(n)
    }
  }

  const handleCancel = () => {
    if (toast.kind === 'confirm' || toast.kind === 'promptNumber') {
      toast.onCancel?.()
    }
    close()
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (toast.kind !== 'promptNumber') return
    setToast({ ...toast, value: e.target.value, error: null })
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1000,
        width: 'min(520px, calc(100vw - 32px))',
      }}
      aria-live={ariaLive}
    >
      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--wg-text)', whiteSpace: 'pre-wrap' }}>{toast.message}</div>
          </div>

          {toast.kind === 'success' || toast.kind === 'error' || toast.kind === 'info' ? (
            <button
              type="button"
              className="btnSecondary headerBtn"
              onClick={close}
              disabled={Boolean(disabled)}
              title="Cerrar"
            >
              Cerrar
            </button>
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {toast.kind === 'confirm' || toast.kind === 'promptNumber' ? (
                <>
                  <button type="button" className="btnSecondary" onClick={handleCancel} disabled={isBusy}>
                    {toast.cancelText ?? 'Cancelar'}
                  </button>
                  <button type="button" onClick={() => void handleConfirm()} disabled={isBusy}>
                    {toast.confirmText ?? (toast.kind === 'confirm' ? 'Confirmar' : 'Aceptar')}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>

        {toast.kind === 'promptNumber' ? (
          <div style={{ marginTop: 10 }}>
            <label className="formField" style={{ margin: 0 }}>
              {toast.inputLabel}
              <input
                value={toast.value}
                onChange={handleInputChange}
                inputMode="numeric"
                placeholder={toast.placeholder}
                disabled={isBusy}
              />
            </label>
            {toast.error ? (
              <div className="error" style={{ marginTop: 8, fontSize: 13 }}>
                {toast.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
