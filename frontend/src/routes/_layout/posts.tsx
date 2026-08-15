import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Globe,
  Loader2,
  TrendingUp,
  X,
} from "lucide-react"
import * as React from "react"
import { PostsService, type PostUpdate } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import {
  DraftPost,
  FailedPost,
  Posted,
  ScheduledPost,
} from "@/components/Post/PostCard"
import {
  PostPreviewDialog,
  type PreviewPostData,
} from "@/components/Post/Previews"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import {
  handleError,
  transformToDraftPost,
  transformToFailedPost,
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

type PostCategory = "drafts" | "scheduled" | "posted" | "failed"

function isWithinDateRange(
  dateStrOrObj: Date | string,
  range: string,
): boolean {
  if (range === "all") return true
  const date =
    typeof dateStrOrObj === "string" ? new Date(dateStrOrObj) : dateStrOrObj
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)
  const diffDays = diffHours / 24

  switch (range) {
    case "today":
      return diffHours <= 24 && date.getDate() === now.getDate()
    case "week":
      return diffDays <= 7
    case "month":
      return diffDays <= 30
    case "quarter":
      return diffDays <= 90
    case "year":
      return diffDays <= 365
    default:
      return true
  }
}

function matchesPlatform(
  postPlatform?: string,
  filterPlatform?: string,
): boolean {
  if (!filterPlatform || filterPlatform === "all") return true
  const p = postPlatform === "all" ? "linkx" : postPlatform
  return p === filterPlatform
}

function PostsPage() {
  const queryClient = useQueryClient()
  const [activeCategory, setActiveCategory] =
    React.useState<PostCategory>("drafts")
  const [dateFilter, setDateFilter] = React.useState<string>("all")
  const [platformFilter, setPlatformFilter] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<string>("newest")
  const [editingPostId, setEditingPostId] = React.useState<string | null>(null)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [postToDelete, setPostToDelete] = React.useState<{
    id: string
    category: PostCategory
  } | null>(null)

  // Preview dialog state
  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [previewPost, setPreviewPost] = React.useState<PreviewPostData | null>(
    null,
  )
  const [previewPostPlatform, setPreviewPostPlatform] =
    React.useState<Platform>("linkedin")

  const { showSuccessToast, showErrorToast } = useCustomToast()

  // Fetch all user posts
  const {
    data: postsData,
    isLoading: isLoadingPosts,
    error: postsError,
  } = useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      return await PostsService.readPosts({
        skip: 0,
        limit: 200,
      })
    },
    staleTime: 15000,
  })

  // Categorize raw posts
  const rawDrafts = React.useMemo(() => {
    return postsData?.data?.filter((p) => p.status === "draft") ?? []
  }, [postsData])

  const rawScheduled = React.useMemo(() => {
    return (
      postsData?.data?.filter(
        (p) => p.status === "scheduled" && p.scheduled_at,
      ) ?? []
    )
  }, [postsData])

  const rawPosted = React.useMemo(() => {
    return postsData?.data?.filter((p) => p.status === "published") ?? []
  }, [postsData])

  const rawFailed = React.useMemo(() => {
    return postsData?.data?.filter((p) => p.status === "failed") ?? []
  }, [postsData])

  // Transform to component data
  const allDraftPosts = React.useMemo(() => {
    return rawDrafts.map((p) =>
      transformToDraftPost({
        id: p.id,
        author: p.author as any,
        content: p.content,
        image_url: p.image_url ?? null,
        created_at: p.created_at ?? new Date().toISOString(),
        platform: p.platform ?? "linkx",
      }),
    )
  }, [rawDrafts])

  const allScheduledPosts = React.useMemo(() => {
    return rawScheduled.map((p) =>
      transformToScheduledPost({
        id: p.id,
        author: p.author as any,
        content: p.content,
        image_url: p.image_url ?? null,
        created_at: p.created_at ?? new Date().toISOString(),
        scheduled_at: p.scheduled_at ?? null,
        platform: p.platform ?? "linkx",
      }),
    )
  }, [rawScheduled])

  const allPostedPosts = React.useMemo(() => {
    return rawPosted.map((p) =>
      transformToPostedPost({
        id: p.id,
        author: p.author as any,
        content: p.content,
        image_url: p.image_url ?? null,
        created_at: p.created_at ?? new Date().toISOString(),
        likes: p.likes ?? 0,
        reposts: p.reposts ?? 0,
        comments: p.comments ?? 0,
        platform: p.platform ?? "linkx",
      }),
    )
  }, [rawPosted])

  const allFailedPosts = React.useMemo(() => {
    return rawFailed.map((p) =>
      transformToFailedPost({
        id: p.id,
        author: p.author as any,
        content: p.content,
        image_url: p.image_url ?? null,
        created_at: p.created_at ?? new Date().toISOString(),
        platform: p.platform ?? "linkx",
        error_reason: p.error_message ?? null,
      }),
    )
  }, [rawFailed])

  // Apply filters and sorting to the active category
  const activePosts = React.useMemo(() => {
    let sourceList: any[] = []
    if (activeCategory === "drafts") sourceList = allDraftPosts
    else if (activeCategory === "scheduled") sourceList = allScheduledPosts
    else if (activeCategory === "posted") sourceList = allPostedPosts
    else if (activeCategory === "failed") sourceList = allFailedPosts

    // 1. Date filter
    const filteredByDate = sourceList.filter((item) => {
      const dateVal =
        activeCategory === "scheduled" && item.scheduledAt
          ? item.scheduledAt
          : item.createdAt
      return isWithinDateRange(dateVal, dateFilter)
    })

    // 2. Platform filter
    const filteredByPlatform = filteredByDate.filter((item) =>
      matchesPlatform(item.platform, platformFilter),
    )

    // 3. Sorting
    return [...filteredByPlatform].sort((a, b) => {
      if (sortBy === "oldest") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }
      if (sortBy === "scheduled" && a.scheduledAt && b.scheduledAt) {
        return (
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        )
      }
      if (sortBy === "engagement") {
        const aScore =
          (a.likes || 0) + (a.reposts || 0) * 2 + (a.comments || 0) * 3
        const bScore =
          (b.likes || 0) + (b.reposts || 0) * 2 + (b.comments || 0) * 3
        return bScore - aScore
      }
      // Default: newest first
      const aTime =
        a.scheduledAt && activeCategory === "scheduled"
          ? new Date(a.scheduledAt).getTime()
          : new Date(a.createdAt).getTime()
      const bTime =
        b.scheduledAt && activeCategory === "scheduled"
          ? new Date(b.scheduledAt).getTime()
          : new Date(b.createdAt).getTime()
      return bTime - aTime
    })
  }, [
    activeCategory,
    allDraftPosts,
    allScheduledPosts,
    allPostedPosts,
    allFailedPosts,
    dateFilter,
    platformFilter,
    sortBy,
  ])

  const hasActiveFilters =
    dateFilter !== "all" || platformFilter !== "all" || sortBy !== "newest"

  const handleClearFilters = () => {
    setDateFilter("all")
    setPlatformFilter("all")
    setSortBy("newest")
  }

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (postId: string) => {
      await PostsService.deleteExistingPost({ postId })
    },
    onSuccess: () => {
      if (postToDelete) {
        showSuccessToast("Post deleted successfully")
        setDeleteDialogOpen(false)
        setPostToDelete(null)
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
      data: PostUpdate
    }) => {
      return await PostsService.updateExistingPost({
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

  // Retry failed post mutation
  const retryMutation = useMutation({
    mutationFn: async (postId: string) => {
      return await PostsService.retryFailedPost({ postId })
    },
    onSuccess: () => {
      showSuccessToast("Post retry scheduled")
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleDelete = (postId: string, category: PostCategory) => {
    setPostToDelete({ id: postId, category })
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (postToDelete) {
      deleteMutation.mutate(postToDelete.id)
    }
  }

  const handleSavePost = (
    postId: string,
    data: { content: string; platform: Platform; scheduledAt?: Date | null },
  ) => {
    updateMutation.mutate({
      postId,
      data: {
        content: data.content,
        platform: data.platform,
        scheduled_at: data.scheduledAt
          ? data.scheduledAt.toISOString()
          : undefined,
      },
    })
  }

  const handlePlatformChange = (postId: string, platform: Platform) => {
    updateMutation.mutate({
      postId,
      data: { platform },
    })
  }

  const handlePreview = (postId: string) => {
    const post = activePosts.find((p) => p.id === postId)
    if (post) {
      setPreviewPost({
        id: post.id,
        author: {
          name: post.author.name,
          username: post.author.username,
          avatarUrl: post.author.avatarUrl ?? undefined,
        },
        content: post.content,
        imageUrl: post.imageUrl ?? undefined,
        createdAt: post.createdAt,
        scheduledAt: post.scheduledAt ?? undefined,
        likes: post.likes,
        reposts: post.reposts,
        comments: post.comments,
      })
      setPreviewPostPlatform(post.platform || "linkx")
      setPreviewDialogOpen(true)
    }
  }

  // Error handling
  React.useEffect(() => {
    if (postsError) {
      handleError.bind(showErrorToast)(postsError as any)
    }
  }, [postsError, showErrorToast])

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)]">
      {/* Middle Column - Posts Feed (No header, clean & seamless) */}
      <div className="border-border min-w-0 flex-1 border-r-0 md:border-r md:max-w-2xl flex flex-col">
        {/* Mobile-only Category Navigation Pills */}
        <div className="flex items-center gap-1.5 p-2.5 border-b overflow-x-auto scrollbar-none md:hidden bg-background/90 backdrop-blur-xs sticky top-0 z-10">
          <Button
            variant={activeCategory === "drafts" ? "default" : "secondary"}
            size="sm"
            onClick={() => setActiveCategory("drafts")}
            className="h-7 px-3 text-xs rounded-full shrink-0 font-medium"
          >
            <FileText className="h-3 w-3 mr-1" />
            Drafts ({allDraftPosts.length})
          </Button>
          <Button
            variant={activeCategory === "scheduled" ? "default" : "secondary"}
            size="sm"
            onClick={() => setActiveCategory("scheduled")}
            className="h-7 px-3 text-xs rounded-full shrink-0 font-medium"
          >
            <Calendar className="h-3 w-3 mr-1" />
            Scheduled ({allScheduledPosts.length})
          </Button>
          <Button
            variant={activeCategory === "posted" ? "default" : "secondary"}
            size="sm"
            onClick={() => setActiveCategory("posted")}
            className="h-7 px-3 text-xs rounded-full shrink-0 font-medium"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Posted ({allPostedPosts.length})
          </Button>
          <Button
            variant={activeCategory === "failed" ? "destructive" : "secondary"}
            size="sm"
            onClick={() => setActiveCategory("failed")}
            className={`h-7 px-3 text-xs rounded-full shrink-0 font-medium ${
              allFailedPosts.length > 0 && activeCategory !== "failed"
                ? "text-destructive"
                : ""
            }`}
          >
            <AlertCircle className="h-3 w-3 mr-1" />
            Failed ({allFailedPosts.length})
          </Button>
        </div>

        {/* Content Area */}
        <div className="w-full">
          {isLoadingPosts ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="mt-4 text-sm text-muted-foreground">
                Loading posts...
              </p>
            </div>
          ) : activePosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20 px-4">
              <div className="rounded-full bg-muted/50 p-6 mb-4">
                {activeCategory === "drafts" && (
                  <FileText className="h-10 w-10 text-muted-foreground" />
                )}
                {activeCategory === "scheduled" && (
                  <Calendar className="h-10 w-10 text-muted-foreground" />
                )}
                {activeCategory === "posted" && (
                  <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
                )}
                {activeCategory === "failed" && (
                  <AlertCircle className="h-10 w-10 text-destructive/80" />
                )}
              </div>
              <h3 className="text-xl font-semibold mb-1">
                {hasActiveFilters
                  ? "No matching posts found"
                  : activeCategory === "drafts"
                    ? "No drafts"
                    : activeCategory === "scheduled"
                      ? "No scheduled posts"
                      : activeCategory === "posted"
                        ? "No published content"
                        : "No failed posts"}
              </h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                {hasActiveFilters
                  ? "Try clearing or relaxing your date and platform filters."
                  : activeCategory === "drafts"
                    ? "Your draft posts will appear here. Start writing to save ideas for later."
                    : activeCategory === "scheduled"
                      ? "Posts you schedule for future publication will appear here."
                      : activeCategory === "posted"
                        ? "Your successfully published posts across LinkedIn and X will appear here."
                        : "Great job! All your scheduled and published posts completed with zero errors."}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearFilters}
                  className="mt-4 rounded-full"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="w-full pb-20">
              {activePosts.map((post) => {
                const isEditing = editingPostId === post.id

                if (activeCategory === "drafts") {
                  return (
                    <DraftPost
                      key={post.id}
                      post={post}
                      isEditing={isEditing}
                      onEdit={(id) => setEditingPostId(id)}
                      onDelete={(id) => handleDelete(id, "drafts")}
                      onSave={handleSavePost}
                      onCancel={() => setEditingPostId(null)}
                      onPlatformChange={handlePlatformChange}
                      onPreview={handlePreview}
                    />
                  )
                }

                if (activeCategory === "scheduled") {
                  return (
                    <ScheduledPost
                      key={post.id}
                      post={post}
                      isEditing={isEditing}
                      onEdit={(id) => setEditingPostId(id)}
                      onDelete={(id) => handleDelete(id, "scheduled")}
                      onSave={handleSavePost}
                      onCancel={() => setEditingPostId(null)}
                      onPlatformChange={handlePlatformChange}
                      onPreview={handlePreview}
                    />
                  )
                }

                if (activeCategory === "posted") {
                  return (
                    <Posted
                      key={post.id}
                      post={post}
                      onPreview={handlePreview}
                      onDelete={(id) => handleDelete(id, "posted")}
                    />
                  )
                }

                // Failed
                return (
                  <FailedPost
                    key={post.id}
                    post={post}
                    isEditing={isEditing}
                    onEdit={(id) => setEditingPostId(id)}
                    onDelete={(id) => handleDelete(id, "failed")}
                    onSave={handleSavePost}
                    onCancel={() => setEditingPostId(null)}
                    onPlatformChange={handlePlatformChange}
                    onPreview={handlePreview}
                    onRetry={(id) => retryMutation.mutate(id)}
                    isRetrying={
                      retryMutation.isPending &&
                      retryMutation.variables === post.id
                    }
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar - Matches Trending Topics Card Design & Structure */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 self-start p-4 space-y-4">
          {/* Post Status Card */}
          <div className="w-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-none">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Post Status
              </h2>
            </div>
            <div className="w-full divide-y divide-border/30">
              {/* Drafts */}
              <button
                type="button"
                onClick={() => setActiveCategory("drafts")}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors cursor-pointer text-left ${
                  activeCategory === "drafts"
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-foreground hover:bg-muted/30"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <FileText className="h-4 w-4" />
                  Drafts
                </span>
                <Badge
                  variant={
                    activeCategory === "drafts" ? "default" : "secondary"
                  }
                  className="font-semibold text-xs px-2 rounded-full"
                >
                  {allDraftPosts.length}
                </Badge>
              </button>

              {/* Scheduled */}
              <button
                type="button"
                onClick={() => setActiveCategory("scheduled")}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors cursor-pointer text-left ${
                  activeCategory === "scheduled"
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-foreground hover:bg-muted/30"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Calendar className="h-4 w-4" />
                  Scheduled
                </span>
                <Badge
                  variant={
                    activeCategory === "scheduled" ? "default" : "secondary"
                  }
                  className="font-semibold text-xs px-2 rounded-full"
                >
                  {allScheduledPosts.length}
                </Badge>
              </button>

              {/* Posted */}
              <button
                type="button"
                onClick={() => setActiveCategory("posted")}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors cursor-pointer text-left ${
                  activeCategory === "posted"
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-foreground hover:bg-muted/30"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Posted
                </span>
                <Badge
                  variant={
                    activeCategory === "posted" ? "default" : "secondary"
                  }
                  className="font-semibold text-xs px-2 rounded-full"
                >
                  {allPostedPosts.length}
                </Badge>
              </button>

              {/* Failed */}
              <button
                type="button"
                onClick={() => setActiveCategory("failed")}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors cursor-pointer text-left ${
                  activeCategory === "failed"
                    ? "bg-destructive/15 text-destructive font-semibold"
                    : allFailedPosts.length > 0
                      ? "text-destructive hover:bg-destructive/10"
                      : "text-foreground hover:bg-muted/30"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <AlertCircle className="h-4 w-4" />
                  Failed
                </span>
                <Badge
                  variant={
                    activeCategory === "failed"
                      ? "destructive"
                      : allFailedPosts.length > 0
                        ? "destructive"
                        : "secondary"
                  }
                  className="font-semibold text-xs px-2 rounded-full"
                >
                  {allFailedPosts.length}
                </Badge>
              </button>
            </div>
          </div>

          {/* Filters & Sorting Card - Same Trending Topics Design System */}
          <div className="w-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-none">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
              <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </h2>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-xs font-semibold text-primary hover:underline cursor-pointer flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
            <div className="p-4 space-y-4">
              {/* Date Range Filter */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Date Range
                </span>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-full h-9 text-xs rounded-xl bg-muted/20 border-border/70 focus:ring-1 focus:ring-primary">
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

              {/* Platform Filter */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  Platform
                </span>
                <Select
                  value={platformFilter}
                  onValueChange={setPlatformFilter}
                >
                  <SelectTrigger className="w-full h-9 text-xs rounded-xl bg-muted/20 border-border/70 focus:ring-1 focus:ring-primary">
                    <SelectValue placeholder="Select platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Platforms</SelectItem>
                    <SelectItem value="linkx">LinkX (Both)</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="x">X (Twitter)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort By Filter */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Sort By
                </span>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full h-9 text-xs rounded-xl bg-muted/20 border-border/70 focus:ring-1 focus:ring-primary">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest First</SelectItem>
                    <SelectItem value="oldest">Oldest First</SelectItem>
                    {activeCategory === "scheduled" && (
                      <SelectItem value="scheduled">Scheduled Date</SelectItem>
                    )}
                    {activeCategory === "posted" && (
                      <SelectItem value="engagement">Engagement</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Post</DialogTitle>
            <DialogDescription>
              This will remove the post record from your LinkX database.
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
