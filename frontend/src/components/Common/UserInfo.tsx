import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { getInitials } from "@/utils"

interface UserInfoProps {
  fullName?: string
  email?: string
}

export function UserInfo({ fullName, email }: UserInfoProps) {
  return (
    <div className="flex items-center gap-3 w-full min-w-0 max-w-full">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-zinc-600 text-white text-xs">
          {getInitials(fullName || "User")}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col justify-center items-start min-w-0 flex-1 overflow-hidden text-left">
        <p className="text-sm font-medium text-foreground truncate w-full leading-5 text-left">
          {fullName}
        </p>
        <p className="text-xs text-muted-foreground truncate w-full leading-4 text-left">
          {email}
        </p>
      </div>
    </div>
  )
}
