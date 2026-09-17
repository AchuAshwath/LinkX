import type { BranchVersionInfo, ChatUIMessage } from "@/components/Chat/types"

/**
 * Ensures all messages have a parentId, inferring sequentially from array order for legacy data.
 */
export function ensureMessageParentIds(
  messages: ChatUIMessage[],
): ChatUIMessage[] {
  if (!messages || messages.length === 0) return []
  const result: ChatUIMessage[] = []
  let prevId: string | null = null

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const parentId =
      msg.parentId !== undefined ? msg.parentId : i === 0 ? null : prevId
    result.push({
      ...msg,
      parentId,
    })
    prevId = msg.id
  }
  return result
}

/**
 * Reconstructs the active branch by traversing backwards from activeLeafId to root.
 * Returns chronological array [root, ..., leaf].
 */
export function resolveActiveBranch(
  messages: ChatUIMessage[],
  activeLeafId?: string | null,
): ChatUIMessage[] {
  if (!messages || messages.length === 0) return []
  const normalized = ensureMessageParentIds(messages)
  const idMap = new Map<string, ChatUIMessage>()
  for (const m of normalized) {
    idMap.set(m.id, m)
  }

  const startId =
    activeLeafId && idMap.has(activeLeafId)
      ? activeLeafId
      : normalized[normalized.length - 1]?.id

  if (!startId || !idMap.has(startId)) {
    return normalized
  }

  const targetId = findDeepestLeaf(normalized, startId)
  if (!targetId || !idMap.has(targetId)) {
    return normalized
  }

  const visited = new Set<string>()
  const path: ChatUIMessage[] = []
  let currId: string | null | undefined = targetId

  while (currId && idMap.has(currId) && !visited.has(currId)) {
    visited.add(currId)
    const node: ChatUIMessage | undefined = idMap.get(currId)
    if (!node) break
    path.push(node)
    currId = node.parentId
  }

  path.reverse()
  return path
}

export interface SiblingVersionsResult extends BranchVersionInfo {
  siblings: ChatUIMessage[]
}

/**
 * Finds all sibling versions at the same branch point (sharing identical parentId).
 */
export function findSiblingVersions(
  messages: ChatUIMessage[],
  messageId: string,
): SiblingVersionsResult {
  if (!messages || messages.length === 0) {
    return { currentIndex: 1, totalVersions: 1, siblings: [] }
  }
  const normalized = ensureMessageParentIds(messages)
  const target = normalized.find((m) => m.id === messageId)
  if (!target) {
    return { currentIndex: 1, totalVersions: 1, siblings: [] }
  }

  const targetParentId = target.parentId ?? null
  const siblings = normalized.filter(
    (m) => (m.parentId ?? null) === targetParentId,
  )
  const idx = siblings.findIndex((m) => m.id === messageId)

  return {
    currentIndex: idx >= 0 ? idx + 1 : 1,
    totalVersions: Math.max(siblings.length, 1),
    siblings,
  }
}

/**
 * Finds the deepest leaf descendant starting from a node, following the latest child.
 */
export function findDeepestLeaf(
  messages: ChatUIMessage[],
  nodeId: string,
): string {
  const normalized = ensureMessageParentIds(messages)
  const childrenMap = new Map<string, ChatUIMessage[]>()

  for (const m of normalized) {
    const pId = m.parentId
    if (pId) {
      const list = childrenMap.get(pId) ?? []
      list.push(m)
      childrenMap.set(pId, list)
    }
  }

  let curr = nodeId
  const visited = new Set<string>([curr])

  while (childrenMap.has(curr)) {
    const children = childrenMap.get(curr)!
    if (children.length === 0) break
    const latestChild = children[children.length - 1]
    if (visited.has(latestChild.id)) break
    visited.add(latestChild.id)
    curr = latestChild.id
  }

  return curr
}

/**
 * Returns the adjacent sibling message in the specified direction.
 */
export function findSiblingByDirection(
  messages: ChatUIMessage[],
  currentMessageId: string,
  direction: "prev" | "next",
): ChatUIMessage | null {
  const { siblings, currentIndex } = findSiblingVersions(
    messages,
    currentMessageId,
  )
  if (direction === "prev" && currentIndex > 1) {
    return siblings[currentIndex - 2] ?? null
  }
  if (direction === "next" && currentIndex < siblings.length) {
    return siblings[currentIndex] ?? null
  }
  return null
}
