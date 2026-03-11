import * as React from "react"

const PERSONA_ID_KEY = "selectedPersonaId"

export function usePersona() {
  const [selectedPersonaId, setSelectedPersonaIdState] = React.useState<string>(
    () => localStorage.getItem(PERSONA_ID_KEY) || "",
  )

  const setSelectedPersonaId = React.useCallback((personaId: string) => {
    setSelectedPersonaIdState(personaId)
    if (personaId) {
      localStorage.setItem(PERSONA_ID_KEY, personaId)
      return
    }
    localStorage.removeItem(PERSONA_ID_KEY)
  }, [])

  return {
    selectedPersonaId,
    setSelectedPersonaId,
  }
}
