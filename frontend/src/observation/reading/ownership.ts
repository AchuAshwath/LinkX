interface BrowserOwner {
  ownerChatId: string | null
  threadId: string | null
  draftNonce: string | null
}

function matchesThread(owner: BrowserOwner, id: string): boolean {
  if (owner.threadId === id) return true
  return owner.ownerChatId === id
}

export function ownerIdForChat(
  owner: BrowserOwner,
  id: string | null,
): string | null {
  if (id) return matchesThread(owner, id) ? id : null
  if (owner.threadId) return null
  if (owner.ownerChatId) return null
  return owner.draftNonce
}
