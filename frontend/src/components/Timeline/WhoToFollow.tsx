import * as React from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getInitials } from "@/utils"

export interface UserToFollow {
  id: string
  name: string
  username: string
  avatarUrl?: string
}

interface WhoToFollowProps {
  users: UserToFollow[]
  onFollow?: (userId: string) => void
  title?: string
}

export function WhoToFollow({
  users,
  onFollow,
  title = "Who to follow",
}: WhoToFollowProps) {
  const [following, setFollowing] = React.useState<Set<string>>(new Set())

  const handleFollow = (userId: string) => {
    setFollowing((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
    onFollow?.(userId)
  }

  if (users.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {users.map((user) => {
            const isFollowing = following.has(user.id)
            const initials = getInitials(user.name)

            return (
              <div
                key={user.id}
                className="flex items-center justify-between gap-3 transition-colors hover:bg-accent/50 rounded-lg p-2 -m-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-10 w-10 shrink-0 cursor-pointer transition-transform hover:scale-105">
                    {user.avatarUrl ? (
                      <AvatarImage src={user.avatarUrl} alt={user.name} />
                    ) : null}
                    <AvatarFallback className="text-sm">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold">
                      {user.name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      @{user.username}
                    </p>
                  </div>
                </div>
                <Button
                  variant={isFollowing ? "default" : "outline"}
                  size="sm"
                  className="shrink-0 h-8 px-4 text-sm font-medium transition-colors"
                  onClick={() => handleFollow(user.id)}
                  aria-label={
                    isFollowing
                      ? `Unfollow ${user.name}`
                      : `Follow ${user.name}`
                  }
                >
                  {isFollowing ? "Following" : "Follow"}
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
