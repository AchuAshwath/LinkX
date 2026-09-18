import { describe, expect, it } from "vitest"
import type { ChatUIMessage } from "@/components/Chat/types"
import {
  ensureMessageParentIds,
  findDeepestLeaf,
  findSiblingByDirection,
  findSiblingVersions,
  resolveActiveBranch,
} from "@/hooks/useTranscriptTree"

describe("useTranscriptTree - DAG session tree utilities", () => {
  it("ensureMessageParentIds backfills sequential parentId for legacy messages", () => {
    const legacy: ChatUIMessage[] = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "A" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "B" }] },
      { id: "m3", role: "user", parts: [{ type: "text", text: "C" }] },
    ]
    const normalized = ensureMessageParentIds(legacy)
    expect(normalized[0].parentId).toBeNull()
    expect(normalized[1].parentId).toBe("m1")
    expect(normalized[2].parentId).toBe("m2")
  })

  it("resolveActiveBranch resolves linear path when no branches exist", () => {
    const messages: ChatUIMessage[] = [
      { id: "m1", parentId: null, role: "user", parts: [] },
      { id: "m2", parentId: "m1", role: "assistant", parts: [] },
      { id: "m3", parentId: "m2", role: "user", parts: [] },
    ]
    const active = resolveActiveBranch(messages)
    expect(active.map((m) => m.id)).toEqual(["m1", "m2", "m3"])
  })

  it("resolveActiveBranch traverses backward from activeLeafId through forked branches", () => {
    // Tree:
    // m1 -> m2 -> m3a -> m4a (Branch A)
    //          \-> m3b -> m4b (Branch B)
    const messages: ChatUIMessage[] = [
      { id: "m1", parentId: null, role: "user", parts: [] },
      { id: "m2", parentId: "m1", role: "assistant", parts: [] },
      { id: "m3a", parentId: "m2", role: "user", parts: [] },
      { id: "m4a", parentId: "m3a", role: "assistant", parts: [] },
      { id: "m3b", parentId: "m2", role: "user", parts: [] },
      { id: "m4b", parentId: "m3b", role: "assistant", parts: [] },
    ]

    const pathA = resolveActiveBranch(messages, "m4a")
    expect(pathA.map((m) => m.id)).toEqual(["m1", "m2", "m3a", "m4a"])

    const pathB = resolveActiveBranch(messages, "m4b")
    expect(pathB.map((m) => m.id)).toEqual(["m1", "m2", "m3b", "m4b"])
  })

  it("findSiblingVersions accurately reports index and version counts", () => {
    const messages: ChatUIMessage[] = [
      { id: "m1", parentId: null, role: "user", parts: [] },
      { id: "m2", parentId: "m1", role: "assistant", parts: [] },
      { id: "m3a", parentId: "m2", role: "user", parts: [] },
      { id: "m3b", parentId: "m2", role: "user", parts: [] },
      { id: "m3c", parentId: "m2", role: "user", parts: [] },
    ]

    const infoA = findSiblingVersions(messages, "m3a")
    expect(infoA.currentIndex).toBe(1)
    expect(infoA.totalVersions).toBe(3)
    expect(infoA.siblings.map((s) => s.id)).toEqual(["m3a", "m3b", "m3c"])

    const infoB = findSiblingVersions(messages, "m3b")
    expect(infoB.currentIndex).toBe(2)
    expect(infoB.totalVersions).toBe(3)

    const infoC = findSiblingVersions(messages, "m3c")
    expect(infoC.currentIndex).toBe(3)
    expect(infoC.totalVersions).toBe(3)
  })

  it("findDeepestLeaf follows the most recent descendant path", () => {
    const messages: ChatUIMessage[] = [
      { id: "m1", parentId: null, role: "user", parts: [] },
      { id: "m2", parentId: "m1", role: "assistant", parts: [] },
      { id: "m3a", parentId: "m2", role: "user", parts: [] },
      { id: "m4a", parentId: "m3a", role: "assistant", parts: [] },
      { id: "m3b", parentId: "m2", role: "user", parts: [] },
      { id: "m4b", parentId: "m3b", role: "assistant", parts: [] },
      { id: "m5b", parentId: "m4b", role: "user", parts: [] },
    ]

    expect(findDeepestLeaf(messages, "m3a")).toBe("m4a")
    expect(findDeepestLeaf(messages, "m3b")).toBe("m5b")
  })

  it("findSiblingByDirection navigates prev and next siblings correctly", () => {
    const messages: ChatUIMessage[] = [
      { id: "m1", parentId: null, role: "user", parts: [] },
      { id: "m2a", parentId: "m1", role: "assistant", parts: [] },
      { id: "m2b", parentId: "m1", role: "assistant", parts: [] },
      { id: "m2c", parentId: "m1", role: "assistant", parts: [] },
    ]

    expect(findSiblingByDirection(messages, "m2a", "prev")).toBeNull()
    expect(findSiblingByDirection(messages, "m2a", "next")?.id).toBe("m2b")
    expect(findSiblingByDirection(messages, "m2b", "prev")?.id).toBe("m2a")
    expect(findSiblingByDirection(messages, "m2b", "next")?.id).toBe("m2c")
    expect(findSiblingByDirection(messages, "m2c", "next")).toBeNull()
  })

  it("resolveActiveBranch includes newly appended optimistic turns when activeLeafId was previous assistant", () => {
    const messages: ChatUIMessage[] = [
      { id: "m1", parentId: null, role: "user", parts: [] },
      { id: "m2", parentId: "m1", role: "assistant", parts: [] },
      { id: "local_user", parentId: "m2", role: "user", parts: [] },
      {
        id: "local_assistant",
        parentId: "local_user",
        role: "assistant",
        parts: [],
        status: "streaming",
      },
    ]

    const active = resolveActiveBranch(messages, "m2")
    expect(active.map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "local_user",
      "local_assistant",
    ])
  })

  it("ensureMessageParentIds heals legacy messages with explicit parentId: null", () => {
    const legacyNull: ChatUIMessage[] = [
      { id: "m1", parentId: null, role: "user", parts: [] },
      { id: "m2", parentId: null, role: "assistant", parts: [] },
      { id: "m3", parentId: null, role: "user", parts: [] },
    ]
    const normalized = ensureMessageParentIds(legacyNull)
    expect(normalized[0].parentId).toBeNull()
    expect(normalized[1].parentId).toBe("m1")
    expect(normalized[2].parentId).toBe("m2")
  })

  it("ensureMessageParentIds preserves snake_case parent_id from server", () => {
    const serverMsgs: any[] = [
      { id: "m1", parent_id: null, role: "user", parts: [] },
      { id: "m2", parent_id: "m1", role: "assistant", parts: [] },
      { id: "m3a", parent_id: "m2", role: "user", parts: [] },
      { id: "m3b", parent_id: "m2", role: "user", parts: [] },
    ]
    const normalized = ensureMessageParentIds(serverMsgs)
    expect(normalized[0].parentId).toBeNull()
    expect(normalized[1].parentId).toBe("m1")
    expect(normalized[2].parentId).toBe("m2")
    expect(normalized[3].parentId).toBe("m2")

    const siblingsA = findSiblingVersions(normalized, "m3a")
    expect(siblingsA.totalVersions).toBe(2)
    expect(siblingsA.currentIndex).toBe(1)

    const siblingsB = findSiblingVersions(normalized, "m3b")
    expect(siblingsB.totalVersions).toBe(2)
    expect(siblingsB.currentIndex).toBe(2)
  })
})
