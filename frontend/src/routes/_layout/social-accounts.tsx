import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Folder,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  const [copiedPath, setCopiedPath] = React.useState(false)

  // Handle OAuth redirect notifications
  React.useEffect(() => {
    if (search.linkedin === "connected") {
      showSuccessToast("LinkedIn OAuth connected successfully!")
      queryClient.invalidateQueries({ queryKey: ["linkedin", "status"] })
    } else if (search.linkedin === "error") {
      showErrorToast(
        "Failed to connect LinkedIn. Please check your credentials.",
      )
    }
  }, [search.linkedin, showSuccessToast, showErrorToast, queryClient])

  // LinkedIn Status Query
  const {
    data: linkedinStatus,
    isLoading: isLoadingLinkedin,
    refetch: refetchLinkedin,
    isRefetching: isRefetchingLinkedin,
  } = useQuery({
    queryKey: ["linkedin", "status"],
    queryFn: () => LinkedinService.linkedinStatus(),
    staleTime: 10000,
  })

  // X (Twitter) Status Query
  const {
    data: xStatus,
    isLoading: isLoadingX,
    refetch: refetchX,
    isRefetching: isRefetchingX,
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

  // X Connect (Launch Headed Browser)
  const connectXMutation = useMutation({
    mutationFn: (force?: boolean) =>
      AuthService.xConnect({ force: force ?? false }),
    onSuccess: () => {
      showSuccessToast(
        "Chrome window launched! Complete login on X.com and close the window.",
      )
      setTimeout(() => {
        refetchX()
      }, 5000)
    },
    onError: (err: any) => {
      showErrorToast(
        err?.body?.detail || "Failed to launch headed Chrome window.",
      )
    },
  })

  // X Live Verification Mutation
  const verifyXMutation = useMutation({
    mutationFn: () => AuthService.xVerify(),
    onSuccess: (res) => {
      if (res.authenticated) {
        showSuccessToast("X session verified! Home feed successfully detected.")
      } else {
        showErrorToast(res.message || "X session cookies expired or invalid.")
      }
      refetchX()
    },
    onError: (err: any) => {
      showErrorToast(err?.body?.detail || "Error verifying browser session.")
    },
  })

  const isLinkedInConnected = Boolean(linkedinStatus?.connected)
  const isXCookiePresent = xStatus?.status === "connected"
  const linkedinProfile = linkedinStatus?.profile as
    | {
        display_name?: string
        email?: string
        profile_picture_url?: string
      }
    | undefined

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPath(true)
    setTimeout(() => setCopiedPath(false), 2000)
    showSuccessToast("Path copied to clipboard!")
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6 md:p-8 max-w-5xl mx-auto">
        {/* Clean Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Connected Accounts
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Manage API connections and browser automation profiles.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Terminal className="h-3.5 w-3.5" />
                  CLI Shortcuts
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-84 p-4 text-xs space-y-3"
              >
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Code2 className="h-4 w-4 text-primary" />
                  Terminal Commands
                </div>
                <div className="space-y-2">
                  <div className="p-2 rounded bg-muted/60 border font-mono">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium mb-0.5">
                      1. Headed Login
                    </span>
                    <code className="text-primary text-[11px] select-all">
                      uv run python scripts/headed_login.py --platform x
                    </code>
                  </div>
                  <div className="p-2 rounded bg-muted/60 border font-mono">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium mb-0.5">
                      2. Verify Session
                    </span>
                    <code className="text-primary text-[11px] select-all">
                      uv run python scripts/test_session.py --platform x
                    </code>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    refetchLinkedin()
                    refetchX()
                  }}
                  disabled={isRefetchingLinkedin || isRefetchingX}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isRefetchingLinkedin || isRefetchingX ? "animate-spin" : ""}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Refresh connection states
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 2 Modern Account Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ======================= LINKEDIN ======================= */}
          <Card className="flex flex-col border shadow-none bg-card hover:border-border/80 transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0077b5]/10 text-[#0077b5]">
                  <FaLinkedinIn className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      LinkedIn
                    </CardTitle>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono px-1.5 py-0 cursor-help"
                        >
                          API
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Official OAuth 2.0 REST API integration. Tokens stored
                        in Redis.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Official OAuth 2.0
                  </p>
                </div>
              </div>

              {isLoadingLinkedin ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : isLinkedInConnected ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs gap-1.5 py-0.5 px-2.5"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                  Connected
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="text-xs text-muted-foreground"
                >
                  Disconnected
                </Badge>
              )}
            </CardHeader>

            <CardContent className="flex-1 pb-4">
              {isLinkedInConnected && linkedinProfile ? (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                  {linkedinProfile.profile_picture_url ? (
                    <img
                      src={linkedinProfile.profile_picture_url}
                      alt="Profile"
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-[#0077b5]/15 text-[#0077b5] flex items-center justify-center font-bold text-xs">
                      {linkedinProfile.display_name?.[0] || "L"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate text-foreground">
                      {linkedinProfile.display_name || "LinkedIn User"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {linkedinProfile.email || "OAuth active"}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Valid access token active
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Connect via LinkedIn Developer OAuth to publish updates and
                  fetch analytics using official REST endpoints.
                </p>
              )}
            </CardContent>

            <CardFooter className="pt-0 flex items-center justify-between gap-2">
              {isLinkedInConnected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchLinkedin()}
                    disabled={isLoadingLinkedin || isRefetchingLinkedin}
                    className="text-xs h-8 gap-1.5"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${isRefetchingLinkedin ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => disconnectLinkedInMutation.mutate()}
                    disabled={disconnectLinkedInMutation.isPending}
                    className="text-xs h-8 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                  >
                    {disconnectLinkedInMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Unlink className="h-3 w-3" />
                    )}
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => connectLinkedInMutation.mutate()}
                  disabled={connectLinkedInMutation.isPending}
                  size="sm"
                  className="w-full h-8 text-xs bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1.5 font-medium"
                >
                  {connectLinkedInMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  Connect LinkedIn
                </Button>
              )}
            </CardFooter>
          </Card>

          {/* ======================= X (TWITTER) ======================= */}
          <Card className="flex flex-col border shadow-none bg-card hover:border-border/80 transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
                  <FaXTwitter className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      X (Twitter)
                    </CardTitle>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono px-1.5 py-0 cursor-help"
                        >
                          Browser
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Stealth browser automation using Playwright. Persists
                        cookies locally.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Headed Browser Session
                  </p>
                </div>
              </div>

              {isLoadingX ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : isXCookiePresent ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs gap-1.5 py-0.5 px-2.5"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                  Session Active
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="text-xs text-muted-foreground"
                >
                  No Session
                </Badge>
              )}
            </CardHeader>

            <CardContent className="flex-1 pb-4 space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Uses a dedicated local Chrome profile for automation. Log in
                once in the headed browser to persist cookies.
              </p>

              {xStatus?.session_dir && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30 border border-border/40 text-[11px] font-mono text-muted-foreground">
                  <span className="truncate flex items-center gap-1.5">
                    <Folder className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                    <span className="truncate">{xStatus.session_dir}</span>
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => copyToClipboard(xStatus.session_dir)}
                      >
                        {copiedPath ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Copy session path
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </CardContent>

            <CardFooter className="pt-0 flex items-center justify-between gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => connectXMutation.mutate(false)}
                    disabled={connectXMutation.isPending}
                    size="sm"
                    variant="default"
                    className="text-xs h-8 gap-1.5 font-medium"
                  >
                    {connectXMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Laptop className="h-3.5 w-3.5" />
                    )}
                    {isXCookiePresent
                      ? "Re-launch Chrome"
                      : "Launch Chrome Login"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  Opens a Google Chrome window to log in and save cookies to
                  disk.
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => verifyXMutation.mutate()}
                    disabled={verifyXMutation.isPending || !isXCookiePresent}
                    className="text-xs h-8 gap-1.5"
                  >
                    {verifyXMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3 w-3 text-primary" />
                    )}
                    Verify Session
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  Runs a live headless check on x.com/home to verify cookies and
                  feed detection.
                </TooltipContent>
              </Tooltip>
            </CardFooter>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  )
}
