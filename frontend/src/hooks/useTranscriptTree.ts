import type { BranchVersionInfo, ChatUIMessage } from "@/components/Chat/types"

/**
 * Ensures all messages have a parentId, inferring sequentially from array order for legacy data.
 */
function resolveRawParentId(raw: ChatUIMessage): string | null | undefined {
  if (raw.parentId !== undefined) return raw.parentId
  const snake = (raw as unknown as Record<string, unknown>).parent_id
  return typeof snake === "string" || snake === null ? snake : undefined
}

function computeMessageParentId({
  index,
  rawParentId,
  hasForkedFrom,
  prevId,
}: {
  index: number
  rawParentId: string | null | undefined
  hasForkedFrom: boolean
  prevId: string | null
}): string | null {
  if (index === 0) return null
  if (rawParentId !== undefined && rawParentId !== null) return rawParentId
  if (rawParentId === null && hasForkedFrom) return null
  return prevId
}

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
    const raw = messages[i]
    const rawParentId = resolveRawParentId(raw)
    const rawRecord = raw as unknown as Record<string, unknown>
    const forkedFrom = (raw.forkedFromId ?? rawRecord.forked_from_id) as
      | string
      | undefined

    const parentId = computeMessageParentId({
      index: i,
      rawParentId,
      hasForkedFrom: Boolean(forkedFrom),
      prevId,
    })

    result.push({
      ...raw,
      parentId,
      forkedFromId: forkedFrom ?? raw.forkedFromId,
    })
    prevId = raw.id
  }
  return result
}

function findStartNodeId(
  messages: ChatUIMessage[],
  idMap: Map<string, ChatUIMessage>,
  activeLeafId?: string | null,
): string | null {
  if (activeLeafId && idMap.has(activeLeafId)) {
    return activeLeafId
  }
  return messages[messages.length - 1]?.id ?? null
}

function tracePathToRoot(
  targetId: string,
  idMap: Map<string, ChatUIMessage>,
): ChatUIMessage[] {
  const visited = new Set<string>()
  const path: ChatUIMessage[] = []
  let currId: string | null | undefined = targetId

  while (currId) {
    if (visited.has(currId)) break
    visited.add(currId)
    const node = idMap.get(currId)
    if (!node) break
    path.push(node)
    currId = node.parentId
  }

  path.reverse()
  return path
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
  const idMap = new Map<string, ChatUIMessage>(normalized.map((m) => [m.id, m]))

  const startId = findStartNodeId(normalized, idMap, activeLeafId)
  if (!startId) return normalized

  const targetId = findDeepestLeaf(normalized, startId)
  if (!idMap.has(targetId)) return normalized

  return tracePathToRoot(targetId, idMap)
}

export interface SiblingVersionsResult extends BranchVersionInfo {
  siblings: ChatUIMessage[]
}

function matchesSiblingBranch(
  candidate: ChatUIMessage,
  role: string,
  parentId: string | null,
): boolean {
  return candidate.role === role && (candidate.parentId ?? null) === parentId
}

/**
 * Finds all sibling versions at the same branch point (sharing identical parentId and role).
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
  const siblings = normalized.filter((m) =>
    matchesSiblingBranch(m, target.role, targetParentId),
  )
  const idx = siblings.findIndex((m) => m.id === messageId)

  return {
    currentIndex: idx >= 0 ? idx + 1 : 1,
    totalVersions: Math.max(siblings.length, 1),
    siblings,
  }
}

function buildChildrenMap(
  messages: ChatUIMessage[],
): Map<string, ChatUIMessage[]> {
  const childrenMap = new Map<string, ChatUIMessage[]>()
  for (const m of messages) {
    if (!m.parentId) continue
    const list = childrenMap.get(m.parentId) ?? []
    list.push(m)
    childrenMap.set(m.parentId, list)
  }
  return childrenMap
}

function getNextLeafChild(
  curr: string,
  childrenMap: Map<string, ChatUIMessage[]>,
  visited: Set<string>,
): string | null {
  const children = childrenMap.get(curr)
  if (!children || children.length === 0) return null
  const latest = children[children.length - 1]
  if (visited.has(latest.id)) return null
  return latest.id
}

/**
 * Finds the deepest leaf descendant starting from a node, following the latest child.
 */
export function findDeepestLeaf(
  messages: ChatUIMessage[],
  nodeId: string,
): string {
  const normalized = ensureMessageParentIds(messages)
  const childrenMap = buildChildrenMap(normalized)
  let curr = nodeId
  const visited = new Set<string>([curr])

  while (childrenMap.has(curr)) {
    const nextChildId = getNextLeafChild(curr, childrenMap, visited)
    if (!nextChildId) break
    visited.add(nextChildId)
    curr = nextChildId
  }

  return curr
}

function getAdjacentSibling(
  siblings: ChatUIMessage[],
  currentIndex: number,
  direction: "prev" | "next",
): ChatUIMessage | null {
  if (direction === "prev") {
    return currentIndex > 1 ? (siblings[currentIndex - 2] ?? null) : null
  }
  return currentIndex < siblings.length
    ? (siblings[currentIndex] ?? null)
    : null
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
  return getAdjacentSibling(siblings, currentIndex, direction)
}
