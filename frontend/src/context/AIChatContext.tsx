import { useQuery } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"
import {
  type ModelsDataResponse,
  useAIModelSelection,
} from "@/hooks/useAIModelSelection"
import { createBrowserReadingCapture } from "@/observation/reading/capture"
import { installBrowserReadingDebug } from "@/observation/reading/debug"
import { createBrowserMemory } from "@/observation/reading/memory"
import { createBrowserReadingSession } from "@/observation/reading/session"
import { createBrowserReadingTransport } from "@/observation/reading/transport"

export type AIChatFeedState = ReturnType<typeof useAIChatFeedState>

export interface AIChatContextValue {
  feedState: AIChatFeedState
  threads: ChatThreadPublic[]
  isThreadsLoading: boolean
  selectedModelId: string
  setSelectedModelId: (id: string) => void
  modelsData?: ModelsDataResponse
  browserReading: ReturnType<typeof createBrowserReadingSession>
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

function areChatUrlParamsEqual(
  a: AIChatUrlParams,
  b: AIChatUrlParams,
): boolean {
  if (a.threadId !== b.threadId) return false
  if (a.prompt !== b.prompt) return false
  if (a.autoRun !== b.autoRun) return false
  return true
}

export function useAIChatUrlParams(): AIChatUrlParams {
  const [params, setParams] = React.useState<AIChatUrlParams>(() =>
    getAIChatUrlParams(),
  )

  React.useEffect(() => {
    function handleUpdate() {
      setParams(getAIChatUrlParams())
    }
    window.addEventListener("popstate", handleUpdate)
    return () => window.removeEventListener("popstate", handleUpdate)
  }, [])

  const current = getAIChatUrlParams()
  if (!areChatUrlParamsEqual(current, params)) {
    return current
  }

  return params
}

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const { selectedModelId, setSelectedModelId, modelsData } =
    useAIModelSelection()
  const [readingRuntime] = React.useState(() => {
    const memory = createBrowserMemory({ maxBytes: 32768, keepRecent: 3 })
    const browserReading = createBrowserReadingSession({
      capture: createBrowserReadingCapture(),
      transport: createBrowserReadingTransport(),
      memory,
    })
    return { browserReading, memory }
  })
  const { browserReading, memory } = readingRuntime

  React.useEffect(() => {
    if (!import.meta.env.DEV) return
    return installBrowserReadingDebug({ session: browserReading, memory })
  }, [browserReading, memory])

  React.useEffect(() => () => browserReading.stop(), [browserReading])

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
    setSelectedModelId,
    initialThreadId,
    isAutoRun: Boolean(urlParams.autoRun || urlParams.prompt),
    browserReading,
  })

  const value = React.useMemo<AIChatContextValue>(
    () => ({
      feedState,
      threads,
      isThreadsLoading,
      selectedModelId,
      setSelectedModelId,
      modelsData,
      browserReading,
    }),
    [
      feedState,
      threads,
      isThreadsLoading,
      selectedModelId,
      setSelectedModelId,
      modelsData,
      browserReading,
    ],
  )

  return (
    <AIChatContext.Provider value={value}>{children}</AIChatContext.Provider>
  )
}
