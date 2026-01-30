import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Mail } from "lucide-react"
import { FaLinkedinIn } from "react-icons/fa"

import useAuth from "@/hooks/useAuth"
import { getInitials } from "@/utils"

export default function ProfileHeader() {
  const { user } = useAuth()
  const displayName = user?.full_name || "User"
  const initials = getInitials(displayName)

  return (
    <Card className="py-0">
      <CardContent className="px-6 py-4">
        <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
          <Avatar className="h-24 w-24">
            <AvatarImage src={undefined} alt="Profile" />
            <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <h1 className="text-2xl font-bold">{displayName}</h1>
              <Badge variant="secondary" className="pb-0">
                {user?.is_superuser ? "Admin" : "Member"}
              </Badge>
            </div>
            <div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-1">
                <Mail className="size-4" />
                {user?.email ?? "—"}
              </div>
              <div className="flex items-center gap-1">
                <FaLinkedinIn className="size-4 text-[#0A66C2]" />
                {user?.linkedin_username ?? "linkedin-username"}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
