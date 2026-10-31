import type { QueuedTurn } from "@/components/Chat/types"
import type { StreamEventHandlers } from "@/hooks/useAIChatStream"
import type { BrowserReadingSession } from "./session"

interface DeliveryOptions {
  turn: QueuedTurn
  session?: BrowserReadingSession
  handlers: StreamEventHandlers
}

export function connectBrowserQuestion({
  turn,
  session,
  handlers,
}: DeliveryOptions) {
  const id = turn.browserQuestion?.operation_id
  let receiptReceived = false
  const current = () =>
    id ? Boolean(session?.isPreparedQuestionActive(id)) : false
  const interrupt = () => {
    if (current()) void session?.interruptQuestion(id)
  }
  if (id && session) {
    const normal = { ...handlers }
    handlers.onBrowserStatus = (status) => {
      if (status.operation_id !== id) return
      if (status.state === "processing") turn.onAcknowledged?.(true)
    }
    handlers.onTextDelta = (text) => {
      turn.onAcknowledged?.(true)
      normal.onTextDelta?.(text)
    }
    handlers.onBrowserDispatch = (operationId) => {
      session.markQuestionDispatched(operationId)
    }
    handlers.onBrowserRejected = (operationId) => {
      if (operationId === id) session.rejectQuestion(operationId)
    }
    handlers.onBrowserNote = (note) => {
      if (current()) session.receiveNote(note, id)
    }
    handlers.onBrowserActivity = (activity) => {
      if (current()) normal.onBrowserActivity?.(activity)
    }
    handlers.onBrowserReceipt = (receipt) => {
      if (receipt.operation_id !== id) return
      if (!current()) return
      receiptReceived = true
      session.finishQuestion(receipt)
    }
    handlers.onDone = () => {
      normal.onDone?.()
      if (!receiptReceived) interrupt()
    }
    handlers.onError = (error) => {
      turn.onAcknowledged?.(false)
      normal.onError?.(error)
      interrupt()
    }
    handlers.onAbort = () => {
      turn.onAcknowledged?.(false)
      normal.onAbort?.()
      interrupt()
    }
  }
  return {
    canDispatch() {
      if (!id) return true
      if (turn.requestId !== id) return false
      return current()
    },
    finish() {
      turn.onAcknowledged?.(false)
      if (!receiptReceived) interrupt()
    },
  }
}
