import { Link } from "@tanstack/react-router"
import { ChevronsUpDown, Layers, LogOut, Settings } from "lucide-react"
import { UserInfo } from "@/components/Common/UserInfo"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface SidebarProfileProps {
  fullName?: string
  email?: string
  onMenuClick?: () => void
  onLogout?: () => void
}

export function SidebarProfile({
  fullName,
  email,
  onMenuClick,
  onLogout,
}: SidebarProfileProps) {
  const handleLogout = () => {
    if (onLogout) {
      onLogout()
    }
  }

  return (
    <div className="p-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-start text-sm h-auto py-2 px-3 rounded-2xl border border-transparent hover:border-border/60 hover:bg-muted/40 transition-all select-none cursor-pointer focus:outline-none focus-visible:ring-0 focus-visible:outline-none data-[state=open]:bg-muted/60 data-[state=open]:border-border/80"
          >
            <UserInfo fullName={fullName} email={email} />
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[--radix-dropdown-menu-trigger-width] min-w-56 max-w-64 rounded-xl shadow-lg border border-border/80"
          side="top"
          align="end"
          sideOffset={8}
        >
          <DropdownMenuLabel className="p-2 font-normal">
            <UserInfo fullName={fullName} email={email} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <Link to="/settings" onClick={onMenuClick}>
            <DropdownMenuItem className="rounded-lg cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </Link>
          <Link to="/about" onClick={onMenuClick}>
            <DropdownMenuItem className="rounded-lg cursor-pointer">
              <Layers className="mr-2 h-4 w-4" />
              Brand Kit
            </DropdownMenuItem>
          </Link>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            className="rounded-lg cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
