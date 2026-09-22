import { useQuery } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService } from "@/client"

const AI_MODEL_STORAGE_KEY = "linkx_ai_selected_model"

export interface ModelsDataResponse {
  default_model?: string | null
  data?: { id: string; name?: string }[]
}

function getStoredModel(): string | null {
  try {
    return window?.localStorage?.getItem(AI_MODEL_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function persistStoredModel(modelId: string): void {
  try {
    window?.localStorage?.setItem(AI_MODEL_STORAGE_KEY, modelId)
  } catch {
    // ignore storage access errors
  }
}

function resolveFallbackModel(modelsData?: ModelsDataResponse): string {
  return modelsData?.default_model || modelsData?.data?.[0]?.id || ""
}

function computeReconciledModel(
  modelsData?: ModelsDataResponse,
): string | null {
  if (!modelsData) return null
  const available = modelsData.data ?? []
  if (available.length === 0) return null
  const saved = getStoredModel()
  const isSavedAvailable = Boolean(
    saved && available.some((m) => m.id === saved),
  )
  if (!isSavedAvailable) {
    return resolveFallbackModel(modelsData)
  }
  return null
}

export function useAIModelSelection() {
  const { data: modelsData } = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => AiThreadsService.listAiModels(),
  })

  const [selectedModelId, setSelectedModelIdState] = React.useState<string>(
    () => getStoredModel() || "",
  )

  const setSelectedModelId = React.useCallback((modelId: string) => {
    setSelectedModelIdState(modelId)
    persistStoredModel(modelId)
  }, [])

  React.useEffect(() => {
    const nextModel = computeReconciledModel(modelsData)
    if (nextModel) {
      setSelectedModelId(nextModel)
    }
  }, [modelsData, setSelectedModelId])

  return { selectedModelId, setSelectedModelId, modelsData }
}
