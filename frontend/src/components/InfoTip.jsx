import { useState } from 'react'

/**
 * A small "?" info button with a hover/click tooltip. Use next to any label,
 * field, or section heading that needs a plain-language explanation.
 *
 * <InfoTip tip="XP = experience points. Example: …" />
 */
export default function InfoTip({ tip, label = 'About this setting' }) {
  const [open, setOpen] = useState(false)
  if (!tip) return null
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        title={tip}
        onClick={(e) => {
          e.preventDefault()
          setOpen((v) => !v)
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        className="ml-1.5 flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold leading-none text-sky-700 transition hover:bg-sky-200"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 w-64 -translate-x-1/2 rounded-xl bg-slate-800 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-lg"
        >
          {tip}
        </span>
      )}
    </span>
  )
}
