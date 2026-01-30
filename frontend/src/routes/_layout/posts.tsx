import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Loader2,
  TrendingUp,
  X,
} from "lucide-react"
import * as React from "react"
import { PostsService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import type { DraftPostData } from "@/components/Post/DraftPost"
import { DraftPost } from "@/components/Post/DraftPost"
import type { PostedData } from "@/components/Post/Posted"
import { Posted } from "@/components/Post/Posted"
import {
  PostPreviewDialog,
  type PreviewPostData,
} from "@/components/Post/Previews"
import type { ScheduledPostData } from "@/components/Post/ScheduledPost"
import { ScheduledPost } from "@/components/Post/ScheduledPost"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useCustomToast from "@/hooks/useCustomToast"
import {
  handleError,
  transformToDraftPost,
  transformToPostedPost,
  transformToScheduledPost,
} from "@/utils"

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
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = React.useState<
    "drafts" | "scheduled" | "posted"
  >("drafts")
  const [dateFilter, setDateFilter] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<string>("newest")
  const [hasFilters, setHasFilters] = React.useState(false)
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
  const [previewPostPlatform, setPreviewPostPlatform] =
    React.useState<Platform>("all")

  const { showSuccessToast, showErrorToast } = useCustomToast()

  // Map activeTab to API status filter
  const statusFilter = React.useMemo(() => {
    if (activeTab === "drafts") return "draft"
    if (activeTab === "scheduled") return "scheduled"
    if (activeTab === "posted") return "published"
    return undefined
  }, [activeTab])

  // Fetch posts from API - refetch when tab changes
  const {
    data: postsData,
    isLoading: isLoadingPosts,
    error: postsError,
  } = useQuery({
    queryKey: ["posts", statusFilter],
    queryFn: async () => {
      return await PostsService.readPosts({
        status: statusFilter,
        skip: 0,
        limit: 100,
      })
    },
    enabled: true, // Always fetch when component mounts
    staleTime: 30000, // Consider data fresh for 30 seconds
  })

  // Transform API data to component types
  const draftPosts = React.useMemo(() => {
    if (!postsData || activeTab !== "drafts") return []
    return postsData.data
      .filter((p) => p.status === "draft")
      .map((p) => {
        const author = p.author as {
          name: string
          username: string
          avatarUrl?: string | null
        } | null
        return transformToDraftPost({
          id: p.id,
          author,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at,
          platform: p.platform ?? "all",
        })
      })
  }, [postsData, activeTab])

  const scheduledPosts = React.useMemo(() => {
    if (!postsData || activeTab !== "scheduled") return []
    return postsData.data
      .filter((p) => p.status === "scheduled" && p.scheduled_at)
      .map((p) => {
        const author = p.author as {
          name: string
          username: string
          avatarUrl?: string | null
        } | null
        return transformToScheduledPost({
          id: p.id,
          author,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at,
          scheduled_at: p.scheduled_at,
          platform: p.platform ?? "all",
        })
      })
  }, [postsData, activeTab])

  const postedPosts = React.useMemo(() => {
    if (!postsData || activeTab !== "posted") return []
    return postsData.data
      .filter((p) => p.status === "published")
      .map((p) => {
        const author = p.author as {
          name: string
          username: string
          avatarUrl?: string | null
        } | null
        return transformToPostedPost({
          id: p.id,
          author,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at,
          likes: p.likes,
          reposts: p.reposts,
          comments: p.comments,
          platform: p.platform ?? "all",
        })
      })
  }, [postsData, activeTab])

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

  const handlePostAction = (action: string, postId: string) => {
    if (action === "delete") {
      handleDelete(postId, "posted")
    } else if (action === "preview") {
      handlePreview(postId)
    } else {
      console.log(`${action} post ${postId}`)
    }
  }

  const handleDraftAction = (action: string, postId: string) => {
    if (action === "edit") {
      setEditingPostId(postId)
    } else if (action === "delete") {
      handleDelete(postId, "draft")
    } else if (action === "preview") {
      handlePreview(postId)
    } else {
      console.log(`${action} draft ${postId}`)
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
    let postToUpdate: DraftPostData | ScheduledPostData | PostedData | undefined

    if (activeTab === "drafts") {
      postToUpdate = draftPosts.find((p) => p.id === postId)
    } else if (activeTab === "scheduled") {
      postToUpdate = scheduledPosts.find((p) => p.id === postId)
    } else if (activeTab === "posted") {
      postToUpdate = postedPosts.find((p) => p.id === postId)
    }

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
    if ("scheduledAt" in postToUpdate && postToUpdate.scheduledAt) {
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

  const convertToPreviewData = (
    post: DraftPostData | ScheduledPostData | PostedData,
  ): PreviewPostData => {
    if ("likes" in post && "reposts" in post && "comments" in post) {
      // PostedData
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
    if ("scheduledAt" in post) {
      // ScheduledPostData
      return {
        id: post.id,
        author: post.author,
        content: post.content,
        imageUrl: post.imageUrl,
        createdAt: post.createdAt,
        scheduledAt: post.scheduledAt,
      }
    }
    // DraftPostData
    return {
      id: post.id,
      author: post.author,
      content: post.content,
      imageUrl: post.imageUrl,
      createdAt: post.createdAt,
    }
  }

  const handlePreview = (postId: string) => {
    let post: DraftPostData | ScheduledPostData | PostedData | undefined
    let platform: Platform = "all"

    if (activeTab === "drafts") {
      post = draftPosts.find((p) => p.id === postId)
      platform = post?.platform || "all"
    } else if (activeTab === "scheduled") {
      post = scheduledPosts.find((p) => p.id === postId)
      platform = post?.platform || "all"
    } else if (activeTab === "posted") {
      post = postedPosts.find((p) => p.id === postId)
      platform = post?.platform || "all"
    }

    if (post) {
      setPreviewPost(convertToPreviewData(post))
      setPreviewPostPlatform(platform)
      setPreviewDialogOpen(true)
    }
  }

  // Handle query errors
  React.useEffect(() => {
    if (postsError) {
      handleError.bind(showErrorToast)(postsError as any)
    }
  }, [postsError, showErrorToast])

  const handleClearFilters = () => {
    setDateFilter("all")
    setSortBy("newest")
    setHasFilters(false)
  }

  React.useEffect(() => {
    setHasFilters(dateFilter !== "all" || sortBy !== "newest")
  }, [dateFilter, sortBy])

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)]">
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl flex flex-col">
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as "drafts" | "scheduled" | "posted")
          }
          className="w-full flex flex-col"
        >
          {/* Tabs Header - Sticky */}
          <div className="sticky top-0 z-10 shrink-0 border-b bg-background/80 backdrop-blur-sm">
            <TabsList className="w-full h-auto p-0 bg-transparent rounded-none border-0 border-b border-border grid grid-cols-3 relative">
              <TabsTrigger
                value="drafts"
                className="relative flex-1 h-14 rounded-none border-0 border-b-2 border-transparent bg-transparent text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:z-10 font-semibold text-base transition-all hover:text-foreground hover:bg-accent/50 data-[state=active]:hover:bg-transparent"
              >
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>Drafts</span>
                  {draftPosts.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 h-5 min-w-5 px-1.5 text-xs font-normal"
                    >
                      {draftPosts.length}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="scheduled"
                className="relative flex-1 h-14 rounded-none border-0 border-b-2 border-transparent bg-transparent text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:z-10 font-semibold text-base transition-all hover:text-foreground hover:bg-accent/50 data-[state=active]:hover:bg-transparent"
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
                className="relative flex-1 h-14 rounded-none border-0 border-b-2 border-transparent bg-transparent text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:z-10 font-semibold text-base transition-all hover:text-foreground hover:bg-accent/50 data-[state=active]:hover:bg-transparent"
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
          </div>

          {/* Content Area - page scrolls */}
          <div className="w-full">
            {/* Drafts Tab */}
            <TabsContent value="drafts" className="mt-0">
              {isLoadingPosts ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    Loading posts...
                  </p>
                </div>
              ) : draftPosts.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                  <div className="rounded-full bg-muted/50 p-6 mb-4">
                    <FileText className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-1">No drafts</h3>
                  <p className="text-muted-foreground text-sm max-w-sm">
                    Your draft posts will appear here. Start writing to save
                    your ideas for later.
                  </p>
                </div>
              ) : (
                <div className="w-full pb-20">
                  {draftPosts.map((post) => (
                    <DraftPost
                      key={post.id}
                      post={post}
                      isEditing={editingPostId === post.id}
                      onEdit={(id) => handleDraftAction("edit", id)}
                      onDelete={(id) => handleDraftAction("delete", id)}
                      onSave={(id) => handleSave(id)}
                      onCancel={handleCancel}
                      onPlatformChange={handlePlatformChange}
                      onPreview={(id) => handleDraftAction("preview", id)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Scheduled Tab */}
            <TabsContent value="scheduled" className="mt-0">
              {isLoadingPosts ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    Loading posts...
                  </p>
                </div>
              ) : scheduledPosts.length === 0 ? (
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
                <div className="w-full pb-20">
                  {scheduledPosts.map((post) => (
                    <ScheduledPost
                      key={post.id}
                      post={post}
                      isEditing={editingPostId === post.id}
                      onEdit={(id) => handleScheduledAction("edit", id)}
                      onDelete={(id) => handleScheduledAction("cancel", id)}
                      onSave={(id) => handleSave(id)}
                      onCancel={handleCancel}
                      onPlatformChange={handlePlatformChange}
                      onPreview={(id) => handleScheduledAction("preview", id)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Posted Tab */}
            <TabsContent value="posted" className="mt-0">
              {isLoadingPosts ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    Loading posts...
                  </p>
                </div>
              ) : postedPosts.length === 0 ? (
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
                <div className="w-full pb-20">
                  {postedPosts.map((post) => (
                    <Posted
                      key={post.id}
                      post={post}
                      isEditing={editingPostId === post.id}
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
                  ))}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Right Sidebar - Filters */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 self-start p-4 space-y-4">
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
                    {activeTab === "scheduled" && (
                      <SelectItem value="scheduled">Scheduled Date</SelectItem>
                    )}
                    {activeTab === "posted" && (
                      <SelectItem value="engagement">Engagement</SelectItem>
                    )}
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
              <CardTitle className="text-base font-semibold">
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Drafts</span>
                <Badge variant="secondary" className="font-semibold">
                  {draftPosts.length}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Scheduled</span>
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
                  {draftPosts.length +
                    scheduledPosts.length +
                    postedPosts.length}
                </span>
              </div>
            </CardContent>
          </Card>
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
          platform={previewPostPlatform}
        />
      )}
    </div>
  )
}

export default PostsPage
