import { useCallback, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import MessageList from '../components/MessageList'
import ChatInput from '../components/ChatInput'
import GatePanel from '../components/GatePanel'
import { useAuth } from '../stores/authStore'
import { useChat } from '../stores/chatStore'
import { useGates } from '../stores/gatesStore'
import { streamChat } from '../api/chat'

export default function Home() {
  const token = useAuth((s) => s.token)
  const { startUserTurn, appendBlock, finishTurn, sending } = useChat()
  const applyGate = useGates((s) => s.apply)

  const onSend = useCallback(
    async (message: string) => {
      if (!token || sending) return
      const turnId = startUserTurn(message)
      try {
        for await (const block of streamChat({ token, message })) {
          appendBlock(turnId, block)
          // Mirror any gate mutations into the side panel
          if (block.type === 'GateCard') {
            applyGate({
              id: block.props.id,
              label: block.props.label,
              status: block.props.status,
              animate: block.props.animate,
            })
          } else if (block.type === 'GateGrid') {
            for (const g of block.props.gates) {
              applyGate({ id: g.id, label: g.label, status: g.status })
            }
          }
        }
        finishTurn(turnId)
      } catch (err) {
        finishTurn(turnId, err instanceof Error ? err.message : String(err))
      }
    },
    [token, sending, startUserTurn, appendBlock, finishTurn, applyGate],
  )

  // Clear any transient chat on first mount if it somehow survived (Zustand stores are per-session).
  useEffect(() => {
    /* noop */
  }, [])

  return (
    <div className="min-h-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col border-r border-gate-border">
        <header className="px-6 py-3 border-b border-gate-border flex items-center justify-between">
          <div className="text-sm text-gate-muted font-mono">chat · tell the system what to do</div>
        </header>
        <MessageList />
        <div className="p-4 border-t border-gate-border">
          <ChatInput onSend={onSend} disabled={sending} />
        </div>
      </main>
      <aside className="w-[420px] shrink-0 flex flex-col">
        <div className="px-5 py-3 border-b border-gate-border text-sm text-gate-muted font-mono">
          gates · live
        </div>
        <GatePanel />
      </aside>
    </div>
  )
}
