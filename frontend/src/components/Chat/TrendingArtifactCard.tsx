import { ExternalLink, Flame, Sparkles } from "lucide-react"
import type {
  TrendingArtifact,
  TrendingTopicItem,
} from "@/components/Chat/types"
import { Button } from "@/components/ui/button"

export interface TrendingArtifactCardProps {
  artifact: TrendingArtifact
  onDraftTopic?: (topicTitle: string) => void
  className?: string
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

function formatCategory(category?: string | null): string {
  if (!category) return "Trending"
  const cat = category.trim()
  if (cat.toLowerCase().includes("trending")) return cat
  return `${cat} · Trending`
}

function TopicRow({
  topic,
  index,
  onDraft,
}: {
  topic: TrendingTopicItem
  index: number
  onDraft?: () => void
}) {
  const postCount = formatPostCount(topic.post_count)

  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-border/40 bg-background/50 hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          #{index + 1} · {formatCategory(topic.category)}
        </span>
        {postCount && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {postCount}
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {topic.topic_url ? (
            <a
              href={topic.topic_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-sm text-foreground hover:text-primary transition-colors line-clamp-2"
            >
              <span>{topic.topic_title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </a>
          ) : (
            <span className="font-semibold text-sm text-foreground line-clamp-2">
              {topic.topic_title}
            </span>
          )}

          {topic.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
              {topic.summary}
            </p>
          )}
        </div>

        {onDraft && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDraft}
            className="shrink-0 h-7 text-xs gap-1.5 rounded-lg border-primary/30 hover:border-primary hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
            title={`Draft post about "${topic.topic_title}"`}
          >
            <Sparkles className="h-3 w-3 text-primary" />
            <span>Draft</span>
          </Button>
        )}
      </div>
    </div>
  )
}

export function TrendingArtifactCard({
  artifact,
  onDraftTopic,
  className = "",
}: TrendingArtifactCardProps) {
  const topics = artifact?.topics ?? []
  if (topics.length === 0) return null

  return (
    <div
      className={`w-full max-w-2xl rounded-2xl border border-border/80 bg-card p-4 shadow-sm flex flex-col gap-3 my-2 ${className}`}
    >
      <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
            <Flame className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Trending Topics from X
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Freshly extracted live from Explore
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
          {topics.length} trends
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {topics.map((topic, idx) => (
          <TopicRow
            key={topic.id || `topic-${idx}`}
            topic={topic}
            index={idx}
            onDraft={
              onDraftTopic ? () => onDraftTopic(topic.topic_title) : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}
