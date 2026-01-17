"use client"

import { Link } from "@tanstack/react-router"
import {
  Bookmark,
  Home,
  Layers,
  Package,
  Palette,
  X,
} from "lucide-react"
import { Logo } from "@/components/Common/Logo"
import { Button } from "@/components/ui/button"
import { SidebarProfile } from "./SidebarProfile"

interface SidebarProps {
  sidebarOpen: boolean
  onClose: () => void
}

export function Sidebar({
  sidebarOpen,
  onClose,
}: SidebarProps) {
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

  return (
    <div
      className={`border-border fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-64 flex-col border-r bg-background transition-transform lg:top-0 lg:h-screen lg:sticky lg:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}
    >
      {/* Logo Header - Hidden on mobile, shown on desktop */}
      <div className="hidden px-4 pt-6 pb-4 lg:block">
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
          <Button
            variant="ghost"
            className="w-full justify-start text-base"
            asChild
          >
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              Timeline
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-base"
            asChild
          >
            <Link to="/canvas">
              <Palette className="mr-2 h-4 w-4" />
              Canvas
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-base"
            asChild
          >
            <Link to="/brandkit">
              <Layers className="mr-2 h-4 w-4" />
              Brand Kit
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-base"
            asChild
          >
            <Link to="/items">
              <Package className="mr-2 h-4 w-4" />
              Posts
            </Link>
          </Button>
         
          <Button variant="ghost" className="w-full justify-start text-base">
            <Bookmark className="mr-2 h-4 w-4" />
            Bookmarks
          </Button>
        </nav>

        <Button className="mt-6 w-full text-base">Create Post</Button>
      </div>

      {/* Bottom section: Profile */}
      <SidebarProfile
        fullName={mockUser.full_name}
        email={mockUser.email}
        onMenuClick={handleMenuClick}
      />
    </div>
  )
}
