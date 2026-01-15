import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface TrendingTopic {
  id: string
  hashtag: string
  postCount: number
}

interface TrendingTopicsProps {
  topics: TrendingTopic[]
  title?: string
  onTopicClick?: (topicId: string, hashtag: string) => void
}

function formatPostCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
}

export function TrendingTopics({
  topics,
  title = "Trending Topics",
  onTopicClick,
}: TrendingTopicsProps) {
  if (topics.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => onTopicClick?.(topic.id, topic.hashtag)}
              className="w-full flex items-center justify-between gap-2 rounded-lg p-2 -m-2 text-left transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label={`View ${topic.hashtag} with ${formatPostCount(topic.postCount)} posts`}
            >
              <span className="truncate font-medium text-primary hover:underline">
                {topic.hashtag}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground">
                {formatPostCount(topic.postCount)} posts
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
