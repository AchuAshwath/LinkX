"use client"

import { Link } from "@tanstack/react-router"
import { ChevronsUpDown, LogOut, Settings, User, HelpCircle } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Bell,
  MessageCircle,
  Bookmark,
  X,
  Palette,
  Home,
  Monitor,
  Moon,
  Sun,
  Shield,
  Package,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Logo } from "@/components/Common/Logo"
import { useTheme } from "@/components/theme-provider"
import { getInitials } from "@/utils"

interface TimelineSidebarProps {
  sidebarOpen: boolean
  onClose: () => void
}

function UserInfo({ fullName, email }: { fullName?: string; email?: string }) {
  return (
    <div className="flex items-center gap-3 w-full min-w-0 max-w-full">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-zinc-600 text-white text-xs">
          {getInitials(fullName || "User")}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col justify-center items-start min-w-0 flex-1 overflow-hidden text-left">
        <p className="text-sm font-medium text-foreground truncate w-full leading-5 text-left">{fullName}</p>
        <p className="text-xs text-muted-foreground truncate w-full leading-4 text-left">{email}</p>
      </div>
    </div>
  )
}

export function TimelineSidebar({ sidebarOpen, onClose }: TimelineSidebarProps) {
  const { setTheme } = useTheme()

  // Mock user data for development
  const mockUser = {
    full_name: "John Doe",
    email: "john.doe@example.com",
  }

  const handleMenuClick = () => {
    if (sidebarOpen) {
      onClose()
    }
  }

  const handleLogout = () => {
    console.log("Logout clicked")
  }

  return (
    <div
      className={`fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-64 flex-col bg-background transition-transform lg:top-0 lg:h-screen lg:sticky lg:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}
    >
      {/* Logo Header */}
      <div className="p-4">
        <Logo variant="full" className="h-6" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <h2 className="text-2xl font-semibold">Menu</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <nav className="space-y-2">
          <Button variant="ghost" className="w-full justify-start text-base" asChild>
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              Timeline
            </Link>
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base" asChild>
            <Link to="/canvas">
              <Palette className="mr-2 h-4 w-4" />
              Canvas
            </Link>
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base" asChild>
            <Link to="/items">
              <Package className="mr-2 h-4 w-4" />
              Items
            </Link>
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base" asChild>
            <Link to="/admin">
              <Shield className="mr-2 h-4 w-4" />
              Admin
            </Link>
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base" asChild>
            <Link to="/settings">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base">
            <MessageCircle className="mr-2 h-4 w-4" />
            Messages
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base">
            <Bookmark className="mr-2 h-4 w-4" />
            Bookmarks
          </Button>
        </nav>

        <Button className="mt-6 w-full text-base">Create Post</Button>
      </div>

      {/* Bottom section: Profile */}
      <div className="p-4">
        {/* Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start text-base h-auto py-2 px-3 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
            >
              <UserInfo 
                fullName={mockUser.full_name} 
                email={mockUser.email} 
              />
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
              <UserInfo 
                fullName={mockUser.full_name} 
                email={mockUser.email} 
              />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link to="/settings" onClick={handleMenuClick}>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                User Settings
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="mr-2 h-4 w-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="mr-2 h-4 w-4" />
              System
            </DropdownMenuItem>
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
    </div>
  )
}
