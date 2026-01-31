import { createFileRoute } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import * as React from "react"
import { Posted } from "@/components/Post/Posted"
import { ScheduledPost } from "@/components/Post/ScheduledPost"
import { PostInputBox } from "@/components/PostInput"
import {
  type TrendingTopic,
  TrendingTopics,
  TimelineFilters,
} from "@/components/Timeline"
import { scheduledPosts, postedPosts } from "./-postsData"
import type { PostedData } from "@/components/Post/Posted"
import type { ScheduledPostData } from "@/components/Post/ScheduledPost"
import { type Platform } from "@/components/Common/PlatformSelector"

// Union type for timeline posts
type TimelinePost = 
  | (PostedData & { type: "posted" })
  | (ScheduledPostData & { type: "scheduled" })
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
import { Button } from "@/components/ui/button"
import { ItemsService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { PostPreviewDialog, type PreviewPostData } from "@/components/Post/Previews"

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
  // TODO: Replace with API call once backend is implemented
  // Combine scheduled and posted posts for timeline
  const initialTimelinePosts: TimelinePost[] = React.useMemo(() => [
    ...scheduledPosts.map((post) => ({ ...post, type: "scheduled" as const })),
    ...postedPosts.map((post) => ({ ...post, type: "posted" as const })),
  ], [])
  
  const [posts, setPosts] = React.useState<TimelinePost[]>(initialTimelinePosts)

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
  const [previewPost, setPreviewPost] = React.useState<PreviewPostData | null>(null)
  
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteItem = async (id: string) => {
    await ItemsService.deleteItem({ id })
  }

  const deleteMutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => {
      if (postToDelete) {
        const { id } = postToDelete
        setPosts((prev) => prev.filter((post) => post.id !== id))
        showSuccessToast("Post deleted successfully")
        setDeleteDialogOpen(false)
        setPostToDelete(null)
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleDelete = (postId: string, type: "draft" | "scheduled" | "posted") => {
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
    // TODO: Save changes to backend
    console.log(`Saving post ${postId}`)
    setEditingPostId(null)
  }

  const handleCancel = () => {
    setEditingPostId(null)
  }

  const handlePlatformChange = (
    postId: string,
    platform: Platform,
  ) => {
    // Update platform in state
    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId ? { ...post, platform } : post
      )
    )
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
    } else {
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
      const aTime = a.type === "scheduled" 
        ? toTime(a.scheduledAt) 
        : toTime(a.createdAt)
      const bTime = b.type === "scheduled" 
        ? toTime(b.scheduledAt) 
        : toTime(b.createdAt)
      
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
            onMore={(id) => handleScheduledAction("more", id)}
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

  return (
    <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
      {/* Main Timeline */}
      <div className="border-border min-w-0 flex-1 border-r md:max-w-2xl min-h-full">
        {/* Post Composer */}
        <div className="border-b p-3 sm:p-4">
          <PostInputBox username="Jane Doe" />
        </div>

        {/* Timeline Posts - Mixed drafts, scheduled, and posted */}
        <div className="w-full">
          {sortedPosts.map(renderPost)}
        </div>
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
          platform={posts.find((p) => p.id === previewPost.id)?.platform || "all"}
        />
      )}
    </div>
  )
}

export default TimelinePage
