import { useEffect, useState } from "react"

const ARM_MS = 4000

/** A button that needs a second press within four seconds. Blur and timeout disarm it. */
export function ConfirmButton({
  label,
  confirmLabel,
  ariaLabel,
  onConfirm,
  disabled,
  className = "btn ghost",
}: {
  label: string
  confirmLabel: string
  ariaLabel?: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), ARM_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  useEffect(() => {
    if (disabled) setArmed(false)
  }, [disabled])

  return (
    <button
      type="button"
      className={armed ? `${className} armed` : className}
      disabled={disabled}
      aria-label={armed ? undefined : ariaLabel}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
