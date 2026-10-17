import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useKeyboardShortcuts } from "../useKeyboardShortcuts"

describe("useKeyboardShortcuts", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("triggers onToggleQuickSwitcher on Cmd+K or Ctrl+K", () => {
    const onToggleQuickSwitcher = vi.fn()
    const onNewChat = vi.fn()

    renderHook(() =>
      useKeyboardShortcuts({
        onToggleQuickSwitcher,
        onNewChat,
      }),
    )

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
    )
    expect(onToggleQuickSwitcher).toHaveBeenCalledTimes(1)

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "K", ctrlKey: true }),
    )
    expect(onToggleQuickSwitcher).toHaveBeenCalledTimes(2)
  })

  it("triggers onNewChat on Cmd+N or Ctrl+N", () => {
    const onToggleQuickSwitcher = vi.fn()
    const onNewChat = vi.fn()

    renderHook(() =>
      useKeyboardShortcuts({
        onToggleQuickSwitcher,
        onNewChat,
      }),
    )

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", metaKey: true }),
    )
    expect(onNewChat).toHaveBeenCalledTimes(1)

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "N", ctrlKey: true }),
    )
    expect(onNewChat).toHaveBeenCalledTimes(2)
  })

  it("triggers onEscape when Escape key is pressed", () => {
    const onEscape = vi.fn()

    renderHook(() =>
      useKeyboardShortcuts({
        onToggleQuickSwitcher: vi.fn(),
        onNewChat: vi.fn(),
        onEscape,
      }),
    )

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it("does not trigger hotkeys when isEnabled is false", () => {
    const onToggleQuickSwitcher = vi.fn()
    const onNewChat = vi.fn()
    const onEscape = vi.fn()

    renderHook(() =>
      useKeyboardShortcuts({
        onToggleQuickSwitcher,
        onNewChat,
        onEscape,
        isEnabled: false,
      }),
    )

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
    )
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", metaKey: true }),
    )
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))

    expect(onToggleQuickSwitcher).not.toHaveBeenCalled()
    expect(onNewChat).not.toHaveBeenCalled()
    expect(onEscape).not.toHaveBeenCalled()
  })

  describe("adversarial edge cases", () => {
    it("rejects multi-modifier chords (Shift, Alt, or simultaneous Meta+Ctrl)", () => {
      const onToggleQuickSwitcher = vi.fn()
      const onNewChat = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          onToggleQuickSwitcher,
          onNewChat,
        }),
      )

      // Cmd+Shift+K
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          shiftKey: true,
        }),
      )
      // Ctrl+Shift+K
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          shiftKey: true,
        }),
      )
      // Cmd+Alt+K
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, altKey: true }),
      )
      // Ctrl+Alt+K
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, altKey: true }),
      )
      // Cmd+Ctrl+K (both meta and ctrl active simultaneously)
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          ctrlKey: true,
        }),
      )
      expect(onToggleQuickSwitcher).not.toHaveBeenCalled()

      // Cmd+Shift+N
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          metaKey: true,
          shiftKey: true,
        }),
      )
      // Ctrl+Shift+N
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          ctrlKey: true,
          shiftKey: true,
        }),
      )
      // Cmd+Alt+N
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", metaKey: true, altKey: true }),
      )
      // Cmd+Ctrl+N
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          metaKey: true,
          ctrlKey: true,
        }),
      )
      expect(onNewChat).not.toHaveBeenCalled()
    })

    it("does not trigger hotkeys on plain keys without Cmd or Ctrl", () => {
      const onToggleQuickSwitcher = vi.fn()
      const onNewChat = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          onToggleQuickSwitcher,
          onNewChat,
        }),
      )

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "K" }))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "N" }))

      expect(onToggleQuickSwitcher).not.toHaveBeenCalled()
      expect(onNewChat).not.toHaveBeenCalled()
    })

    it("rejects Escape hotkey when modifiers are pressed", () => {
      const onEscape = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          onToggleQuickSwitcher: vi.fn(),
          onNewChat: vi.fn(),
          onEscape,
        }),
      )

      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", shiftKey: true }),
      )
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", ctrlKey: true }),
      )
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", altKey: true }),
      )
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", metaKey: true }),
      )

      expect(onEscape).not.toHaveBeenCalled()
    })

    it("ignores events during IME composition mode", () => {
      const onToggleQuickSwitcher = vi.fn()
      const onNewChat = vi.fn()
      const onEscape = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          onToggleQuickSwitcher,
          onNewChat,
          onEscape,
        }),
      )

      // IME composition with isComposing true
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          isComposing: true,
        }),
      )
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          metaKey: true,
          isComposing: true,
        }),
      )
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
        }),
      )

      // IME composition with keyCode 229
      const imeKeyCodeEvent = new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
      })
      Object.defineProperty(imeKeyCodeEvent, "keyCode", { value: 229 })
      window.dispatchEvent(imeKeyCodeEvent)

      expect(onToggleQuickSwitcher).not.toHaveBeenCalled()
      expect(onNewChat).not.toHaveBeenCalled()
      expect(onEscape).not.toHaveBeenCalled()
    })

    it("handles hotkeys when event target is an active input or textarea element", () => {
      const onToggleQuickSwitcher = vi.fn()
      const onNewChat = vi.fn()
      const onEscape = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          onToggleQuickSwitcher,
          onNewChat,
          onEscape,
        }),
      )

      const input = document.createElement("input")
      const textarea = document.createElement("textarea")
      document.body.appendChild(input)
      document.body.appendChild(textarea)

      // Cmd+K from inside input triggers quick switcher
      const inputCmdK = new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      input.dispatchEvent(inputCmdK)
      expect(onToggleQuickSwitcher).toHaveBeenCalledTimes(1)
      expect(inputCmdK.defaultPrevented).toBe(true)

      // Plain text typing inside input does NOT trigger quick switcher
      const inputPlainK = new KeyboardEvent("keydown", {
        key: "k",
        bubbles: true,
      })
      input.dispatchEvent(inputPlainK)
      expect(onToggleQuickSwitcher).toHaveBeenCalledTimes(1)

      // Cmd+N from inside textarea triggers new chat
      const textareaCmdN = new KeyboardEvent("keydown", {
        key: "n",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      textarea.dispatchEvent(textareaCmdN)
      expect(onNewChat).toHaveBeenCalledTimes(1)
      expect(textareaCmdN.defaultPrevented).toBe(true)

      // Escape from inside input triggers onEscape without canceling native behavior
      const inputEscape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
      input.dispatchEvent(inputEscape)
      expect(onEscape).toHaveBeenCalledTimes(1)

      document.body.removeChild(input)
      document.body.removeChild(textarea)
    })

    it("cleans up event listener on unmount", () => {
      const onToggleQuickSwitcher = vi.fn()

      const { unmount } = renderHook(() =>
        useKeyboardShortcuts({
          onToggleQuickSwitcher,
          onNewChat: vi.fn(),
        }),
      )

      unmount()

      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      )
      expect(onToggleQuickSwitcher).not.toHaveBeenCalled()
    })
  })
})
