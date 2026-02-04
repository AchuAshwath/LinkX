import { createFileRoute } from "@tanstack/react-router"
import { ExternalLink, Linkedin, Twitter } from "lucide-react"
import * as React from "react"

import { OpenAPI } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
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
  const [statusLoading, setStatusLoading] = React.useState(true)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linkedin = params.get("linkedin")
    if (linkedin === "connected") setLastStatus("connected")
    if (linkedin === "error") setLastStatus("error")
    if (params.has("linkedin")) {
      params.delete("linkedin")
      const search = params.toString()
      const url = `${window.location.pathname}${search ? `?${search}` : ""}`
      window.history.replaceState({}, "", url)
    }
  }, [])

  React.useEffect(() => {
    const run = async () => {
      setStatusLoading(true)
      try {
        const res = await fetch(`${OpenAPI.BASE}/api/v1/linkedin/status`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        })
        if (!res.ok) {
          showErrorToast("Could not load connection status. Try again or re-login.")
          setLastStatus((prev) => (prev === "error" ? "error" : "idle"))
          return
        }
        const data = (await res.json()) as {
          connected: boolean
          needs_reconnect: boolean
          profile: LinkedInProfile | null
        }
        setNeedsReconnect(Boolean(data.needs_reconnect))
        setProfile(data.profile ?? null)
        setLastStatus(
          data.connected ? "connected" : (prev) => (prev === "error" ? "error" : "idle"),
        )
      } catch {
        showErrorToast("Could not load connection status. Try again or re-login.")
        setLastStatus((prev) => (prev === "error" ? "error" : "idle"))
      } finally {
        setStatusLoading(false)
      }
    }
    run()
  }, [])

  const handleConnectLinkedIn = async () => {
    if (!OpenAPI.BASE) {
      showErrorToast("API URL not set. Set VITE_API_URL in frontend .env (e.g. http://localhost:8000).")
      return
    }
    try {
      setConnecting(true)
      const res = await fetch(
        `${OpenAPI.BASE}/api/v1/auth/linkedin/authorize`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        },
      )
      if (!res.ok) {
        await res.text()
        let detail = "Failed to start LinkedIn OAuth"
        try {
          const configRes = await fetch(`${OpenAPI.BASE}/api/v1/auth/linkedin/config-check`)
          if (configRes.ok) {
            const config = (await configRes.json()) as {
              configured: boolean
              redirect_uri_masked: string
              hint: string
            }
            if (!config.configured) detail = "LinkedIn not configured in backend. " + (config.hint ?? "")
            else detail = `OAuth failed (${res.status}). ${config.hint ?? ""}`
          }
        } catch {
          // ignore config-check failure
        }
        throw new Error(detail)
      }
      const data = (await res.json()) as { authorize_url: string }
      if (!data.authorize_url) {
        throw new Error("No authorize_url in response")
      }
      window.location.href = data.authorize_url
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start LinkedIn OAuth. See docs/LINKEDIN_SETUP.md."
      showErrorToast(message)
      setConnecting(false)
    }
  }

  const linkedInConnected =
    !statusLoading && (lastStatus === "connected" || (profile && !needsReconnect))
  const linkedInStatusBadge = statusLoading ? (
    <Badge variant="secondary" className="font-normal">
      Loading…
    </Badge>
  ) : linkedInConnected ? (
    <Badge
      variant="outline"
      className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
    >
      Connected
    </Badge>
  ) : needsReconnect ? (
    <Badge variant="secondary" className="font-normal">
      Reconnect required
    </Badge>
  ) : (
    <Badge variant="secondary" className="font-normal">
      Not connected
    </Badge>
  )

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-10">
      {/* Page header – profile style */}
      <Card className="py-0">
        <CardContent className="px-6 py-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Social Accounts
            </h1>
            <p className="text-muted-foreground text-sm">
              Connect your social platforms using OAuth. Credentials and tokens
              are managed server-side and never exposed in the browser.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connected accounts card – settings-style rows */}
      <Card>
        <CardHeader>
          <CardTitle>Connected accounts</CardTitle>
          <CardDescription>
            Link your accounts to publish and schedule posts from LinkX.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          {/* LinkedIn */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              {profile?.profile_picture_url ? (
                <Avatar className="h-12 w-12 shrink-0">
                  <AvatarImage
                    src={profile.profile_picture_url}
                    alt={profile.display_name ?? "LinkedIn"}
                  />
                  <AvatarFallback className="text-sm">LI</AvatarFallback>
                </Avatar>
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0A66C2]/10">
                  <Linkedin className="h-6 w-6 text-[#0A66C2]" aria-hidden />
                </div>
              )}
              <div className="space-y-1 min-w-0">
                <Label className="text-base">LinkedIn</Label>
                {profile?.display_name ? (
                  <p className="text-muted-foreground text-sm truncate">
                    {profile.display_name}
                    {profile.email ? ` · ${profile.email}` : ""}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Connect your LinkedIn account to publish and schedule posts.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {linkedInStatusBadge}
              <Button
                type="button"
                variant={linkedInConnected ? "outline" : "default"}
                size="sm"
                onClick={handleConnectLinkedIn}
                disabled={connecting}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {needsReconnect ? "Reconnect" : linkedInConnected ? "Manage" : "Connect"}
              </Button>
            </div>
          </div>

          {lastStatus === "error" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Ensure redirect URI and scopes match the{" "}
              <a
                href="https://www.linkedin.com/developers/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                LinkedIn Developer Portal
              </a>
              . See project docs/LINKEDIN_SETUP.md for setup.
            </p>
          )}

          <Separator className="my-6" />

          {/* X (Twitter) */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Twitter className="h-6 w-6 text-muted-foreground" aria-hidden />
              </div>
              <div className="space-y-1 min-w-0">
                <Label className="text-base">X (Twitter)</Label>
                <p className="text-muted-foreground text-sm">
                  Coming soon. We’ll add X OAuth once the backend flow is ready.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Badge variant="secondary" className="font-normal">
                Coming soon
              </Badge>
              <Button type="button" variant="outline" size="sm" disabled>
                <ExternalLink className="mr-2 h-4 w-4" />
                Connect
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default SocialAccountsPage
