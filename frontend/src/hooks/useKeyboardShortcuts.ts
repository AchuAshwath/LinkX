import * as React from "react"

export interface KeyboardShortcutsOptions {
  onToggleQuickSwitcher: () => void
  onNewChat: () => void
  onEscape?: () => void
  isEnabled?: boolean
}

function isModifierActive(event: KeyboardEvent): boolean {
  return event.metaKey !== event.ctrlKey
}

function isCommandKey(event: KeyboardEvent, targetKey: string): boolean {
  if (event.key?.toLowerCase() !== targetKey) return false
  if (event.shiftKey || event.altKey) return false
  return isModifierActive(event)
}

function isQuickSwitcherHotkey(event: KeyboardEvent): boolean {
  return isCommandKey(event, "k")
}

function isShiftCommandKey(event: KeyboardEvent, key: string): boolean {
  if (event.key?.toLowerCase() !== key) return false
  return event.shiftKey && isModifierActive(event)
}

function isAltKey(event: KeyboardEvent, key: string): boolean {
  if (event.key?.toLowerCase() !== key) return false
  return event.altKey && !event.metaKey && !event.ctrlKey
}

function isNewChatHotkey(event: KeyboardEvent): boolean {
  if (isShiftCommandKey(event, "o")) return true
  if (isAltKey(event, "n")) return true
  return isCommandKey(event, "n")
}

function isEscapeHotkey(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") return false
  if (event.shiftKey || event.altKey) return false
  return !event.metaKey && !event.ctrlKey
}

export function useKeyboardShortcuts({
  onToggleQuickSwitcher,
  onNewChat,
  onEscape,
  isEnabled = true,
}: KeyboardShortcutsOptions) {
  React.useEffect(() => {
    if (!isEnabled) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) return

      if (isQuickSwitcherHotkey(event)) {
        event.preventDefault()
        onToggleQuickSwitcher()
        return
      }

      if (isNewChatHotkey(event)) {
        event.preventDefault()
        onNewChat()
        return
      }

      if (isEscapeHotkey(event)) {
        onEscape?.()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isEnabled, onToggleQuickSwitcher, onNewChat, onEscape])
}
