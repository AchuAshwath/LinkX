"use client"

import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import {
  Bell,
  MessageCircle,
  Bookmark,
  User,
  Settings,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type Theme, useTheme } from "@/components/theme-provider"

interface TimelineSidebarProps {
  sidebarOpen: boolean
  onClose: () => void
}

const ICON_MAP: Record<Theme, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

export function TimelineSidebar({ sidebarOpen, onClose }: TimelineSidebarProps) {
  const { setTheme, theme } = useTheme()
  const Icon = ICON_MAP[theme]

  return (
    <div
      className={`border-border fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-64 flex-col border-r bg-background transition-transform lg:top-0 lg:h-screen lg:sticky lg:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}
    >
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

      {/* Bottom section: Theme Selector + Profile */}
      <div className="p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="mb-3 w-full justify-start text-base"
            >
              <Icon className="mr-2 h-4 w-4" />
              Appearance
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
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
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" className="w-full justify-start text-base">
          <User className="mr-2 h-4 w-4" />
          Profile
        </Button>
      </div>
    </div>
  )
}
