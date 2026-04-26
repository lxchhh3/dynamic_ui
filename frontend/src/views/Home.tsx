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

  const runMessage = useCallback(
    async (message: string, opts?: { silent?: boolean }) => {
      if (!token || sending) return
      const turnId = startUserTurn(message, opts)
      try {
        for await (const block of streamChat({ token, message })) {
          appendBlock(turnId, block)
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

  const onSend = useCallback((message: string) => runMessage(message), [runMessage])

  // Bridge: interactive blocks (e.g. RequestForm) dispatch this with a synthesized
  // chat message. Run silent so the user's chat history doesn't show text they
  // never typed.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string' && detail.trim()) {
        void runMessage(detail, { silent: true })
      }
    }
    window.addEventListener('cu:chat-send', handler)
    return () => window.removeEventListener('cu:chat-send', handler)
  }, [runMessage])

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <main className="relative flex-1 min-w-0 flex flex-col border-r border-skin-border">
        <header className="px-6 py-3 border-b border-skin-border flex items-center justify-between">
          <div className="text-sm text-skin-muted font-mono">chat · tell the system what to do</div>
        </header>
        <MessageList />
        <div className="p-4 border-t border-skin-border">
          <ChatInput onSend={onSend} disabled={sending} />
        </div>
      </main>
      <aside className="w-[420px] shrink-0 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-skin-border text-sm text-skin-muted font-mono">
          gates · live
        </div>
        <div className="flex-1 overflow-y-auto">
          <GatePanel />
        </div>
      </aside>
    </div>
  )
}
