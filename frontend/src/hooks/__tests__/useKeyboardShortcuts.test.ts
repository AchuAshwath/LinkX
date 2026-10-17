import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useKeyboardShortcuts } from "../useKeyboardShortcuts"

describe("useKeyboardShortcuts", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    { key: "k", modifier: "metaKey", target: "switcher" },
    { key: "K", modifier: "ctrlKey", target: "switcher" },
    { key: "n", modifier: "metaKey", target: "newChat" },
    { key: "N", modifier: "ctrlKey", target: "newChat" },
  ])("triggers $target on $modifier+$key", ({ key, modifier, target }) => {
    const onToggleQuickSwitcher = vi.fn()
    const onNewChat = vi.fn()

    renderHook(() =>
      useKeyboardShortcuts({
        onToggleQuickSwitcher,
        onNewChat,
      }),
    )

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, [modifier]: true }),
    )

    if (target === "switcher") {
      expect(onToggleQuickSwitcher).toHaveBeenCalledTimes(1)
      expect(onNewChat).not.toHaveBeenCalled()
    } else {
      expect(onNewChat).toHaveBeenCalledTimes(1)
      expect(onToggleQuickSwitcher).not.toHaveBeenCalled()
    }
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

      const invalidChords: Partial<KeyboardEventInit>[] = [
        { key: "k", metaKey: true, shiftKey: true },
        { key: "k", ctrlKey: true, shiftKey: true },
        { key: "k", metaKey: true, altKey: true },
        { key: "k", ctrlKey: true, altKey: true },
        { key: "k", metaKey: true, ctrlKey: true },
        { key: "n", metaKey: true, shiftKey: true },
        { key: "n", ctrlKey: true, shiftKey: true },
        { key: "n", metaKey: true, altKey: true },
        { key: "n", metaKey: true, ctrlKey: true },
      ]

      for (const chord of invalidChords) {
        window.dispatchEvent(new KeyboardEvent("keydown", chord))
      }

      expect(onToggleQuickSwitcher).not.toHaveBeenCalled()
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

      for (const key of ["k", "K", "n", "N"]) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }))
      }

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

      for (const modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey"]) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", [modifier]: true }),
        )
      }

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

      for (const key of ["k", "n", "Escape"]) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            metaKey: true,
            isComposing: true,
          }),
        )
      }

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

      const inputCmdK = new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      input.dispatchEvent(inputCmdK)
      expect(onToggleQuickSwitcher).toHaveBeenCalledTimes(1)
      expect(inputCmdK.defaultPrevented).toBe(true)

      const textareaCmdN = new KeyboardEvent("keydown", {
        key: "n",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      textarea.dispatchEvent(textareaCmdN)
      expect(onNewChat).toHaveBeenCalledTimes(1)
      expect(textareaCmdN.defaultPrevented).toBe(true)

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
