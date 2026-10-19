import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ChatUIMessage, QueuedTurn } from "@/components/Chat/types"
import type { ObservationPacket } from "@/observation/packet"
import {
  applyOptimisticTurn,
  resolveTargetThreadId,
  useChatTurnSender,
} from "../useChatTurnSender"

describe("resolveTargetThreadId", () => {
  it("keeps an exact active target without creating or reporting a new thread", async () => {
    const onThreadCreated = vi.fn()
    const setActiveThreadId = vi.fn()
    const createThreadMutation = { mutateAsync: vi.fn() }

    await expect(
      resolveTargetThreadId({
        activeThreadId: "selected-thread",
        promptText: "question",
        createThreadMutation: createThreadMutation as never,
        setActiveThreadId,
        onThreadCreated,
      }),
    ).resolves.toBe("selected-thread")

    expect(createThreadMutation.mutateAsync).not.toHaveBeenCalled()
    expect(onThreadCreated).not.toHaveBeenCalled()
    expect(setActiveThreadId).not.toHaveBeenCalled()
  })

  it("reports a created target before selecting it", async () => {
    const onThreadCreated = vi.fn()
    const setActiveThreadId = vi.fn()
    const createThreadMutation = {
      mutateAsync: vi.fn().mockResolvedValue({ id: "created-thread" }),
    }

    await expect(
      resolveTargetThreadId({
        activeThreadId: null,
        promptText: "question",
        createThreadMutation: createThreadMutation as never,
        setActiveThreadId,
        onThreadCreated,
      }),
    ).resolves.toBe("created-thread")

    expect(onThreadCreated).toHaveBeenCalledWith("created-thread")
    expect(onThreadCreated.mock.invocationCallOrder[0]).toBeLessThan(
      setActiveThreadId.mock.invocationCallOrder[0],
    )
  })

  it("does not report a target when thread creation fails", async () => {
    const onThreadCreated = vi.fn()
    const setActiveThreadId = vi.fn()
    const createThreadMutation = {
      mutateAsync: vi.fn().mockRejectedValue(new Error("create failed")),
    }

    await expect(
      resolveTargetThreadId({
        activeThreadId: null,
        promptText: "question",
        createThreadMutation: createThreadMutation as never,
        setActiveThreadId,
        onThreadCreated,
      }),
    ).resolves.toBeNull()

    expect(onThreadCreated).not.toHaveBeenCalled()
    expect(setActiveThreadId).not.toHaveBeenCalled()
  })
})

describe("useChatTurnSender observation payload", () => {
  it("preserves the captured packet unchanged in the queued turn", async () => {
    const observation: Readonly<ObservationPacket> = Object.freeze({
      session_id: "session-8",
      source_epoch: 2,
      revision: 19,
      captured_at: "2026-10-18T08:00:00.000Z",
      delivered_at: "2026-10-18T08:00:00.020Z",
      frame_presented_at_ms: 1234,
      width: 640,
      height: 480,
      image_data_url: "data:image/jpeg;base64,QUJD",
    })
    const queuedTurns: QueuedTurn[] = []
    const { result } = renderHook(() =>
      useChatTurnSender({
        activeThreadId: "thread-1",
        selectedModelId: "vision-model",
        isStreaming: false,
        streamingThreadId: null,
        setActiveThreadId: vi.fn(),
        setMessagesByThread: vi.fn(),
        setPendingQuestion: vi.fn(),
        clearThreadDraft: vi.fn(),
        createThreadMutation: { mutateAsync: vi.fn() } as never,
        enqueueTurn: (turn) => queuedTurns.push(turn),
        processQueue: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current(
        "What is on this page?",
        undefined,
        undefined,
        undefined,
        undefined,
        observation,
      )
    })

    expect(queuedTurns).toHaveLength(1)
    expect(queuedTurns[0].observation).toBe(observation)
    expect(Object.isFrozen(queuedTurns[0].observation)).toBe(true)
  })
})

describe("applyOptimisticTurn", () => {
  const userMsg: ChatUIMessage = {
    id: "user-new",
    role: "user",
    parts: [{ type: "text", text: "New prompt" }],
  }

  const assistantMsg: ChatUIMessage = {
    id: "asst-new",
    role: "assistant",
    parts: [],
    status: "streaming",
  }

  it("appends userMsg and assistantMsg when editMessageId is not provided", () => {
    const existing: ChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "First" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Resp 1" }],
      },
    ]

    const result = applyOptimisticTurn({
      messages: existing,
      userMsg,
      assistantMsg,
    })

    expect(result).toHaveLength(4)
    expect(result[2]).toBe(userMsg)
    expect(result[3]).toBe(assistantMsg)
  })

  it("non-destructively branches user message and links parentId", () => {
    const existing: ChatUIMessage[] = [
      {
        id: "u1",
        parentId: null,
        role: "user",
        parts: [{ type: "text", text: "First" }],
      },
      {
        id: "a1",
        parentId: "u1",
        role: "assistant",
        parts: [{ type: "text", text: "Resp 1" }],
      },
      {
        id: "u2",
        parentId: "a1",
        role: "user",
        parts: [{ type: "text", text: "Second" }],
      },
      {
        id: "a2",
        parentId: "u2",
        role: "assistant",
        parts: [{ type: "text", text: "Resp 2" }],
      },
    ]

    const editedUserMsg: ChatUIMessage = {
      id: "u1-v2",
      role: "user",
      parts: [{ type: "text", text: "Edited First" }],
    }

    const result = applyOptimisticTurn({
      messages: existing,
      userMsg: editedUserMsg,
      assistantMsg,
      editMessageId: "u1",
    })

    // Non-destructive: All 4 existing messages are preserved + 2 new messages (userMsg and assistantMsg)
    expect(result).toHaveLength(6)
    expect(result.slice(0, 4)).toEqual(existing)

    // New userMsg is a sibling of u1 (parentId === null)
    expect(result[4].id).toBe("u1-v2")
    expect(result[4].parentId).toBeNull()
    expect(result[4].forkedFromId).toBe("u1")

    // New assistantMsg is child of u1-v2
    expect(result[5].id).toBe("asst-new")
    expect(result[5].parentId).toBe("u1-v2")
  })

  it("non-destructively branches assistant turn on regenerate and links parentId", () => {
    const existing: ChatUIMessage[] = [
      {
        id: "u1",
        parentId: null,
        role: "user",
        parts: [{ type: "text", text: "First" }],
      },
      {
        id: "a1",
        parentId: "u1",
        role: "assistant",
        parts: [{ type: "text", text: "Resp 1" }],
      },
    ]

    const result = applyOptimisticTurn({
      messages: existing,
      userMsg,
      assistantMsg,
      editMessageId: "a1",
    })

    // Non-destructive: Both u1 and a1 preserved + new assistantMsg appended
    expect(result).toHaveLength(3)
    expect(result[0].id).toBe("u1")
    expect(result[1].id).toBe("a1")
    expect(result[2].id).toBe("asst-new")
    expect(result[2].parentId).toBe("u1")
  })

  it("falls back to appending when editMessageId is not found in messages", () => {
    const existing: ChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "First" }] },
    ]

    const result = applyOptimisticTurn({
      messages: existing,
      userMsg,
      assistantMsg,
      editMessageId: "non-existent-id",
    })

    expect(result).toHaveLength(3)
    expect(result[1]).toBe(userMsg)
    expect(result[2]).toBe(assistantMsg)
  })
})

describe("appendAssistantArtifact", () => {
  it("appends a new draft artifact when message has none", async () => {
    const { appendAssistantArtifact } = await import("../useChatTurnSender")
    const messages: ChatUIMessage[] = [
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
    ]
    const updated = appendAssistantArtifact({
      messages,
      assistantMsgId: "a1",
      artifactPart: {
        type: "draft_artifact",
        artifact: {
          id: "p1",
          content: "Post 1",
          platform: "x",
          status: "draft",
        },
      },
    })
    expect(updated[0].parts).toHaveLength(2)
    expect(updated[0].parts[1].type).toBe("draft_artifact")
  })

  it("updates existing draft artifact in place when same post is updated", async () => {
    const { appendAssistantArtifact } = await import("../useChatTurnSender")
    const messages: ChatUIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "draft_artifact",
            artifact: {
              id: "p1",
              content: "Version 1",
              platform: "x",
              status: "draft",
            },
          },
        ],
      },
    ]
    const updated = appendAssistantArtifact({
      messages,
      assistantMsgId: "a1",
      artifactPart: {
        type: "draft_artifact",
        artifact: {
          id: "p1",
          content: "Version 2 (refined)",
          platform: "x",
          status: "draft",
        },
      },
    })
    expect(updated[0].parts).toHaveLength(1)
    expect((updated[0].parts[0] as any).artifact.content).toBe(
      "Version 2 (refined)",
    )
  })
})
