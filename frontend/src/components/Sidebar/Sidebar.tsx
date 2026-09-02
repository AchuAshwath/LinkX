"use client"

import { Link } from "@tanstack/react-router"
import { Clock, Link2, MessageSquare, Package, X } from "lucide-react"
import * as React from "react"
import { Logo } from "@/components/Common/Logo"
import { CreatePostDialog } from "@/components/PostInput/CreatePostDialog"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import { SidebarProfile } from "./SidebarProfile"

interface SidebarProps {
  sidebarOpen: boolean
  onClose: () => void
}

export function Sidebar({ sidebarOpen, onClose }: SidebarProps) {
  const { logout, user } = useAuth()
  const [createPostDialogOpen, setCreatePostDialogOpen] = React.useState(false)

  const handleMenuClick = () => {
    if (sidebarOpen) {
      onClose()
    }
  }

  const handlePostCreated = () => {
    setCreatePostDialogOpen(false)
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

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <h2 className="text-2xl font-semibold">Menu</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <nav className="space-y-1.5">
          <Button
            variant="ghost"
            className="w-full justify-start text-lg font-semibold tracking-tight h-11 px-3.5 rounded-full hover:bg-accent/80 transition-colors"
            asChild
          >
            <Link to="/home" onClick={handleMenuClick}>
              <Clock className="mr-3 h-5 w-5" />
              Timeline
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-lg font-semibold tracking-tight h-11 px-3.5 rounded-full hover:bg-accent/80 transition-colors"
            asChild
          >
            <Link to="/posts" onClick={handleMenuClick}>
              <Package className="mr-3 h-5 w-5" />
              Posts
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-lg font-semibold tracking-tight h-11 px-3.5 rounded-full hover:bg-accent/80 transition-colors"
            asChild
          >
            <Link to="/ai" onClick={handleMenuClick}>
              <MessageSquare className="mr-3 h-5 w-5" />
              Chat
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-lg font-semibold tracking-tight h-11 px-3.5 rounded-full hover:bg-accent/80 transition-colors"
            asChild
          >
            <Link to="/social-accounts" onClick={handleMenuClick}>
              <Link2 className="mr-3 h-5 w-5" />
              Social Accounts
            </Link>
          </Button>
        </nav>

        <Button
          className="mt-6 w-full text-base font-semibold h-11 rounded-full shadow-sm cursor-pointer"
          onClick={() => setCreatePostDialogOpen(true)}
        >
          Create Post
        </Button>
      </div>

      {/* Bottom section: Profile */}
      <SidebarProfile
        fullName={user?.full_name ?? undefined}
        email={user?.email ?? undefined}
        onMenuClick={handleMenuClick}
        onLogout={logout}
      />

      {/* Create Post Dialog */}
      <CreatePostDialog
        open={createPostDialogOpen}
        onOpenChange={setCreatePostDialogOpen}
        onPostCreated={handlePostCreated}
      />
    </div>
  )
}
