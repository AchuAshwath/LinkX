import { useQuery } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"
import {
  type ModelsDataResponse,
  useAIModelSelection,
} from "@/hooks/useAIModelSelection"

export type AIChatFeedState = ReturnType<typeof useAIChatFeedState>

export interface AIChatContextValue {
  feedState: AIChatFeedState
  threads: ChatThreadPublic[]
  isThreadsLoading: boolean
  selectedModelId: string
  setSelectedModelId: (id: string) => void
  modelsData?: ModelsDataResponse
}

const AIChatContext = React.createContext<AIChatContextValue | null>(null)

export function useAIChatContext(): AIChatContextValue | null {
  return React.useContext(AIChatContext)
}

export interface AIChatUrlParams {
  threadId?: string
  prompt?: string
  autoRun?: boolean
}

export function getAIChatUrlParams(): AIChatUrlParams {
  if (typeof window === "undefined") return {}
  try {
    const params = new URLSearchParams(window.location.search)
    return {
      threadId: params.get("threadId") || undefined,
      prompt: params.get("prompt") || undefined,
      autoRun: params.get("autoRun") === "true",
    }
  } catch {
    return {}
  }
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const { selectedModelId, setSelectedModelId, modelsData } =
    useAIModelSelection()

  const { data: threadsData, isLoading: isThreadsLoading } = useQuery({
    queryKey: ["ai-threads"],
    queryFn: () => AiThreadsService.listChatThreads({ skip: 0, limit: 100 }),
  })

  const threads = React.useMemo(() => threadsData?.data ?? [], [threadsData])
  const urlParams = React.useMemo(() => getAIChatUrlParams(), [])

  const initialThreadId = urlParams.threadId

  const feedState = useAIChatFeedState({
    threads,
    selectedModelId,
    initialThreadId,
    isAutoRun: Boolean(urlParams.autoRun || urlParams.prompt),
  })

  const value = React.useMemo<AIChatContextValue>(
    () => ({
      feedState,
      threads,
      isThreadsLoading,
      selectedModelId,
      setSelectedModelId,
      modelsData,
    }),
    [
      feedState,
      threads,
      isThreadsLoading,
      selectedModelId,
      setSelectedModelId,
      modelsData,
    ],
  )

  return (
    <AIChatContext.Provider value={value}>{children}</AIChatContext.Provider>
  )
}
