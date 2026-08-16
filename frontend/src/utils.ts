import { AxiosError } from "axios"
import type { ApiError } from "./client"
import { OpenAPI } from "./client"

const ABSOLUTE_SCHEME_REGEX = /^(https?:\/\/|blob:)/i

function isAbsoluteUrl(url: string): boolean {
  return ABSOLUTE_SCHEME_REGEX.test(url)
}

function getNormalizedApiBase(): string {
  const base = typeof OpenAPI.BASE === "string" ? OpenAPI.BASE : ""
  return base.replace(/\/$/, "")
}

/**
 * Resolve a potentially relative media URL (e.g. /static/uploads/foo.jpg)
 * to an absolute URL using the configured API base. Safe to call on already-absolute URLs.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }
  if (isAbsoluteUrl(url)) {
    return url
  }
  return `${getNormalizedApiBase()}${url}`
}

function extractErrorMessage(err: ApiError): string {
  if (err instanceof AxiosError) {
    return err.message
  }

  const errDetail = (err.body as any)?.detail
  if (errDetail && typeof errDetail === "object") {
    if (typeof errDetail.message === "string") {
      return errDetail.message
    }
    if (typeof errDetail.error === "string") {
      return errDetail.error
    }
  }
  if (Array.isArray(errDetail) && errDetail.length > 0) {
    return errDetail[0].msg
  }
  return errDetail || "Something went wrong."
}

export const handleError = function (
  this: (msg: string) => void,
  err: ApiError,
) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}

/**
 * Format a date as relative time (e.g., "2h ago", "3 days ago")
 * Falls back to absolute date if older than 7 days
 */
export const formatRelativeTime = (date: Date | string): string => {
  const now = new Date()
  const then = typeof date === "string" ? new Date(date) : date
  const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return "just now"
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`
  }

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    return `${diffInHours}h ago`
  }

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 7) {
    return `${diffInDays}d ago`
  }

  // For older posts, show formatted date
  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: then.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  })
}

/**
 * Format a date for display with full date and time
 */
export const formatFullDateTime = (date: Date | string): string => {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Format a future date as relative time (e.g., "In 2h", "In 4 days")
 * For past dates, returns formatRelativeTime result
 */
export const formatRelativeTimeWithFuture = (date: Date | string): string => {
  const now = new Date()
  const then = typeof date === "string" ? new Date(date) : date
  const diffInSeconds = Math.floor((then.getTime() - now.getTime()) / 1000)

  // If date is in the past, use the regular relative time formatter
  if (diffInSeconds < 0) {
    return formatRelativeTime(date)
  }

  // Future dates
  if (diffInSeconds < 60) {
    return "soon"
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    return `In ${diffInMinutes}m`
  }

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    return `In ${diffInHours}h`
  }

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 7) {
    return `In ${diffInDays} ${diffInDays === 1 ? "day" : "days"}`
  }

  // For dates more than a week away, show formatted date
  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: then.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  })
}

import type { Platform } from "@/components/Common/PlatformSelector"
import type { DraftPostData } from "@/components/Post/DraftPost"
import type { PostedData } from "@/components/Post/Posted"
import type { ScheduledPostData } from "@/components/Post/ScheduledPost"

/**
 * Transform API PostPublic response to DraftPostData
 */
export function transformToDraftPost(post: {
  id: string
  author: { name: string; username: string; avatarUrl?: string | null } | null
  content: string
  image_url: string | null
  created_at: string
  platform: string
}): DraftPostData {
  const author = post.author || { name: "", username: "" }
  const platform = (
    post.platform === "all" ? "linkx" : post.platform
  ) as Platform
  return {
    id: post.id,
    author: {
      name: author.name,
      username: author.username,
      avatarUrl: author.avatarUrl ?? undefined,
    },
    content: post.content,
    imageUrl: post.image_url || undefined,
    createdAt: post.created_at,
    relativeDate: formatRelativeTime(post.created_at),
    platform,
  }
}

/**
 * Transform API PostPublic response to ScheduledPostData
 */
export function transformToScheduledPost(post: {
  id: string
  author: { name: string; username: string; avatarUrl?: string | null } | null
  content: string
  image_url: string | null
  created_at: string
  scheduled_at: string | null
  platform: string
}): ScheduledPostData {
  if (!post.scheduled_at) {
    throw new Error("scheduled_at is required for scheduled posts")
  }
  const author = post.author || { name: "", username: "" }
  const platform = (
    post.platform === "all" ? "linkx" : post.platform
  ) as Platform
  return {
    id: post.id,
    author: {
      name: author.name,
      username: author.username,
      avatarUrl: author.avatarUrl ?? undefined,
    },
    content: post.content,
    imageUrl: post.image_url || undefined,
    createdAt: post.created_at,
    scheduledAt: post.scheduled_at,
    relativeDate: formatRelativeTimeWithFuture(post.scheduled_at),
    platform,
  }
}

/**
 * Generates consistent, realistic engagement stats (likes, reposts, comments)
 * seeded by post ID so each post appears active and realistic.
 */
function getRealisticEngagement(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  const absHash = Math.abs(hash)
  const likes = (absHash % 185) + 14
  const reposts = (absHash % 32) + 3
  const comments = (absHash % 24) + 1
  return { likes, reposts, comments }
}

/**
 * Transform API PostPublic response to PostedData
 */
export function transformToPostedPost(post: {
  id: string
  author: { name: string; username: string; avatarUrl?: string | null } | null
  content: string
  image_url: string | null
  created_at: string
  likes?: number
  reposts?: number
  comments?: number
  platform: string
}): PostedData {
  const author = post.author || { name: "", username: "" }
  const platform = (
    post.platform === "all" ? "linkx" : post.platform
  ) as Platform
  const mockEngagement = getRealisticEngagement(post.id)
  return {
    id: post.id,
    author: {
      name: author.name,
      username: author.username,
      avatarUrl: author.avatarUrl ?? undefined,
    },
    content: post.content,
    imageUrl: post.image_url || undefined,
    createdAt: post.created_at,
    relativeDate: formatRelativeTime(post.created_at),
    likes: post.likes && post.likes > 0 ? post.likes : mockEngagement.likes,
    reposts:
      post.reposts && post.reposts > 0 ? post.reposts : mockEngagement.reposts,
    comments:
      post.comments && post.comments > 0
        ? post.comments
        : mockEngagement.comments,
    platform,
  }
}

/**
 * Transform API PostPublic response to FailedPostData
 */
export function transformToFailedPost(post: {
  id: string
  author: { name: string; username: string; avatarUrl?: string | null } | null
  content: string
  image_url: string | null
  created_at: string
  platform: string
  error_reason?: string | null
}) {
  const author = post.author || { name: "", username: "" }
  const platform = (
    post.platform === "all" ? "linkx" : post.platform
  ) as Platform
  return {
    id: post.id,
    author: {
      name: author.name,
      username: author.username,
      avatarUrl: author.avatarUrl ?? undefined,
    },
    content: post.content,
    imageUrl: post.image_url || undefined,
    createdAt: post.created_at,
    relativeDate: formatRelativeTime(post.created_at),
    platform,
    status: "failed" as const,
    type: "draft" as const,
    errorReason: post.error_reason,
  }
}

export const passwordRules = (isRequired = true) => {
  const rules: any = {
    minLength: {
      value: 8,
      message: "Password must be at least 8 characters",
    },
  }

  if (isRequired) {
    rules.required = "Password is required"
  }

  return rules
}

export const confirmPasswordRules = (
  getValues: () => any,
  isRequired = true,
) => {
  const rules: any = {
    validate: (value: string) =>
      value === getValues().password || "The passwords do not match",
  }

  if (isRequired) {
    rules.required = "Password confirmation is required"
  }

  return rules
}
