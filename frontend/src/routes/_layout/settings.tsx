import { createFileRoute } from "@tanstack/react-router"

import ProfileContent from "@/components/profile-page/components/profile-content"
import ProfileHeader from "@/components/profile-page/components/profile-header"

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [
      {
        title: "Settings - LinkX",
      },
    ],
  }),
})

function UserSettings() {
  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-10">
      <ProfileHeader />
      <ProfileContent />
    </div>
  )
}
