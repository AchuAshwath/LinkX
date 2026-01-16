import { createFileRoute, redirect } from "@tanstack/react-router"
import { Menu, X } from "lucide-react"
import * as React from "react"
import { Post, type PostData } from "@/components/Post"
import { PostInputBox } from "@/components/PostInput"
import { TimelineSidebar } from "@/components/Sidebar/TimelineSidebar"
import {
  type TrendingTopic,
  TrendingTopics,
  type UserToFollow,
  WhoToFollow,
} from "@/components/Timeline"
import { Button } from "@/components/ui/button"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/timeline")({
  component: TimelinePage,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: "Timeline",
      },
    ],
  }),
})

function TimelinePage() {
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  // Sample posts data
  const posts: PostData[] = React.useMemo(
    () => [
      {
        id: "1",
        author: {
          name: "Moyo Shiro",
          username: "moyo",
          avatarUrl: "https://bundui-images.netlify.app/avatars/01.png",
        },
        content:
          "Just launched my new portfolio website! 🚀 Check out these 15 standout examples of creative, sleek, and interactive portfolio designs that inspired me. Which one's your favorite? #WebDesign #PortfolioInspiration",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        likes: 62,
        reposts: 23,
        comments: 45,
      },
      {
        id: "2",
        author: {
          name: "Sophia",
          username: "sophia",
          avatarUrl: "https://bundui-images.netlify.app/avatars/10.png",
        },
        content:
          "Dreaming of distant worlds... 🪐 This AI-generated image captures the essence of exploration. What stories does it spark in your imagination?",
        imageUrl: "https://bundui-images.netlify.app/blog/02.jpg",
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
        likes: 128,
        reposts: 34,
        comments: 67,
      },
    ],
    [],
  )

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
    <div className="min-h-screen w-full">
      {/* Mobile Navbar */}
      <header className="sticky top-0 z-50 flex h-14 items-center gap-4 border-b bg-background px-4 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </Button>
        <h1 className="text-xl font-semibold">Timeline</h1>
      </header>

      <div className="mx-auto flex w-full max-w-7xl px-4 lg:px-6">
        {/* Left Sidebar */}
        <TimelineSidebar
          sidebarOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

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

        {/* Right Sidebar */}
        <div className="hidden w-80 space-y-6 p-4 md:block">
          <WhoToFollow users={usersToFollow} onFollow={handleFollow} />
          <TrendingTopics
            topics={trendingTopics}
            onTopicClick={handleTopicClick}
          />
        </div>
      </div>
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 top-14 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}

export default TimelinePage
