import { Link } from "@tanstack/react-router"
import {
  ChevronsUpDown,
  HelpCircle,
  LogOut,
  Settings,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserInfo } from "@/components/Common/UserInfo"

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
    } else {
      console.log("Logout clicked")
    }
  }

  return (
    <div className="p-4">
      {/* Profile Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-start text-base h-auto py-2 px-3 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
          >
            <UserInfo fullName={fullName} email={email} />
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[--radix-dropdown-menu-trigger-width] min-w-56 max-w-64 rounded-lg"
          side="top"
          align="end"
          sideOffset={4}
        >
          <DropdownMenuLabel className="p-0 font-normal">
            <UserInfo fullName={fullName} email={email} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <Link to="/settings" onClick={onMenuClick}>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              User Settings
            </DropdownMenuItem>
          </Link>
          <Link to="/admin" onClick={onMenuClick}>
            <DropdownMenuItem>
              <Shield className="mr-2 h-4 w-4" />
              Admin
            </DropdownMenuItem>
          </Link>
          <DropdownMenuItem>
            <HelpCircle className="mr-2 h-4 w-4" />
            Help & Support
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
