import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createRef } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ObservationComposerPreview } from "@/observation/ObservationComposerSlot"
import { PromptForm } from "../PromptForm"

describe("PromptForm component", () => {
  it("renders textarea with placeholder", () => {
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )
    expect(screen.getByPlaceholderText("Ask anything…")).toBeInTheDocument()
    expect(screen.getByLabelText("Send message")).toBeDisabled()
  })

  it("enables send button when text is typed and submits on Enter", () => {
    const handleSubmit = vi.fn()
    render(
      <PromptForm
        onSubmit={handleSubmit}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(textarea, { target: { value: "Draft a post about AI" } })

    const sendBtn = screen.getByLabelText("Send message")
    expect(sendBtn).not.toBeDisabled()

    // Press Enter to submit
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false })
    expect(handleSubmit).toHaveBeenCalledWith("Draft a post about AI")
    expect(textarea).toHaveValue("")
  })

  it("keeps the prompt when submit explicitly rejects the turn", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(false)
    render(<PromptForm onSubmit={handleSubmit} placeholder="Ask anything…" />)
    const input = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(input, { target: { value: "What is on this page?" } })
    fireEvent.submit(input.closest("form")!)

    await waitFor(() => expect(input).toHaveValue("What is on this page?"))
  })

  it("does not submit on Shift+Enter", () => {
    const handleSubmit = vi.fn()
    render(
      <PromptForm
        onSubmit={handleSubmit}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(textarea, { target: { value: "Line 1" } })
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it("submits multiline prompt on Cmd+Enter or Ctrl+Enter", () => {
    const handleSubmit = vi.fn()
    render(
      <PromptForm
        onSubmit={handleSubmit}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(textarea, { target: { value: "Line 1\nLine 2" } })

    // Cmd+Enter (Mac)
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true })
    expect(handleSubmit).toHaveBeenCalledWith("Line 1\nLine 2")
    expect(textarea).toHaveValue("")

    // Ctrl+Enter (Windows/Linux)
    fireEvent.change(textarea, { target: { value: "Multiline text" } })
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true })
    expect(handleSubmit).toHaveBeenCalledWith("Multiline text")
  })

  it("shows stop button when isBusy is true and calls onStop", () => {
    const handleStop = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onStop={handleStop}
        isBusy={true}
        placeholder="Ask anything…"
      />,
    )

    const stopBtn = screen.getByLabelText("Stop generating")
    expect(stopBtn).toBeInTheDocument()
    fireEvent.click(stopBtn)
    expect(handleStop).toHaveBeenCalledTimes(1)
  })

  it("renders extra actions and children", () => {
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        isBusy={false}
        actions={<button type="button">Upload Image</button>}
      />,
    )
    expect(screen.getByText("Upload Image")).toBeInTheDocument()
  })

  it("adds images and browser tabs from the composer plus menu", async () => {
    const onStart = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        observationSlot={{
          view: {
            isConnected: false,
            hasCurrentFrame: false,
            status: "Browser tab context is off.",
          },
          videoRef: vi.fn(),
          onStart,
          onStop: vi.fn(),
          onReset: vi.fn(),
        }}
      />,
    )

    const trigger = screen.getByRole("button", {
      name: "Add attachment or browser tab",
    })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" })
    fireEvent.click(trigger)
    expect(
      await screen.findByRole("menuitem", { name: "Images" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: "Browser tab" }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: "Browser tab" }))
    expect(onStart).toHaveBeenCalledOnce()
  })

  it("offers a stop action in the plus menu while browser sharing is active", async () => {
    const onStop = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        observationSlot={{
          view: {
            isConnected: true,
            hasCurrentFrame: true,
            status: "Browser tab is ready.",
          },
          videoRef: vi.fn(),
          onStart: vi.fn(),
          onStop,
          onReset: vi.fn(),
        }}
      />,
    )

    const trigger = screen.getByRole("button", {
      name: "Add attachment or browser tab",
    })
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" })
    fireEvent.click(trigger)
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Stop sharing browser tab" }),
    )
    expect(onStop).toHaveBeenCalledOnce()
  })

  it("shares the persistent plus trigger with the floating preview stop button", () => {
    const addContextButtonRef = createRef<HTMLButtonElement>()
    const onStop = vi.fn()
    const view = {
      isConnected: true,
      hasCurrentFrame: true,
      status: "Browser tab is ready.",
    }
    const slotProps = {
      view,
      videoRef: vi.fn(),
      onStart: vi.fn(),
      onStop,
      onReset: vi.fn(),
      addContextButtonRef,
    }
    render(
      <>
        <PromptForm
          onSubmit={vi.fn()}
          observationSlot={slotProps}
          addContextButtonRef={addContextButtonRef}
        />
        <ObservationComposerPreview {...slotProps} />
      </>,
    )

    const stopButton = screen.getByRole("button", {
      name: "Stop sharing browser tab",
    })
    stopButton.focus()
    fireEvent.click(stopButton)
    expect(onStop).toHaveBeenCalledOnce()
    expect(addContextButtonRef.current).toHaveFocus()
  })

  it("disables Send until the attached browser tab has a current frame", () => {
    render(
      <PromptForm
        onSubmit={vi.fn()}
        initialValue="Read this page"
        observationSlot={{
          view: {
            isConnected: true,
            hasCurrentFrame: false,
            isPaused: true,
            status: "Browser tab sharing is paused.",
          },
          videoRef: vi.fn(),
          onStart: vi.fn(),
          onStop: vi.fn(),
          onReset: vi.fn(),
        }}
      />,
    )

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()
  })

  it("submits attached images alongside prompt text", () => {
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:preview-1")
    window.URL.revokeObjectURL = vi.fn()

    const handleSubmit = vi.fn()
    const { container } = render(
      <PromptForm
        onSubmit={handleSubmit}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )

    const file = new File(["dummy content"], "chart.png", { type: "image/png" })
    const fileInput = container.querySelector(
      "input[type='file']",
    ) as HTMLInputElement
    expect(fileInput).toBeInTheDocument()

    fireEvent.change(fileInput, { target: { files: [file] } })

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(textarea, { target: { value: "Analyze this chart" } })

    const sendBtn = screen.getByLabelText("Send message")
    fireEvent.click(sendBtn)

    expect(handleSubmit).toHaveBeenCalledWith("Analyze this chart", [file])
    // Verify blob URL was revoked on clear
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1")
  })

  it("filters out non-image files and files larger than 10MB", () => {
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:preview-valid")
    window.URL.revokeObjectURL = vi.fn()

    const { container } = render(
      <PromptForm
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        isBusy={false}
        placeholder="Ask anything…"
      />,
    )

    const fileInput = container.querySelector(
      "input[type='file']",
    ) as HTMLInputElement

    const validImg = new File(["valid"], "photo.jpg", { type: "image/jpeg" })
    const pdfFile = new File(["pdf content"], "doc.pdf", {
      type: "application/pdf",
    })
    // 11MB file
    const hugeImg = new File([new ArrayBuffer(11 * 1024 * 1024)], "huge.png", {
      type: "image/png",
    })

    fireEvent.change(fileInput, {
      target: { files: [validImg, pdfFile, hugeImg] },
    })

    // Only validImg should be accepted (createObjectURL called once)
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(validImg)
  })

  it("triggers onEditLastUserMessage when ArrowUp is pressed on empty input", () => {
    const handleEditLast = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onEditLastUserMessage={handleEditLast}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(handleEditLast).toHaveBeenCalledTimes(1)
  })

  it("does not trigger onEditLastUserMessage when composer contains text or modifier keys", () => {
    const handleEditLast = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onEditLastUserMessage={handleEditLast}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText("Ask anything…")
    fireEvent.change(textarea, { target: { value: "some text" } })
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(handleEditLast).not.toHaveBeenCalled()

    // Test with modifier keys on empty input
    fireEvent.change(textarea, { target: { value: "" } })
    fireEvent.keyDown(textarea, { key: "ArrowUp", shiftKey: true })
    expect(handleEditLast).not.toHaveBeenCalled()
  })

  it("recalls last user prompt into composer when ArrowUp is pressed on empty input and onRecallLastPrompt is provided", () => {
    const handleRecallLastPrompt = vi
      .fn()
      .mockReturnValue("Recalled previous prompt")
    const handleEditLast = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onEditLastUserMessage={handleEditLast}
        onRecallLastPrompt={handleRecallLastPrompt}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText(
      "Ask anything…",
    ) as HTMLTextAreaElement
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(handleRecallLastPrompt).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe("Recalled previous prompt")
    expect(handleEditLast).not.toHaveBeenCalled()
  })

  it("does not update input when onRecallLastPrompt returns null or empty string", () => {
    const handleRecallLastPrompt = vi.fn().mockReturnValue(null)
    const handleEditLast = vi.fn()
    render(
      <PromptForm
        onSubmit={vi.fn()}
        onEditLastUserMessage={handleEditLast}
        onRecallLastPrompt={handleRecallLastPrompt}
        placeholder="Ask anything…"
      />,
    )

    const textarea = screen.getByPlaceholderText(
      "Ask anything…",
    ) as HTMLTextAreaElement
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(handleRecallLastPrompt).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe("")
    expect(handleEditLast).not.toHaveBeenCalled()
  })

  it("attaches image when pasted from clipboard into textarea", () => {
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:preview-paste")
    window.URL.revokeObjectURL = vi.fn()

    const handleSubmit = vi.fn()
    render(<PromptForm onSubmit={handleSubmit} placeholder="Ask anything…" />)

    const textarea = screen.getByPlaceholderText("Ask anything…")
    const imageFile = new File(["paste-bytes"], "clipboard.png", {
      type: "image/png",
    })

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => imageFile,
          },
        ],
        files: [imageFile],
        types: ["Files"],
      },
    })

    fireEvent(textarea, pasteEvent)

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(imageFile)
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it("attaches image files when dropped onto composer", () => {
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:preview-drop")
    window.URL.revokeObjectURL = vi.fn()

    const { container } = render(
      <PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />,
    )

    const form =
      container.querySelector("form") || (container.firstChild as HTMLElement)
    const dropFile = new File(["drop-bytes"], "dropped.jpg", {
      type: "image/jpeg",
    })

    fireEvent.dragOver(form, { dataTransfer: { types: ["Files"] } })
    fireEvent.drop(form, {
      dataTransfer: {
        files: [dropFile],
        types: ["Files"],
      },
    })

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(dropFile)
  })

  describe("adversarial edge cases", () => {
    let blobCounter = 0

    beforeEach(() => {
      blobCounter = 0
      window.URL.createObjectURL = vi
        .fn()
        .mockImplementation(() => `blob:mock-preview-${++blobCounter}`)
      window.URL.revokeObjectURL = vi.fn()
    })

    function makeFile(
      name: string,
      sizeBytes = 1024,
      type = "image/png",
    ): File {
      return new File([new ArrayBuffer(sizeBytes)], name, { type })
    }

    function createPasteEvent({
      items,
      files,
      clipboardData,
    }: {
      items?: { kind?: string; type?: string; getAsFile?: () => File | null }[]
      files?: File[]
      clipboardData?: Record<string, unknown> | null
    }) {
      const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
      if (clipboardData !== undefined) {
        Object.defineProperty(pasteEvent, "clipboardData", {
          value: clipboardData,
          configurable: true,
        })
      } else {
        Object.defineProperty(pasteEvent, "clipboardData", {
          value: {
            items: items ?? [],
            files: files ?? [],
            types: items ? items.map((i) => i.type || "") : [],
          },
          configurable: true,
        })
      }
      return pasteEvent
    }

    it("rejects pasting when max image limit (5) is already reached", () => {
      const handleSubmit = vi.fn()
      render(<PromptForm onSubmit={handleSubmit} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")

      // Attach 5 images in first paste
      const fiveImages = Array.from({ length: 5 }, (_, i) =>
        makeFile(`img-${i}.png`),
      )
      const firstPaste = createPasteEvent({
        items: fiveImages.map((file) => ({
          kind: "file",
          type: "image/png",
          getAsFile: () => file,
        })),
        files: fiveImages,
      })
      fireEvent(textarea, firstPaste)

      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(5)

      // Try pasting 6th image
      const sixthImage = makeFile("sixth.png")
      const secondPaste = createPasteEvent({
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => sixthImage,
          },
        ],
        files: [sixthImage],
      })
      fireEvent(textarea, secondPaste)

      // createObjectURL should still be called only 5 times
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(5)

      // Submit and verify only 5 images are sent
      const sendBtn = screen.getByLabelText("Send message")
      fireEvent.click(sendBtn)
      expect(handleSubmit).toHaveBeenCalledWith("", fiveImages)
    })

    it("truncates batch to remaining slots when pasting exceeds max image limit", () => {
      const handleSubmit = vi.fn()
      render(<PromptForm onSubmit={handleSubmit} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const sevenImages = Array.from({ length: 7 }, (_, i) =>
        makeFile(`batch-${i}.png`),
      )

      const batchPaste = createPasteEvent({
        items: sevenImages.map((file) => ({
          kind: "file",
          type: "image/png",
          getAsFile: () => file,
        })),
        files: sevenImages,
      })
      fireEvent(textarea, batchPaste)

      // Only first 5 should be accepted
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(5)

      const sendBtn = screen.getByLabelText("Send message")
      fireEvent.click(sendBtn)
      expect(handleSubmit).toHaveBeenCalledWith("", sevenImages.slice(0, 5))
    })

    it("does not block normal text pasting even when 5 images are attached", () => {
      render(<PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const fiveImages = Array.from({ length: 5 }, (_, i) =>
        makeFile(`img-${i}.png`),
      )

      fireEvent(
        textarea,
        createPasteEvent({
          items: fiveImages.map((file) => ({
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          })),
          files: fiveImages,
        }),
      )

      // Now paste plain text
      const textPaste = createPasteEvent({
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
          },
        ],
      })
      fireEvent(textarea, textPaste)

      // Text paste must NOT be prevented
      expect(textPaste.defaultPrevented).toBe(false)
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(5)
    })

    it("filters mixed paste items, accepting images and ignoring non-image files", () => {
      const handleSubmit = vi.fn()
      render(<PromptForm onSubmit={handleSubmit} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const jpegFile = makeFile("photo.jpg", 2048, "image/jpeg")
      const pdfFile = makeFile("doc.pdf", 4096, "application/pdf")
      const pngFile = makeFile("chart.png", 1024, "image/png")
      const csvFile = makeFile("data.csv", 512, "text/csv")

      const mixedPaste = createPasteEvent({
        items: [
          { kind: "file", type: "image/jpeg", getAsFile: () => jpegFile },
          { kind: "file", type: "application/pdf", getAsFile: () => pdfFile },
          { kind: "file", type: "image/png", getAsFile: () => pngFile },
          { kind: "file", type: "text/csv", getAsFile: () => csvFile },
        ],
        files: [jpegFile, pdfFile, pngFile, csvFile],
      })

      fireEvent(textarea, mixedPaste)

      expect(mixedPaste.defaultPrevented).toBe(true)
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2)
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(jpegFile)
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(pngFile)

      const sendBtn = screen.getByLabelText("Send message")
      fireEvent.click(sendBtn)
      expect(handleSubmit).toHaveBeenCalledWith("", [jpegFile, pngFile])
    })

    it("does not prevent default or attach anything when pasting non-image items only", () => {
      render(<PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const pdfFile = makeFile("doc.pdf", 4096, "application/pdf")

      const nonImagePaste = createPasteEvent({
        items: [
          { kind: "file", type: "application/pdf", getAsFile: () => pdfFile },
          { kind: "string", type: "text/plain", getAsFile: () => null },
        ],
        files: [pdfFile],
      })

      fireEvent(textarea, nonImagePaste)

      expect(nonImagePaste.defaultPrevented).toBe(false)
      expect(window.URL.createObjectURL).not.toHaveBeenCalled()
      expect(screen.getByLabelText("Send message")).toBeDisabled()
    })

    it("rejects huge images (> 10MB) on paste and accepts valid ones in same batch", () => {
      const handleSubmit = vi.fn()
      render(<PromptForm onSubmit={handleSubmit} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const validImg = makeFile("valid.png", 2 * 1024 * 1024, "image/png")
      const hugeImg = makeFile("huge.jpg", 11 * 1024 * 1024, "image/jpeg")

      const pasteEvent = createPasteEvent({
        items: [
          { kind: "file", type: "image/png", getAsFile: () => validImg },
          { kind: "file", type: "image/jpeg", getAsFile: () => hugeImg },
        ],
        files: [validImg, hugeImg],
      })

      fireEvent(textarea, pasteEvent)

      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(validImg)

      const sendBtn = screen.getByLabelText("Send message")
      fireEvent.click(sendBtn)
      expect(handleSubmit).toHaveBeenCalledWith("", [validImg])
    })

    it("handles null or undefined clipboardData gracefully without throwing", () => {
      render(<PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")

      // clipboardData is null
      const nullPaste = createPasteEvent({ clipboardData: null })
      expect(() => fireEvent(textarea, nullPaste)).not.toThrow()
      expect(nullPaste.defaultPrevented).toBe(false)

      // clipboardData is empty object
      const emptyPaste = createPasteEvent({ clipboardData: {} })
      expect(() => fireEvent(textarea, emptyPaste)).not.toThrow()
      expect(emptyPaste.defaultPrevented).toBe(false)
    })

    it("falls back to clipboardData.files when clipboardData.items is missing or empty", () => {
      render(<PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const fallbackFile = makeFile("fallback.png", 1024, "image/png")

      const pasteEvent = createPasteEvent({
        clipboardData: {
          items: [],
          files: [fallbackFile],
        },
      })

      fireEvent(textarea, pasteEvent)

      expect(window.URL.createObjectURL).toHaveBeenCalledWith(fallbackFile)
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
    })

    it("handles items with getAsFile throwing or returning null safely", () => {
      render(<PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const safeFile = makeFile("safe.png", 1024, "image/png")

      const errorPaste = createPasteEvent({
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => {
              throw new Error("Disk read failure")
            },
          },
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => null,
          },
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => safeFile,
          },
        ],
      })

      expect(() => fireEvent(textarea, errorPaste)).not.toThrow()
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(safeFile)
    })

    function createDragLeaveEvent(relatedTarget: EventTarget | null) {
      const event = new Event("dragleave", { bubbles: true, cancelable: true })
      Object.defineProperty(event, "relatedTarget", {
        value: relatedTarget,
        configurable: true,
      })
      return event
    }

    it("manages drag state transitions and resets on dragLeave when leaving container", () => {
      const { container } = render(
        <PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />,
      )

      const form =
        container.querySelector("form") || (container.firstChild as HTMLElement)
      const inputGroup = form.firstElementChild as HTMLElement

      // Drag over should activate dragging style
      fireEvent.dragOver(form, { dataTransfer: { types: ["Files"] } })
      expect(inputGroup.className).toContain("border-primary/80")

      // Drag leave with relatedTarget outside form resets dragging style
      fireEvent(form, createDragLeaveEvent(document.body))
      expect(inputGroup.className).not.toContain("border-primary/80")

      // Drag over again
      fireEvent.dragOver(form, { dataTransfer: { types: ["Files"] } })
      expect(inputGroup.className).toContain("border-primary/80")

      // Drag leave with relatedTarget null (leaving browser window) resets dragging style
      fireEvent(form, createDragLeaveEvent(null))
      expect(inputGroup.className).not.toContain("border-primary/80")
    })

    it("preserves isDragging state when dragLeave occurs onto a child within the form", () => {
      const { container } = render(
        <PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />,
      )

      const form =
        container.querySelector("form") || (container.firstChild as HTMLElement)
      const textarea = screen.getByPlaceholderText("Ask anything…")
      const inputGroup = form.firstElementChild as HTMLElement

      fireEvent.dragOver(form, { dataTransfer: { types: ["Files"] } })
      expect(inputGroup.className).toContain("border-primary/80")

      // Drag leave targeting the child textarea should NOT reset dragging
      fireEvent(form, createDragLeaveEvent(textarea))
      expect(inputGroup.className).toContain("border-primary/80")
    })

    it("resets isDragging and ignores non-image files on drop", () => {
      const { container } = render(
        <PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />,
      )

      const form =
        container.querySelector("form") || (container.firstChild as HTMLElement)
      const inputGroup = form.firstElementChild as HTMLElement
      const pdfFile = makeFile("doc.pdf", 4096, "application/pdf")

      fireEvent.dragOver(form, { dataTransfer: { types: ["Files"] } })
      expect(inputGroup.className).toContain("border-primary/80")

      fireEvent.drop(form, {
        dataTransfer: {
          files: [pdfFile],
          types: ["Files"],
        },
      })

      expect(inputGroup.className).not.toContain("border-primary/80")
      expect(window.URL.createObjectURL).not.toHaveBeenCalled()
    })

    it("handles drop gracefully when dataTransfer or dataTransfer.files is null/undefined", () => {
      const { container } = render(
        <PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />,
      )

      const form =
        container.querySelector("form") || (container.firstChild as HTMLElement)
      const inputGroup = form.firstElementChild as HTMLElement

      fireEvent.dragOver(form, { dataTransfer: { types: ["Files"] } })
      expect(inputGroup.className).toContain("border-primary/80")

      expect(() =>
        fireEvent.drop(form, {
          dataTransfer: null,
        }),
      ).not.toThrow()

      expect(inputGroup.className).not.toContain("border-primary/80")
    })

    it("allows removing an attached image via remove button and revokes preview URL", () => {
      render(<PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const img1 = makeFile("img1.png")
      const img2 = makeFile("img2.png")

      fireEvent(
        textarea,
        createPasteEvent({
          items: [
            { kind: "file", type: "image/png", getAsFile: () => img1 },
            { kind: "file", type: "image/png", getAsFile: () => img2 },
          ],
          files: [img1, img2],
        }),
      )

      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2)

      const removeButtons = screen.getAllByLabelText("Remove image")
      expect(removeButtons).toHaveLength(2)

      // Remove the first image
      fireEvent.click(removeButtons[0])

      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:mock-preview-1",
      )
      expect(screen.getAllByLabelText("Remove image")).toHaveLength(1)
    })

    it("allows submission of attached image with empty prompt text", () => {
      const handleSubmit = vi.fn()
      render(<PromptForm onSubmit={handleSubmit} placeholder="Ask anything…" />)

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const img1 = makeFile("photo.png")

      fireEvent(
        textarea,
        createPasteEvent({
          items: [{ kind: "file", type: "image/png", getAsFile: () => img1 }],
          files: [img1],
        }),
      )

      const sendBtn = screen.getByLabelText("Send message")
      expect(sendBtn).not.toBeDisabled()

      fireEvent.click(sendBtn)
      expect(handleSubmit).toHaveBeenCalledWith("", [img1])
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:mock-preview-1",
      )
    })

    it("revokes preview URLs on component unmount", () => {
      const { unmount } = render(
        <PromptForm onSubmit={vi.fn()} placeholder="Ask anything…" />,
      )

      const textarea = screen.getByPlaceholderText("Ask anything…")
      const img1 = makeFile("img1.png")

      fireEvent(
        textarea,
        createPasteEvent({
          items: [{ kind: "file", type: "image/png", getAsFile: () => img1 }],
          files: [img1],
        }),
      )

      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1)

      unmount()

      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:mock-preview-1",
      )
    })
  })
})

it("keeps newer draft text when an earlier submission is acknowledged", async () => {
  let acknowledge: (accepted: boolean) => void = () => {}
  const acknowledgement = new Promise<boolean>((resolve) => {
    acknowledge = resolve
  })
  render(
    <PromptForm
      onSubmit={() => acknowledgement}
      placeholder="Acknowledgement test"
    />,
  )
  const input = screen.getByPlaceholderText("Acknowledgement test")
  fireEvent.change(input, { target: { value: "First question" } })
  fireEvent.submit(input.closest("form")!)
  expect(input).toHaveValue("First question")
  fireEvent.change(input, { target: { value: "Next question" } })
  acknowledge(true)
  await waitFor(() => expect(input).toHaveValue("Next question"))
})
