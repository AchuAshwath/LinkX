import { createFileRoute } from "@tanstack/react-router"
import { ExternalLink, Info, Linkedin, Twitter } from "lucide-react"
import * as React from "react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import useCustomToast from "@/hooks/useCustomToast"

type LinkedInProfile = {
  display_name?: string | null
  email?: string | null
  profile_picture_url?: string | null
}

export const Route = createFileRoute("/_layout/social-accounts")({
  component: SocialAccountsPage,
  head: () => ({
    meta: [
      {
        title: "Social Accounts - LinkX",
      },
    ],
  }),
})

function SocialAccountsPage() {
  const { showErrorToast } = useCustomToast()
  const [connecting, setConnecting] = React.useState(false)
  const [lastStatus, setLastStatus] = React.useState<
    "idle" | "connected" | "error"
  >("idle")
  const [needsReconnect, setNeedsReconnect] = React.useState(false)
  const [profile, setProfile] = React.useState<LinkedInProfile | null>(null)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linkedin = params.get("linkedin")
    if (linkedin === "connected") setLastStatus("connected")
    if (linkedin === "error") setLastStatus("error")
  }, [])

  React.useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch(`${OpenAPI.BASE}/api/v1/linkedin/status`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        })
        if (!res.ok) return
        const data = (await res.json()) as {
          connected: boolean
          needs_reconnect: boolean
          profile: LinkedInProfile | null
        }
        setNeedsReconnect(Boolean(data.needs_reconnect))
        setProfile(data.profile ?? null)
        if (data.connected) setLastStatus("connected")
      } catch (e) {
        console.error(e)
      }
    }
    run()
  }, [])

  const handleConnectLinkedIn = async () => {
    try {
      setConnecting(true)
      const res = await fetch(`${OpenAPI.BASE}/api/v1/auth/linkedin/authorize`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      })
      if (!res.ok) {
        throw new Error("Failed to start LinkedIn OAuth")
      }
      const data = (await res.json()) as { authorize_url: string }
      window.location.href = data.authorize_url
    } catch (e) {
      console.error(e)
      showErrorToast("Could not start LinkedIn OAuth. Check backend config.")
      setConnecting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Social Accounts</h1>
        <p className="text-muted-foreground">
          Connect your social platforms using OAuth. Credentials and secrets are
          managed server-side.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>LinkedIn</CardTitle>
            <CardDescription>
              Connect your LinkedIn account to publish and schedule posts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
              <div className="flex items-center gap-3">
                {profile?.profile_picture_url ? (
                  <Avatar className="h-10 w-10">
                    <AvatarImage
                      src={profile.profile_picture_url}
                      alt={profile.display_name ?? "LinkedIn profile"}
                    />
                    <AvatarFallback className="text-xs">LI</AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <Linkedin className="h-5 w-5" aria-hidden="true" />
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium">Connection status</div>
                  {profile?.display_name ? (
                    <div className="text-sm text-muted-foreground">
                      {profile.display_name}
                      {profile.email ? (
                        <span className="text-muted-foreground/70">
                          {" "}
                          • {profile.email}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="text-sm text-muted-foreground">
                    {needsReconnect
                      ? "Reconnect required"
                      : lastStatus === "connected"
                      ? "Connected"
                      : lastStatus === "error"
                        ? "Error connecting"
                        : "Not connected"}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                onClick={handleConnectLinkedIn}
                disabled={connecting}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {needsReconnect ? "Reconnect" : "Connect"}
              </Button>
            </div>
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            We never ask for your Client Secret in the UI. Configure LinkedIn
            credentials in the backend environment.
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>X (Twitter)</CardTitle>
            <CardDescription>
              Coming soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <Twitter className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-medium">Connection status</div>
                  <div className="text-sm text-muted-foreground">Coming soon</div>
                </div>
              </div>
              <Button type="button" disabled>
                <ExternalLink className="mr-2 h-4 w-4" />
                Connect
              </Button>
            </div>
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            We’ll add X OAuth once the backend flow is implemented.
          </CardFooter>
        </Card>
      </div>

      <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4" />
          <div>
            You’ll be redirected to the provider to authorize LinkX. We store
            tokens server-side and never expose your secrets to the browser.
          </div>
        </div>
      </div>
    </div>
  )
}

export default SocialAccountsPage
