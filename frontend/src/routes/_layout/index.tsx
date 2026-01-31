import { createFileRoute } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import * as React from "react"
import { Posted } from "@/components/Post/Posted"
import { DraftPost } from "@/components/Post/DraftPost"
import { ScheduledPost } from "@/components/Post/ScheduledPost"
import { PostInputBox } from "@/components/PostInput"
import {
  type TrendingTopic,
  TrendingTopics,
  type UserToFollow,
  WhoToFollow,
} from "@/components/Timeline"
import { timelinePosts as initialTimelinePosts, type TimelinePost } from "./-timelineData"
import { type Platform } from "@/components/Common/PlatformSelector"
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
  // Currently using mock data from timelineData.ts
  const [posts, setPosts] = React.useState<TimelinePost[]>(initialTimelinePosts)

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
    if (action === "delete") {
      handleDelete(postId, "posted")
    } else if (action === "preview") {
      handlePreview(postId)
    } else {
      // Handle post actions (like, repost, comment, share)
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
    } else if (post.type === "scheduled") {
      return {
        id: post.id,
        author: post.author,
        content: post.content,
        imageUrl: post.imageUrl,
        createdAt: post.createdAt,
        scheduledAt: post.scheduledAt,
      }
    } else {
      // draft
      return {
        id: post.id,
        author: post.author,
        content: post.content,
        imageUrl: post.imageUrl,
        createdAt: post.createdAt,
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

  const handleFollow = (userId: string) => {
    console.log(`Follow user ${userId}`)
  }

  const handleTopicClick = (_topicId: string, hashtag: string) => {
    console.log(`View topic ${hashtag}`)
  }

  const renderPost = (post: TimelinePost) => {
    const isEditing = editingPostId === post.id

    switch (post.type) {
      case "draft":
        return (
          <DraftPost
            key={post.id}
            post={post}
            isEditing={isEditing}
            onEdit={(id) => handleDraftAction("edit", id)}
            onDelete={(id) => handleDraftAction("delete", id)}
            onSave={(id) => handleSave(id)}
            onCancel={handleCancel}
            onPlatformChange={handlePlatformChange}
            onPreview={(id) => handleDraftAction("preview", id)}
            onMore={(id) => handleDraftAction("more", id)}
          />
        )
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
          {posts.map(renderPost)}
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
