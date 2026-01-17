import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"
import { Post } from "@/components/Post"
import { PostInputBox } from "@/components/PostInput"
import {
  type TrendingTopic,
  TrendingTopics,
  type UserToFollow,
  WhoToFollow,
} from "@/components/Timeline"
import { timelinePosts } from "./timelineData"

export const Route = createFileRoute("/_layout/")({
  component: TimelinePage,
  head: () => ({
    meta: [
      {
        title: "Timeline",
      },
    ],
  }),
})

function TimelinePage() {
  // Use the posts data structure
  const posts = timelinePosts

  // Sample users to follow
  const usersToFollow: UserToFollow[] = React.useMemo(
    () => [
      {
        id: "1",
        name: "George",
        username: "georgeSZ",
        avatarUrl: "/placeholder.svg?height=40&width=40",
      },
      {
        id: "2",
        name: "Nettie Schuster",
        username: "Precious3",
        avatarUrl: "/placeholder.svg?height=40&width=40",
      },
      {
        id: "3",
        name: "Mrs. Lola Rohan",
        username: "collin_marks",
        avatarUrl: "/placeholder.svg?height=40&width=40",
      },
    ],
    [],
  )

  // Sample trending topics
  const trendingTopics: TrendingTopic[] = React.useMemo(
    () => [
      { id: "1", hashtag: "#TechInnovation", postCount: 5200 },
      { id: "2", hashtag: "#ArtificialIntelligence", postCount: 12000 },
      { id: "3", hashtag: "#ClimateAction", postCount: 8700 },
      { id: "4", hashtag: "#SpaceExploration", postCount: 3900 },
    ],
    [],
  )

  const handlePostAction = (action: string, postId: string) => {
    // Handle post actions (like, repost, comment, share)
    console.log(`${action} post ${postId}`)
  }

  const handleFollow = (userId: string) => {
    console.log(`Follow user ${userId}`)
  }

  const handleTopicClick = (_topicId: string, hashtag: string) => {
    console.log(`View topic ${hashtag}`)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
      {/* Main Timeline */}
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl">
        {/* Post Composer */}
        <div className="border-b p-3 sm:p-4">
          <PostInputBox username="Jane Doe" />
        </div>

        {/* Timeline Posts */}
        <div className="w-full">
          {posts.map((post) => (
            <Post
              key={post.id}
              post={post}
              onLike={(id) => handlePostAction("like", id)}
              onRepost={(id) => handlePostAction("repost", id)}
              onComment={(id) => handlePostAction("comment", id)}
              onShare={(id) => handlePostAction("share", id)}
              onMore={(id) => handlePostAction("more", id)}
            />
          ))}
        </div>
      </div>

      {/* Right Sidebar - Sticky like left sidebar */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 h-screen overflow-y-auto p-4 space-y-6">
          <WhoToFollow users={usersToFollow} onFollow={handleFollow} />
          <TrendingTopics
            topics={trendingTopics}
            onTopicClick={handleTopicClick}
          />
        </div>
      </div>
    </div>
  )
}

export default TimelinePage
