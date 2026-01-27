import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Home as HomeIcon, Loader2, Sparkles } from "lucide-react"
import * as React from "react"
import { PostsService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import type { PostedData } from "@/components/Post/Posted"
import { Posted } from "@/components/Post/Posted"
import {
  PostPreviewDialog,
  type PreviewPostData,
} from "@/components/Post/Previews"
import type { ScheduledPostData } from "@/components/Post/ScheduledPost"
import { ScheduledPost } from "@/components/Post/ScheduledPost"
import { PostInputBox } from "@/components/PostInput/PostInputBox"
import {
  TimelineFilters,
  type TrendingTopic,
  TrendingTopics,
} from "@/components/Timeline"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  handleError,
  transformToPostedPost,
  transformToScheduledPost,
} from "@/utils"

// Union type for timeline posts
type TimelinePost =
  | (PostedData & { type: "posted" })
  | (ScheduledPostData & { type: "scheduled" })

export const Route = createFileRoute("/_layout/home")({
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
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab] = React.useState<"timeline" | "ai">("timeline")

  // Filter state
  const [dateFilter, setDateFilter] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<string>("newest")

  // Edit state management
  const [editingPostId, setEditingPostId] = React.useState<string | null>(null)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [postToDelete, setPostToDelete] = React.useState<{
    id: string
    type: "draft" | "scheduled" | "posted"
  } | null>(null)

  // Preview dialog state
  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [previewPost, setPreviewPost] = React.useState<PreviewPostData | null>(
    null,
  )

  const { showSuccessToast, showErrorToast } = useCustomToast()

  // Fetch scheduled and published posts for timeline
  const { data: scheduledData, isLoading: isLoadingScheduled } = useQuery({
    queryKey: ["posts", "scheduled"],
    queryFn: async () => {
      return await PostsService.readPosts({
        status: "scheduled",
        skip: 0,
        limit: 100,
      })
    },
  })

  const { data: publishedData, isLoading: isLoadingPublished } = useQuery({
    queryKey: ["posts", "published"],
    queryFn: async () => {
      return await PostsService.readPosts({
        status: "published",
        skip: 0,
        limit: 100,
      })
    },
  })

  // Transform API data to timeline posts
  const posts: TimelinePost[] = React.useMemo(() => {
    const scheduled: TimelinePost[] = (scheduledData?.data || [])
      .filter((p) => p.status === "scheduled" && p.scheduled_at)
      .map((p) => ({
        ...transformToScheduledPost({
          id: p.id,
          author: p.author as {
            name: string
            username: string
            avatarUrl?: string | null
          } | null,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at,
          scheduled_at: p.scheduled_at ?? null,
          platform: p.platform ?? "all",
        }),
        type: "scheduled" as const,
      }))

    const posted: TimelinePost[] = (publishedData?.data || [])
      .filter((p) => p.status === "published")
      .map((p) => ({
        ...transformToPostedPost({
          id: p.id,
          author: p.author as {
            name: string
            username: string
            avatarUrl?: string | null
          } | null,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at,
          likes: p.likes,
          reposts: p.reposts,
          comments: p.comments,
          platform: p.platform ?? "all",
        }),
        type: "posted" as const,
      }))

    return [...scheduled, ...posted]
  }, [scheduledData, publishedData])

  const isLoadingPosts = isLoadingScheduled || isLoadingPublished

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (postId: string) => {
      await PostsService.deletePost({ postId })
    },
    onSuccess: () => {
      if (postToDelete) {
        showSuccessToast("Post deleted successfully")
        setDeleteDialogOpen(false)
        setPostToDelete(null)
        // Invalidate and refetch posts
        queryClient.invalidateQueries({ queryKey: ["posts"] })
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      postId,
      data,
    }: {
      postId: string
      data: {
        content?: string
        image_url?: string
        platform?: string
        scheduled_at?: string
        status?: string
      }
    }) => {
      return await PostsService.updatePost({
        postId,
        requestBody: data,
      })
    },
    onSuccess: () => {
      showSuccessToast("Post updated successfully")
      setEditingPostId(null)
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  // Handle query errors
  React.useEffect(() => {
    // Errors are handled by React Query's onError in useQuery
  }, [])

  const handleDelete = (
    postId: string,
    type: "draft" | "scheduled" | "posted",
  ) => {
    setPostToDelete({ id: postId, type })
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (postToDelete) {
      deleteMutation.mutate(postToDelete.id)
    }
  }

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
    if (action === "delete") {
      handleDelete(postId, "posted")
    } else if (action === "preview") {
      handlePreview(postId)
    } else {
      // Handle post actions (like, repost, comment, share)
      console.log(`${action} post ${postId}`)
    }
  }

  const handleScheduledAction = (action: string, postId: string) => {
    if (action === "edit") {
      setEditingPostId(postId)
    } else if (action === "cancel" || action === "delete") {
      handleDelete(postId, "scheduled")
    } else if (action === "preview") {
      handlePreview(postId)
    } else {
      console.log(`${action} scheduled post ${postId}`)
    }
  }

  const handlePostEdit = (postId: string) => {
    setEditingPostId(postId)
  }

  const handleSave = (postId: string) => {
    // Find the post being edited
    const postToUpdate = posts.find((p) => p.id === postId)

    if (!postToUpdate) {
      showErrorToast("Post not found")
      return
    }

    // Prepare update data
    const updateData: {
      content?: string
      image_url?: string
      platform?: string
      scheduled_at?: string
      status?: string
    } = {
      content: postToUpdate.content,
      image_url: postToUpdate.imageUrl || undefined,
      platform: postToUpdate.platform,
    }

    // Add scheduled_at for scheduled posts
    if (postToUpdate.type === "scheduled" && postToUpdate.scheduledAt) {
      updateData.scheduled_at =
        typeof postToUpdate.scheduledAt === "string"
          ? postToUpdate.scheduledAt
          : postToUpdate.scheduledAt.toISOString()
    }

    updateMutation.mutate({ postId, data: updateData })
  }

  const handleCancel = () => {
    setEditingPostId(null)
  }

  const handlePlatformChange = (postId: string, platform: Platform) => {
    // Update platform via API
    updateMutation.mutate({
      postId,
      data: { platform },
    })
  }

  const convertToPreviewData = (post: TimelinePost): PreviewPostData => {
    if (post.type === "posted") {
      return {
        id: post.id,
        author: post.author,
        content: post.content,
        imageUrl: post.imageUrl,
        createdAt: post.createdAt,
        likes: post.likes,
        reposts: post.reposts,
        comments: post.comments,
      }
    }
    // scheduled
    return {
      id: post.id,
      author: post.author,
      content: post.content,
      imageUrl: post.imageUrl,
      createdAt: post.createdAt,
      scheduledAt: post.scheduledAt,
    }
  }

  const handlePreview = (postId: string) => {
    const post = posts.find((p) => p.id === postId)
    if (post) {
      setPreviewPost(convertToPreviewData(post))
      setPreviewDialogOpen(true)
    }
  }

  const handleTopicClick = (_topicId: string, hashtag: string) => {
    console.log(`View topic ${hashtag}`)
  }

  const handleClearFilters = () => {
    setDateFilter("all")
    setSortBy("newest")
  }

  const sortedPosts = React.useMemo(() => {
    const toTime = (d: Date | string) =>
      (typeof d === "string" ? new Date(d) : d).getTime()

    // Sort by relevant date: scheduledAt for scheduled posts, createdAt for posted posts
    const sorted = [...posts].sort((a, b) => {
      const aTime =
        a.type === "scheduled" ? toTime(a.scheduledAt) : toTime(a.createdAt)
      const bTime =
        b.type === "scheduled" ? toTime(b.scheduledAt) : toTime(b.createdAt)

      // Apply sort order based on sortBy filter
      if (sortBy === "oldest") {
        return aTime - bTime // Ascending: oldest first
      }
      return bTime - aTime // Descending: newest/future first
    })

    // TODO: Apply dateFilter filtering logic here
    return sorted
  }, [posts, sortBy])

  const renderPost = (post: TimelinePost) => {
    const isEditing = editingPostId === post.id

    switch (post.type) {
      case "scheduled":
        return (
          <ScheduledPost
            key={post.id}
            post={post}
            isEditing={isEditing}
            onEdit={(id) => handleScheduledAction("edit", id)}
            onDelete={(id) => handleScheduledAction("cancel", id)}
            onSave={(id) => handleSave(id)}
            onCancel={handleCancel}
            onPlatformChange={handlePlatformChange}
            onPreview={(id) => handleScheduledAction("preview", id)}
          />
        )
      case "posted":
        return (
          <Posted
            key={post.id}
            post={post}
            isEditing={isEditing}
            onLike={(id) => handlePostAction("like", id)}
            onRepost={(id) => handlePostAction("repost", id)}
            onComment={(id) => handlePostAction("comment", id)}
            onShare={(id) => handlePostAction("share", id)}
            onEdit={(id) => handlePostEdit(id)}
            onSave={(id) => handleSave(id)}
            onCancel={handleCancel}
            onPreview={(id) => handlePostAction("preview", id)}
            onDelete={(id) => handlePostAction("delete", id)}
            onPlatformChange={handlePlatformChange}
          />
        )
    }
  }

  const handlePostCreated = () => {
    // Posts will be refetched automatically via query invalidation
    queryClient.invalidateQueries({ queryKey: ["posts"] })
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
      {/* Main Timeline */}
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl flex flex-col h-[calc(100vh-3.5rem)] lg:h-screen">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (value === "ai") {
              navigate({ to: "/ai" })
            }
          }}
          className="w-full h-full flex flex-col"
        >
          {/* Tabs Header - Sticky */}
          <div className="sticky top-0 z-10 shrink-0 border-b bg-background/80 backdrop-blur-sm">
            <TabsList className="w-full h-auto p-0 bg-transparent rounded-none border-0 border-b border-border grid grid-cols-2 relative">
              <TabsTrigger
                value="timeline"
                className="relative flex-1 h-14 rounded-none border-0 border-b-2 border-transparent bg-transparent text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:z-10 font-semibold text-base transition-all hover:text-foreground hover:bg-accent/50 data-[state=active]:hover:bg-transparent"
              >
                <div className="flex items-center justify-center gap-2">
                  <HomeIcon className="h-4 w-4" />
                  <span>Timeline</span>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="ai"
                className="relative flex-1 h-14 rounded-none border-0 border-b-2 border-transparent bg-transparent text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:z-10 font-semibold text-base transition-all hover:text-foreground hover:bg-accent/50 data-[state=active]:hover:bg-transparent"
                asChild
              >
                <Link to="/ai">
                  <div className="flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    <span>AI</span>
                  </div>
                </Link>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Scrollable Content Area */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Timeline Tab */}
            <TabsContent value="timeline" className="mt-0">
              {/* PostInputBox at the beginning */}
              <div className="border-b p-4 shrink-0">
                <PostInputBox
                  username={user?.full_name || user?.email || "User"}
                  avatarUrl={undefined}
                  onSubmit={handlePostCreated}
                />
              </div>

              {/* Timeline Posts - Mixed scheduled and posted */}
              <div className="w-full pb-20">
                {isLoadingPosts ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="mt-4 text-sm text-muted-foreground">
                      Loading posts...
                    </p>
                  </div>
                ) : sortedPosts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                    <div className="rounded-full bg-muted/50 p-6 mb-4">
                      <HomeIcon className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-semibold mb-1">No posts yet</h3>
                    <p className="text-muted-foreground text-sm max-w-sm">
                      Your scheduled and published posts will appear here.
                      Create a post above to get started.
                    </p>
                  </div>
                ) : (
                  sortedPosts.map(renderPost)
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Right Sidebar - Sticky like left sidebar */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 h-screen overflow-y-auto p-4 space-y-6">
          <TimelineFilters
            dateFilter={dateFilter}
            sortBy={sortBy}
            onDateFilterChange={setDateFilter}
            onSortByChange={setSortBy}
            onClearFilters={handleClearFilters}
          />
          <TrendingTopics
            topics={trendingTopics}
            onTopicClick={handleTopicClick}
          />
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Post</DialogTitle>
            <DialogDescription>
              This post will be permanently deleted. Are you sure? You will not
              be able to undo this action.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              onClick={confirmDelete}
              loading={deleteMutation.isPending}
            >
              Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      {previewPost && (
        <PostPreviewDialog
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          post={previewPost}
          platform={
            posts.find((p) => p.id === previewPost.id)?.platform || "all"
          }
        />
      )}
    </div>
  )
}

export default TimelinePage
