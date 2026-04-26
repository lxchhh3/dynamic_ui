import { motion } from 'framer-motion'
import { Inbox } from 'lucide-react'
import RequestCard, { type RequestCardProps } from './RequestCard'

export interface RequestListProps {
  scope?: 'mine' | 'all-pending'
  requests: RequestCardProps[]
}

export default function RequestList({ scope, requests }: RequestListProps) {
  const heading = scope === 'all-pending' ? 'all requests' : 'my requests'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="surface rounded-xl p-4 max-w-md"
    >
      <div className="flex items-center gap-2 text-sm text-skin-muted font-mono mb-3">
        <Inbox size={15} className="text-skin-accent" />
        <span>{heading}</span>
        <span className="text-skin-muted/60">· {requests.length}</span>
      </div>

      {requests.length === 0 ? (
        <div className="text-sm text-skin-muted italic">no requests to show</div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <RequestCard key={r.id} {...r} />
          ))}
        </div>
      )}
    </motion.div>
  )
}
