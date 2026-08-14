import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  Check,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Unlink,
} from "lucide-react"
import * as React from "react"
import { FaLinkedinIn, FaXTwitter } from "react-icons/fa6"
import { z } from "zod"

import { AuthService, LinkedinService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import useCustomToast from "@/hooks/useCustomToast"

const searchSchema = z.object({
  linkedin: z.string().optional(),
})

export const Route = createFileRoute("/_layout/social-accounts")({
  component: ConnectedAccountsPage,
  validateSearch: (search) => searchSchema.parse(search),
})

function ConnectedAccountsPage() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()
  const search = Route.useSearch()

  // Notify after OAuth redirect
  React.useEffect(() => {
    if (search.linkedin === "connected") {
      showSuccessToast("LinkedIn connected successfully!")
      queryClient.invalidateQueries({ queryKey: ["linkedin", "status"] })
    } else if (search.linkedin === "error") {
      showErrorToast("Failed to connect LinkedIn. Please try again.")
    }
  }, [search.linkedin, showSuccessToast, showErrorToast, queryClient])

  // LinkedIn Query
  const {
    data: linkedinStatus,
    isLoading: isLoadingLinkedin,
    refetch: refetchLinkedin,
  } = useQuery({
    queryKey: ["linkedin", "status"],
    queryFn: () => LinkedinService.linkedinStatus(),
    staleTime: 10000,
  })

  // X Query
  const {
    data: xStatus,
    isLoading: isLoadingX,
    refetch: refetchX,
  } = useQuery({
    queryKey: ["x", "status"],
    queryFn: () => AuthService.xStatus(),
    staleTime: 10000,
  })

  // LinkedIn Connect (Authorize)
  const connectLinkedInMutation = useMutation({
    mutationFn: () => AuthService.linkedinAuthorize(),
    onSuccess: (data) => {
      if (data?.authorize_url) {
        window.location.href = data.authorize_url
      }
    },
    onError: () => {
      showErrorToast("Could not start LinkedIn connection flow.")
    },
  })

  // LinkedIn Disconnect
  const disconnectLinkedInMutation = useMutation({
    mutationFn: () => LinkedinService.linkedinDisconnect(),
    onSuccess: () => {
      showSuccessToast("LinkedIn disconnected.")
      queryClient.invalidateQueries({ queryKey: ["linkedin", "status"] })
    },
    onError: () => {
      showErrorToast("Failed to disconnect LinkedIn.")
    },
  })

  // X Connect (Launch Browser)
  const connectXMutation = useMutation({
    mutationFn: (force?: boolean) =>
      AuthService.xConnect({ force: force ?? false }),
    onSuccess: () => {
      showSuccessToast(
        "Browser launched for X.com login. Please complete login in the window.",
      )
      setTimeout(() => refetchX(), 4000)
    },
    onError: (err: any) => {
      showErrorToast(err?.body?.detail || "Failed to launch X browser.")
    },
  })

  const isLinkedInConnected = Boolean(linkedinStatus?.connected)
  const isXConnected = xStatus?.status === "connected"
  const linkedinProfile = linkedinStatus?.profile as
    | {
        display_name?: string
        email?: string
        profile_picture_url?: string
      }
    | undefined

  return (
    <div className="flex flex-col gap-8 p-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Connected Accounts
        </h1>
        <p className="text-muted-foreground mt-1">
          Connect and manage your social platform integrations directly for
          publishing and automation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* LinkedIn Account Card */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0077b5]/10 text-[#0077b5]">
                <FaLinkedinIn className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold">
                  LinkedIn
                </CardTitle>
                <CardDescription>Official REST API & OAuth 2.0</CardDescription>
              </div>
            </div>
            {isLoadingLinkedin ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : isLinkedInConnected ? (
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1.5 py-1 px-2.5"
              >
                <Check className="h-3.5 w-3.5" /> Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                Disconnected
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {isLinkedInConnected && linkedinProfile ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                {linkedinProfile.profile_picture_url ? (
                  <img
                    src={linkedinProfile.profile_picture_url}
                    alt="Profile"
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                    {linkedinProfile.display_name?.[0] || "L"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {linkedinProfile.display_name || "LinkedIn User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {linkedinProfile.email || "Connected via OAuth"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect your LinkedIn profile to publish text posts, carousels,
                and manage scheduled updates via official APIs.
              </p>
            )}

            <div className="flex items-center gap-2 pt-2">
              {isLinkedInConnected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchLinkedin()}
                    disabled={isLoadingLinkedin}
                    className="gap-1.5"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${isLoadingLinkedin ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => disconnectLinkedInMutation.mutate()}
                    disabled={disconnectLinkedInMutation.isPending}
                    className="gap-1.5"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => connectLinkedInMutation.mutate()}
                  disabled={connectLinkedInMutation.isPending}
                  size="sm"
                  className="bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-2"
                >
                  {connectLinkedInMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  Connect LinkedIn
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* X.com (Twitter) Account Card */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/10 text-foreground">
                <FaXTwitter className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold">
                  X (Twitter)
                </CardTitle>
                <CardDescription>
                  Stealth Headed / Headless Browser Automation
                </CardDescription>
              </div>
            </div>
            {isLoadingX ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : isXConnected ? (
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1.5 py-1 px-2.5"
              >
                <Check className="h-3.5 w-3.5" /> Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                Disconnected
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Uses anti-detection browser profiles to automate posting and trend
              scraping without expensive enterprise API subscriptions.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={() => connectXMutation.mutate(false)}
                disabled={connectXMutation.isPending}
                size="sm"
                variant={isXConnected ? "outline" : "default"}
                className="gap-2"
              >
                {connectXMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
                {isXConnected
                  ? "Launch Browser Session"
                  : "Connect X (Headed Browser)"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchX()}
                disabled={isLoadingX}
                className="gap-1.5"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isLoadingX ? "animate-spin" : ""}`}
                />
                Check Status
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
