import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Bot, Loader2, RefreshCw } from "lucide-react"
import * as React from "react"
import { TrendingService, type TrendingTopicPublic } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { draftingStore } from "@/hooks/useDraftingStore"
import { formatRelativeTime, handleError } from "@/utils"

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

function TrendingTopicRow({ topic, isDrafting = false, onDraft }: RowProps) {
  const postCountStr = formatPostCount(topic.post_count)

  return (
    <div className="w-full py-3 px-4 transition-colors hover:bg-muted/10">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {topic.category ? `${topic.category} · Trending` : "Trending"}
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
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast, showInfoToast } = useCustomToast()
  const [draftingTopicId, setDraftingTopicId] = React.useState<string | null>(
    null,
  )

  const extractMutation = useMutation({
    mutationFn: async () =>
      TrendingService.extractTrendingTopics({ maxTopics: 3 }),
    onSuccess: (res) => {
      showSuccessToast(
        res.count > 0
          ? `Successfully refreshed ${res.count} trending topics from X!`
          : "Checked X: No new trending topics found.",
      )
      queryClient.setQueryData(["trending"], res)
      queryClient.invalidateQueries({ queryKey: ["trending"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const draftMutation = useMutation({
    mutationFn: async ({
      topicId,
    }: {
      topicId: string
      topicTitle: string
    }) => {
      setDraftingTopicId(topicId)
      return TrendingService.draftFromTrendingTopic({ topicId })
    },
    onSuccess: (_, variables) => {
      draftingStore.removeDraft(`trend-${variables.topicId}`)
      showSuccessToast(
        `Draft created from trending topic: "${variables.topicTitle}"`,
      )
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: (err, variables) => {
      draftingStore.removeDraft(`trend-${variables.topicId}`)
      handleError.call(showErrorToast, err as any)
    },
    onSettled: () => {
      setDraftingTopicId(null)
    },
  })

  const handleDraftClick = (topic: TrendingTopicPublic) => {
    if (onTopicDraft) {
      onTopicDraft(topic.topic_title)
    } else {
      draftingStore.addDraft({
        id: `trend-${topic.id}`,
        prompt: topic.topic_title,
        platform: "both",
        startedAt: new Date(),
      })
      showInfoToast(
        `Drafting post from "${topic.topic_title}" in background...`,
        "Drafting...",
      )
      draftMutation.mutate({
        topicId: topic.id,
        topicTitle: topic.topic_title,
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
        isPending={extractMutation.isPending}
        onRefresh={() => extractMutation.mutate()}
      />

      {topics.length === 0 ? (
        <TrendingEmptyState
          isPending={extractMutation.isPending}
          onRefresh={() => extractMutation.mutate()}
        />
      ) : (
        <div className="w-full divide-y divide-border/30">
          {topics.map((topic) => (
            <TrendingTopicRow
              key={topic.id}
              topic={topic}
              isDrafting={draftingTopicId === topic.id}
              onDraft={() => handleDraftClick(topic)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
