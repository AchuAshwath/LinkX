import { useNavigate } from "@tanstack/react-router"
import { Bot, Loader2, RefreshCw } from "lucide-react"
import * as React from "react"
import type { TrendingTopicPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/utils"

export type TrendingTopic = TrendingTopicPublic

export interface TrendingTopicsProps {
  topics: TrendingTopicPublic[]
  title?: string
  lastScrapedAt?: string | null
  onTopicDraft?: (topicTitle: string) => void
}

function formatPostCount(count?: number | null): string {
  if (!count) return ""
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M posts`
  }
  if (count >= 1_000) {
    return `${count.toLocaleString()} posts`
  }
  return `${count} posts`
}

interface HeaderProps {
  title: string
  relativeTime: string | null
  isPending: boolean
  onRefresh: () => void
}

function TrendingHeader({
  title,
  relativeTime,
  isPending,
  onRefresh,
}: HeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {relativeTime && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Synced {relativeTime}
          </p>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        disabled={isPending}
        className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-colors cursor-pointer disabled:opacity-100"
        title={
          isPending
            ? "Refreshing trends in background..."
            : "Refresh trending topics from X"
        }
        aria-label="Refresh trending topics from X"
      >
        <RefreshCw
          className={`h-4 w-4 transition-colors ${
            isPending
              ? "animate-spin text-primary"
              : "text-muted-foreground hover:text-primary"
          }`}
        />
      </Button>
    </div>
  )
}

interface EmptyProps {
  isPending: boolean
  onRefresh: () => void
}

function TrendingEmptyState({ isPending, onRefresh }: EmptyProps) {
  return (
    <div className="p-5 text-center space-y-3">
      <p className="text-xs text-muted-foreground">
        No trending topics extracted yet.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={isPending}
        className="text-xs h-8 gap-1.5 rounded-full hover:text-primary hover:border-primary"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${isPending ? "animate-spin text-primary" : ""}`}
        />
        <span>
          {isPending ? "Extracting from X..." : "Extract Live Trends"}
        </span>
      </Button>
    </div>
  )
}

interface RowProps {
  topic: TrendingTopicPublic
  isDrafting?: boolean
  onDraft: () => void
}

function formatCategory(category?: string | null): string {
  if (!category) return "Trending"
  const cat = category.trim()
  if (cat.toLowerCase().includes("trending")) return cat
  return `${cat} · Trending`
}

function TrendingTopicRow({ topic, isDrafting = false, onDraft }: RowProps) {
  const postCountStr = formatPostCount(topic.post_count)

  return (
    <div className="w-full py-3 px-4 transition-colors hover:bg-muted/10">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {formatCategory(topic.category)}
      </div>

      <a
        href={topic.topic_url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-sm font-semibold text-foreground hover:text-primary transition-colors leading-snug line-clamp-2"
      >
        {topic.topic_title}
      </a>

      <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
        <span className="text-xs text-muted-foreground">
          {postCountStr || ""}
        </span>
        <button
          type="button"
          onClick={onDraft}
          disabled={isDrafting}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
          title={`Generate AI draft from "${topic.topic_title}"`}
        >
          {isDrafting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-primary font-semibold">Drafting…</span>
            </>
          ) : (
            <>
              <Bot className="h-3.5 w-3.5" />
              <span>Draft</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export function TrendingTopics({
  topics,
  title = "Trending Topics",
  lastScrapedAt,
  onTopicDraft,
}: TrendingTopicsProps) {
  const navigate = useNavigate()

  const handleRefresh = () => {
    navigate({
      to: "/ai",
      search: {
        prompt: "Refresh trending topics from X",
        autoRun: true,
      },
    })
  }

  const handleDraftClick = (topic: TrendingTopicPublic) => {
    if (onTopicDraft) {
      onTopicDraft(topic.topic_title)
    } else {
      navigate({
        to: "/ai",
        search: {
          prompt: `Draft an engaging post about: "${topic.topic_title}"`,
          autoRun: true,
        },
      })
    }
  }

  const relativeTime = React.useMemo(() => {
    if (!lastScrapedAt) return null
    return formatRelativeTime(lastScrapedAt)
  }, [lastScrapedAt])

  return (
    <div className="w-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-none">
      <TrendingHeader
        title={title}
        relativeTime={relativeTime}
        isPending={false}
        onRefresh={handleRefresh}
      />

      {topics.length === 0 ? (
        <TrendingEmptyState isPending={false} onRefresh={handleRefresh} />
      ) : (
        <div className="w-full divide-y divide-border/30">
          {topics.slice(0, 3).map((topic) => (
            <TrendingTopicRow
              key={topic.id}
              topic={topic}
              isDrafting={false}
              onDraft={() => handleDraftClick(topic)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
