import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X, CornerDownLeft } from 'lucide-react'

export interface RequestSheetProps {
  gateId: number
  gateLabel: string
  // Profile values the LLM has access to for this user (full dict).
  profile?: Record<string, string>
  // Subset of FIELDS keys the LLM said it can confidently pre-fill from
  // `profile`. Those rows initialize with profile values and dematerialize
  // on popup. Anything not in this list stays for the user to type.
  autoFill?: string[]
}

type Phase = 'fill' | 'erasing' | 'confirm' | 'closing' | 'gone'

interface Field {
  key: string
  label: string
  placeholder: string
  type: 'text' | 'datetime-local'
  mono?: boolean
}

const FIELDS: Field[] = [
  { key: 'name',       label: 'user name',                       placeholder: 'your name',           type: 'text' },
  { key: 'employeeId', label: 'employee id',                     placeholder: 'E12345',              type: 'text', mono: true },
  { key: 'department', label: 'your department',                 placeholder: 'Engineering',         type: 'text' },
  { key: 'contact',    label: 'contact info (phone or email)',   placeholder: 'name@company.com',    type: 'text' },
  { key: 'visitor',    label: 'visitor',                         placeholder: 'no — employee',       type: 'text' },
  { key: 'intention',  label: 'user intention',                  placeholder: 'late shift, lock-up', type: 'text' },
  { key: 'dateTime',   label: 'date and time',                   placeholder: '',                    type: 'datetime-local' },
]

// All erasable rows dematerialize simultaneously: each char puffs into ~3
// peach blocks scattering radially, ~700ms total. STAGGER = 0 means every
// row goes at once. Row collapses just as the particles fade.
// STARTUP_DELAY_MS lets the user register the prefilled lines before they
// puff out, so the moment reads as "the LLM filled it then absorbed it."
const STARTUP_DELAY_MS = 500
const STAGGER_MS = 0
const ERASE_MS = 700
const COLLAPSE_DELAY_MS = 480
const CONFIRM_HOLD_MS = 700
const CLOSE_MS = 320

function defaultDateTime() {
  // Local YYYY-MM-DDTHH:mm for datetime-local input.
  const d = new Date()
  d.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatReason(v: Record<string, string>): string {
  const parts = [
    v.name && `${v.name}`,
    v.employeeId && `(${v.employeeId})`,
    v.department && `from ${v.department}`,
  ].filter(Boolean).join(' ')
  const tail = [
    v.intention && `— ${v.intention}`,
    v.visitor && `; visitor: ${v.visitor}`,
    v.contact && `; contact: ${v.contact}`,
    v.dateTime && `; when: ${v.dateTime}`,
  ].filter(Boolean).join(' ')
  return `${parts} ${tail}`.trim()
}

export default function RequestSheet({
  gateId,
  gateLabel,
  profile,
  autoFill,
}: RequestSheetProps) {
  // The LLM hands back: (a) a `profile` blob with everything it knows about
  // the user, and (b) `autoFill` — the subset of field keys it commits to
  // pre-filling. We initialize values for autoFill keys and leave the rest
  // empty for the user to type. Rows whose key is in autoFill will
  // dematerialize on popup.
  const initialValues = useMemo(() => {
    const v: Record<string, string> = {
      name: '', employeeId: '', department: '', contact: '',
      visitor: '', intention: '', dateTime: defaultDateTime(),
    }
    if (profile && autoFill) {
      for (const key of autoFill) {
        const val = profile[key]
        if (typeof val === 'string' && val.trim()) v[key] = val
      }
    }
    return v
    // profile/autoFill arrive as part of block props; refs are stable per
    // block instance — capture once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [activeIdx, setActiveIdx] = useState(() => {
    const firstEmpty = FIELDS.findIndex((f) => !(initialValues[f.key] ?? '').trim())
    return firstEmpty >= 0 ? firstEmpty : 0
  })
  const [phase, setPhase] = useState<Phase>('fill')
  const [erasingRows, setErasingRows] = useState<Set<number>>(new Set())
  const [collapsedRows, setCollapsedRows] = useState<Set<number>>(new Set())
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])
  const reduce = useReducedMotion()

  useEffect(() => {
    // Demo punch: on popup, the rows the LLM committed to pre-filling
    // (`autoFill` from server props) dematerialize together. Everything
    // else stays for the user to type.
    const autoErase = (autoFill ?? [])
      .map((key) => FIELDS.findIndex((f) => f.key === key))
      .filter((i) => i >= 0)
    const firstEmpty = FIELDS.findIndex(
      (f, i) => !autoErase.includes(i) && !(values[f.key] ?? '').trim(),
    )

    if (autoErase.length === 0) {
      inputsRef.current[0]?.focus()
      return
    }

    if (reduce) {
      setCollapsedRows(new Set(autoErase))
      if (firstEmpty >= 0) {
        setActiveIdx(firstEmpty)
        inputsRef.current[firstEmpty]?.focus()
      }
      return
    }

    const timers: number[] = []
    autoErase.forEach((rowIdx, n) => {
      timers.push(
        window.setTimeout(() => {
          setErasingRows((p) => new Set(p).add(rowIdx))
          timers.push(
            window.setTimeout(() => {
              setCollapsedRows((p) => new Set(p).add(rowIdx))
            }, COLLAPSE_DELAY_MS),
          )
        }, STARTUP_DELAY_MS + n * STAGGER_MS),
      )
    })
    const total = STARTUP_DELAY_MS + autoErase.length * STAGGER_MS + ERASE_MS + 100
    timers.push(
      window.setTimeout(() => {
        if (firstEmpty >= 0) {
          setActiveIdx(firstEmpty)
          inputsRef.current[firstEmpty]?.focus()
        }
      }, total),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function close() {
    setPhase('closing')
    window.setTimeout(() => setPhase('gone'), CLOSE_MS)
  }

  function focusRow(target: number) {
    // Find the closest non-collapsed row in the direction of travel.
    const dir = target > activeIdx ? 1 : target < activeIdx ? -1 : 0
    let i = Math.max(0, Math.min(FIELDS.length - 1, target))
    while (collapsedRows.has(i)) {
      const next = i + (dir || 1)
      if (next < 0 || next >= FIELDS.length) {
        // No row in that direction — try the other way.
        const back = collapsedRows.has(target)
          ? FIELDS.findIndex((_, j) => !collapsedRows.has(j))
          : target
        if (back < 0) return
        i = back
        break
      }
      i = next
    }
    setActiveIdx(i)
    inputsRef.current[i]?.focus()
  }

  function startSubmit() {
    if (phase !== 'fill') return
    // Only the still-visible (non-collapsed) rows need to be filled.
    const remaining = FIELDS.map((_, i) => i).filter((i) => !collapsedRows.has(i))
    const empty = remaining.find(
      (i) => !(values[FIELDS[i].key] ?? '').trim(),
    )
    if (empty !== undefined) {
      focusRow(empty)
      return
    }
    setPhase('erasing')

    if (reduce) {
      remaining.forEach((rowIdx, n) => {
        window.setTimeout(() => {
          setCollapsedRows((p) => new Set(p).add(rowIdx))
        }, n * 60)
      })
      window.setTimeout(finalize, remaining.length * 60 + 200)
      return
    }

    remaining.forEach((rowIdx, n) => {
      window.setTimeout(() => {
        setErasingRows((p) => new Set(p).add(rowIdx))
        window.setTimeout(() => {
          setCollapsedRows((p) => new Set(p).add(rowIdx))
        }, COLLAPSE_DELAY_MS)
      }, n * STAGGER_MS)
    })

    const totalErase = remaining.length * STAGGER_MS + ERASE_MS + 200
    window.setTimeout(finalize, totalErase)
  }

  function finalize() {
    setPhase('confirm')
    window.setTimeout(() => {
      const reason = formatReason(values)
      window.dispatchEvent(
        new CustomEvent('cu:chat-send', {
          detail: `request gate ${gateId} because ${reason}`,
        }),
      )
      close()
    }, CONFIRM_HOLD_MS)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>, idx: number) {
    if (phase !== 'fill') {
      e.preventDefault()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      startSubmit()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    const nextVisible = (from: number, dir: 1 | -1): number => {
      for (let j = from + dir; j >= 0 && j < FIELDS.length; j += dir) {
        if (!collapsedRows.has(j)) return j
      }
      return -1
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const next = nextVisible(idx, 1)
      if (next === -1) startSubmit()
      else focusRow(next)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const n = nextVisible(idx, 1)
      if (n !== -1) focusRow(n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const p = nextVisible(idx, -1)
      if (p !== -1) focusRow(p)
    }
  }

  if (phase === 'gone') return null

  const showConfirm = phase === 'confirm'

  return (
    <AnimatePresence>
      {phase !== 'closing' && (
        <motion.div
          key="rs-anchor"
          data-testid="request-sheet-modal"
          className="absolute z-30 left-4 right-4 bottom-[96px] flex justify-center pointer-events-none"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        >
          <motion.div
            role="region"
            aria-labelledby="rs-title"
            className="relative w-full max-w-[720px] pointer-events-auto bg-skin-surface border border-skin-border rounded-2xl shadow-sheet overflow-hidden"
          >
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-5 pb-4">
                <h2
                  id="rs-title"
                  className="font-display text-[22px] leading-none text-skin-ink"
                >
                  you need to fill following questions
                </h2>
                <button
                  type="button"
                  data-testid="rs-close"
                  aria-label="close"
                  onClick={close}
                  className="text-skin-muted hover:text-skin-ink transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="h-px bg-skin-border" />

              {/* Rows */}
              <div className="px-3 py-2">
                {FIELDS.map((f, i) => (
                  <Row
                    key={f.key}
                    index={i}
                    field={f}
                    value={values[f.key] ?? ''}
                    isActive={activeIdx === i && phase === 'fill'}
                    isErasing={erasingRows.has(i)}
                    isCollapsed={collapsedRows.has(i)}
                    onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                    onFocus={() => setActiveIdx(i)}
                    onKeyDown={(e) => onKey(e, i)}
                    inputRef={(el) => (inputsRef.current[i] = el)}
                  />
                ))}
              </div>

              <div className="h-px bg-skin-border" />

              {/* Footer */}
              <div className="relative flex items-center justify-between px-6 py-4">
                <div className="text-xs text-skin-muted">
                  gate <span className="text-skin-ink font-medium">#{gateId}</span> · {gateLabel}
                </div>
                <motion.button
                  type="button"
                  data-testid="rs-submit"
                  disabled={phase !== 'fill'}
                  whileTap={{ scale: 0.97 }}
                  onClick={startSubmit}
                  className="h-9 px-5 rounded-lg bg-skin-accent text-skin-ink font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-skin-accent-deep hover:text-skin-bg transition-colors"
                >
                  Submit
                </motion.button>
              </div>

              {/* Confirmation flash */}
              <AnimatePresence>
                {showConfirm && (
                  <motion.div
                    key="rs-confirm"
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="font-display text-[28px] text-skin-accent-deep flex items-center gap-3">
                      <span>Request submitted</span>
                      <span className="text-skin-success">✓</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            <div className="px-6 pb-3 text-[11px] text-skin-muted font-mono tracking-wide flex items-center gap-3 justify-end">
              <span><kbd className="text-skin-ink">↑↓</kbd> navigate</span>
              <span><kbd className="text-skin-ink">Enter</kbd> next</span>
              <span><kbd className="text-skin-ink">⌘↩</kbd> submit</span>
              <span><kbd className="text-skin-ink">Esc</kbd> cancel</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface RowProps {
  index: number
  field: Field
  value: string
  isActive: boolean
  isErasing: boolean
  isCollapsed: boolean
  onChange: (v: string) => void
  onFocus: () => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  inputRef: (el: HTMLInputElement | null) => void
}

function Row({
  index,
  field,
  value,
  isActive,
  isErasing,
  isCollapsed,
  onChange,
  onFocus,
  onKeyDown,
  inputRef,
}: RowProps) {
  return (
    <motion.div
      animate={
        isCollapsed
          ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 }
          : { height: 'auto', opacity: 1 }
      }
      transition={{ duration: 0.35, ease: 'easeInOut' }}
      style={{ overflow: 'hidden' }}
      className={[
        'group flex items-center gap-4 rounded-xl px-4 py-3 transition-colors',
        isActive ? 'bg-skin-surface-2 ring-1 ring-skin-accent/60' : 'hover:bg-skin-surface-2/40',
      ].join(' ')}
    >
      <div className="w-8 h-8 shrink-0 rounded-md bg-skin-surface-2 flex items-center justify-center text-skin-muted font-mono text-sm">
        {index + 1}
      </div>

      <div className="flex-1 min-w-0 grid grid-cols-[200px_1fr] items-center gap-4">
        {isErasing ? (
          // When erasing, render the joined "label  value" as flying chars.
          <CharFly
            className="col-span-2 text-skin-ink"
            text={`${field.label}    ${value || field.placeholder}`}
            mono={field.mono}
          />
        ) : (
          <>
            <div className="text-sm text-skin-ink/85 truncate">{field.label}</div>
            <input
              ref={inputRef}
              data-testid={`rs-input-${field.key}`}
              type={field.type}
              value={value}
              placeholder={field.placeholder}
              onChange={(e) => onChange(e.target.value)}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              autoComplete="off"
              className={[
                'w-full bg-transparent border-0 outline-none text-skin-ink placeholder:text-skin-muted/70',
                field.mono ? 'font-mono text-[15px]' : 'text-[15px]',
              ].join(' ')}
            />
          </>
        )}
      </div>

      <div className="w-5 flex justify-end text-skin-muted">
        <AnimatePresence>
          {isActive && !isErasing && (
            <motion.span
              key="enter"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <CornerDownLeft size={14} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

interface CharFlyProps {
  text: string
  className?: string
  mono?: boolean
}

// Each char dematerializes into PARTICLES_PER_CHAR small peach blocks that
// scatter radially. All chars (and all rows) animate simultaneously — the
// row "puffs out". No convergence target.
const PARTICLES_PER_CHAR = 3

function CharFly({ text, className, mono }: CharFlyProps) {
  const chars = useMemo(() => Array.from(text), [text])
  const particles = useMemo(
    () =>
      chars.flatMap(() =>
        Array.from({ length: PARTICLES_PER_CHAR }, () => {
          const angle = Math.random() * Math.PI * 2
          const dist = 28 + Math.random() * 60
          return {
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist,
            rot: (Math.random() - 0.5) * 140,
            delay: Math.random() * 0.05,
          }
        }),
      ),
    [chars],
  )

  return (
    <div
      className={[
        'col-span-2 leading-snug whitespace-pre',
        mono ? 'font-mono text-[15px]' : 'text-[15px]',
        className ?? '',
      ].join(' ')}
    >
      {chars.map((ch, i) => (
        <span key={i} data-char className="relative inline-block align-baseline">
          {/* The original glyph fades out fast so the particle blocks are what reads. */}
          <motion.span
            className="inline-block"
            initial={{ opacity: 1, color: '#4A3728' }}
            animate={{ opacity: 0, color: '#D89B7A' }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {ch === ' ' ? '\u00a0' : ch}
          </motion.span>
          {Array.from({ length: PARTICLES_PER_CHAR }, (_, k) => {
            const p = particles[i * PARTICLES_PER_CHAR + k]
            return (
              <motion.span
                key={k}
                aria-hidden
                className="absolute top-1/2 left-1/2 w-[5px] h-[5px] rounded-[1.5px] bg-skin-accent pointer-events-none"
                initial={{ opacity: 0, x: -2.5, y: -2.5, scale: 1, rotate: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  x: p.x,
                  y: p.y,
                  scale: [1, 0.9, 0.3],
                  rotate: p.rot,
                }}
                transition={{
                  duration: 0.6,
                  ease: [0.32, 0, 0.32, 1],
                  delay: 0.08 + p.delay,
                  times: [0, 0.25, 1],
                }}
              />
            )
          })}
        </span>
      ))}
    </div>
  )
}
