import type { ReactElement } from 'react'
import type { GateStatus, GateAnimation } from './GateCard'
import GateCardBlock from './GateCard'
import AssistantMessage from './AssistantMessage'
import Toast from './Toast'
import GateGrid from './GateGrid'
import AccessList from './AccessList'
import Alert from './Alert'

export type AssistantMessageBlock = {
  type: 'AssistantMessage'
  props: { text: string }
}

export type GateCardBlockT = {
  type: 'GateCard'
  props: { id: number; label: string; status: GateStatus; animate?: GateAnimation }
}

export type GateGridBlock = {
  type: 'GateGrid'
  props: { gates: { id: number; label: string; status: GateStatus }[] }
}

export type AccessListBlock = {
  type: 'AccessList'
  props: {
    gateId: number
    gateLabel: string
    users: { username: string; role: string }[]
  }
}

export type ToastBlock = {
  type: 'Toast'
  props: { variant: 'success' | 'denied' | 'error'; text: string }
}

export type AlertBlock = {
  type: 'Alert'
  props: { message: string; severity?: 'info' | 'warning' | 'error' }
}

export type Block =
  | AssistantMessageBlock
  | GateCardBlockT
  | GateGridBlock
  | AccessListBlock
  | ToastBlock
  | AlertBlock

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComp = (p: any) => ReactElement

const registry: Record<Block['type'], AnyComp> = {
  AssistantMessage: AssistantMessage as AnyComp,
  GateCard: GateCardBlock as AnyComp,
  GateGrid: GateGrid as AnyComp,
  AccessList: AccessList as AnyComp,
  Toast: Toast as AnyComp,
  Alert: Alert as AnyComp,
}

// Handler-identifier allowlist. LLM-picked handler names are looked up here;
// unknown names are dropped silently. Scenario 1 (gate control) has no interactive
// blocks, so this is empty. Future scenarios register their handlers by adding
// entries like `submitForm: () => ...`.
export const handlerAllowlist: Record<string, (...args: unknown[]) => void> = {}

// Defense-in-depth: strip payload-shaped substrings from string props before render.
// The LLM validator already emits `dangerous_substring` warnings and the backend
// adapter drops those values, but if anything slips through, this catches it.
// React escapes text by default, so this is mainly protection for any prop that
// ever gets passed into an href/src/style.
const DANGEROUS = /<script|javascript:|data:text\/html|on\w+\s*=|<iframe|document\.cookie|eval\s*\(/i

function sanitizeProps<T>(props: T): T {
  if (!props || typeof props !== 'object') return props
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (typeof v === 'string' && DANGEROUS.test(v)) continue
    out[k] = v
  }
  return out as T
}

export function BlockRenderer({ block }: { block: Block }) {
  const Comp = registry[block.type]
  if (!Comp) {
    return (
      <pre className="text-xs text-gate-locked font-mono bg-gate-surface/50 p-2 rounded">
        unknown block: {JSON.stringify(block)}
      </pre>
    )
  }
  return <Comp {...sanitizeProps(block.props)} />
}
