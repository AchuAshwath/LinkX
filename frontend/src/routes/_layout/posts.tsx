import { createFileRoute } from "@tanstack/react-router"
import {
  Calendar,
  CheckCircle2,
  Filter,
  X,
  Clock,
  TrendingUp,
  BarChart3,
} from "lucide-react"
import * as React from "react"
import { Post } from "@/components/Post"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { scheduledPosts, postedPosts } from "./-postsData"
import { formatFullDateTime } from "@/utils"

export const Route = createFileRoute("/_layout/posts")({
  component: PostsPage,
  head: () => ({
    meta: [
      {
        title: "Posts - LinkX",
      },
    ],
  }),
})

function PostsPage() {
  const [activeTab, setActiveTab] = React.useState<"scheduled" | "posted">(
    "scheduled",
  )
  const [dateFilter, setDateFilter] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<string>("newest")
  const [hasFilters, setHasFilters] = React.useState(false)

  const handlePostAction = (action: string, postId: string) => {
    console.log(`${action} post ${postId}`)
  }

  const handleClearFilters = () => {
    setDateFilter("all")
    setSortBy("newest")
    setHasFilters(false)
  }

  React.useEffect(() => {
    setHasFilters(dateFilter !== "all" || sortBy !== "newest")
  }, [dateFilter, sortBy])

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
          <div className="px-4 py-3">
            <h1 className="text-xl font-bold">Posts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage your scheduled and published posts
            </p>
          </div>

          {/* Tabs - X-style clean underline tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "scheduled" | "posted")
            }
            className="w-full"
          >
            <TabsList className="w-full h-auto p-0 bg-transparent rounded-none border-0 grid grid-cols-2">
              <TabsTrigger
                value="scheduled"
                className="relative flex-1 h-14 rounded-none border-0 border-b-2 border-transparent bg-transparent text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-semibold text-base transition-all hover:text-foreground hover:bg-accent/50 data-[state=active]:hover:bg-transparent"
              >
                <div className="flex items-center justify-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>Scheduled</span>
                  {scheduledPosts.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 h-5 min-w-5 px-1.5 text-xs font-normal"
                    >
                      {scheduledPosts.length}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="posted"
                className="relative flex-1 h-14 rounded-none border-0 border-b-2 border-transparent bg-transparent text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-semibold text-base transition-all hover:text-foreground hover:bg-accent/50 data-[state=active]:hover:bg-transparent"
              >
                <div className="flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Posted</span>
                  {postedPosts.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 h-5 min-w-5 px-1.5 text-xs font-normal"
                    >
                      {postedPosts.length}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="scheduled" className="mt-0">
              {scheduledPosts.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                  <div className="rounded-full bg-muted/50 p-6 mb-4">
                    <Calendar className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-1">
                    No scheduled posts
                  </h3>
                  <p className="text-muted-foreground text-sm max-w-sm">
                    Posts you schedule for later will appear here. Start
                    scheduling to keep your content calendar organized.
                  </p>
                </div>
              ) : (
                <div className="w-full">
                  {scheduledPosts.map((post, index) => (
                    <div key={post.id} className="relative">
                      {index === 0 && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary z-0" />
                      )}
                      <div className="relative border-b">
                        <div className="px-4 py-3 border-b bg-muted/30">
                          <Badge
                            variant="outline"
                            className="gap-1.5 text-xs font-medium"
                          >
                            <Calendar className="h-3 w-3" />
                            <span>
                              Scheduled for {formatFullDateTime(post.createdAt)}
                            </span>
                          </Badge>
                        </div>
                        <Post
                          post={post}
                          onLike={(id) => handlePostAction("like", id)}
                          onRepost={(id) => handlePostAction("repost", id)}
                          onComment={(id) => handlePostAction("comment", id)}
                          onShare={(id) => handlePostAction("share", id)}
                          onMore={(id) => handlePostAction("more", id)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="posted" className="mt-0">
              {postedPosts.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                  <div className="rounded-full bg-muted/50 p-6 mb-4">
                    <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-1">
                    No posted content
                  </h3>
                  <p className="text-muted-foreground text-sm max-w-sm">
                    Your published posts will appear here. Share your thoughts
                    and engage with your audience.
                  </p>
                </div>
              ) : (
                <div className="w-full">
                  {postedPosts.map((post) => (
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
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Right Sidebar - Filters */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 h-screen overflow-y-auto p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                </CardTitle>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="h-7 px-2 text-xs"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Date Range Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Date Range
                </label>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select date range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">This Week</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="quarter">This Quarter</SelectItem>
                    <SelectItem value="year">This Year</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort By Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                  Sort By
                </label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest First</SelectItem>
                    <SelectItem value="oldest">Oldest First</SelectItem>
                    <SelectItem value="scheduled">Scheduled Date</SelectItem>
                    <SelectItem value="engagement">Engagement</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status Filter (for scheduled posts) */}
              {activeTab === "scheduled" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                    Status
                  </label>
                  <Select defaultValue="all">
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Engagement Filter (for posted posts) */}
              {activeTab === "posted" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                    Engagement
                  </label>
                  <Select defaultValue="all">
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Filter by engagement" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Posts</SelectItem>
                      <SelectItem value="high">High Engagement</SelectItem>
                      <SelectItem value="medium">Medium Engagement</SelectItem>
                      <SelectItem value="low">Low Engagement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Scheduled
                </span>
                <Badge variant="secondary" className="font-semibold">
                  {scheduledPosts.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Posted</span>
                <Badge variant="secondary" className="font-semibold">
                  {postedPosts.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-medium">Total</span>
                <span className="text-sm font-semibold">
                  {scheduledPosts.length + postedPosts.length}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default PostsPage
