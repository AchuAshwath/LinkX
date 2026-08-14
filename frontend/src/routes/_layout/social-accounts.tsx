import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Folder,
  Laptop,
  Loader2,
  RefreshCw,
  RotateCcw,
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
  CardDescription,
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

  // LinkedIn Connect / Reconnect
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
  const needsLinkedInReconnect = Boolean(linkedinStatus?.needs_reconnect)
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
      <div className="container max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Connected Accounts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Connect and manage social accounts for API distribution and
              browser automation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  CLI Shortcuts
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-84 p-3 text-xs space-y-2.5"
              >
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Code2 className="h-4 w-4 text-primary" />
                  Terminal CLI Scripts
                </div>
                <div className="p-2 rounded bg-muted/60 border font-mono space-y-1">
                  <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium">
                    1. Headed Login
                  </span>
                  <code className="text-primary text-[11px] block truncate select-all">
                    uv run python scripts/headed_login.py --platform x
                  </code>
                </div>
                <div className="p-2 rounded bg-muted/60 border font-mono space-y-1">
                  <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium">
                    2. Verify Session
                  </span>
                  <code className="text-primary text-[11px] block truncate select-all">
                    uv run python scripts/test_session.py --platform x
                  </code>
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

        {/* Integration Rows Container Card */}
        <Card className="border shadow-sm overflow-hidden">
          <CardHeader className="py-4 px-6 border-b bg-muted/20">
            <CardTitle className="text-base font-semibold">
              Platforms & Automation Engines
            </CardTitle>
            <CardDescription className="text-xs">
              Directly linked social channels and browser profiles configured
              for this account.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0 divide-y divide-border/60">
            {/* ======================= LINKEDIN ROW ======================= */}
            <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/10 transition-colors">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0077b5]/10 text-[#0077b5] mt-0.5 sm:mt-0">
                  <FaLinkedinIn className="h-5 w-5" />
                </div>

                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base">LinkedIn</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono px-1.5 py-0 cursor-help"
                        >
                          OAuth API
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Official OAuth 2.0 REST API integration. Tokens stored
                        in Redis.
                      </TooltipContent>
                    </Tooltip>

                    {isLoadingLinkedin ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : isLinkedInConnected ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs gap-1.5 py-0 px-2"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                        Connected
                      </Badge>
                    ) : needsLinkedInReconnect ? (
                      <Badge
                        variant="outline"
                        className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs gap-1 py-0 px-2"
                      >
                        <AlertTriangle className="h-3 w-3" /> Token Expired
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="text-xs text-muted-foreground py-0 px-2"
                      >
                        Disconnected
                      </Badge>
                    )}
                  </div>

                  {/* Profile or Description */}
                  {isLinkedInConnected && linkedinProfile ? (
                    <div className="flex items-center gap-2.5 text-xs text-muted-foreground pt-0.5">
                      {linkedinProfile.profile_picture_url ? (
                        <img
                          src={linkedinProfile.profile_picture_url}
                          alt="Profile"
                          className="h-6 w-6 rounded-full object-cover ring-1 ring-border"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-[#0077b5]/15 text-[#0077b5] flex items-center justify-center font-bold text-[10px]">
                          {linkedinProfile.display_name?.[0] || "L"}
                        </div>
                      )}
                      <span className="font-medium text-foreground truncate">
                        {linkedinProfile.display_name}
                      </span>
                      {linkedinProfile.email && (
                        <>
                          <span>•</span>
                          <span className="truncate">
                            {linkedinProfile.email}
                          </span>
                        </>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          OAuth token active in Redis
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : needsLinkedInReconnect ? (
                    <p className="text-xs text-amber-600/90 dark:text-amber-400">
                      Token expired for{" "}
                      {linkedinProfile?.display_name || "linked profile"}.
                      Please reconnect.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Connect via official OAuth 2.0 to publish posts and
                      carousels.
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 sm:self-center pl-15 sm:pl-0">
                {isLinkedInConnected ? (
                  <Button
                    variant="outline"
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
                ) : needsLinkedInReconnect ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => disconnectLinkedInMutation.mutate()}
                      disabled={disconnectLinkedInMutation.isPending}
                      className="text-xs h-8 text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </Button>
                    <Button
                      onClick={() => connectLinkedInMutation.mutate()}
                      disabled={connectLinkedInMutation.isPending}
                      size="sm"
                      className="text-xs h-8 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1.5 font-medium"
                    >
                      {connectLinkedInMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Reconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => connectLinkedInMutation.mutate()}
                    disabled={connectLinkedInMutation.isPending}
                    size="sm"
                    className="text-xs h-8 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1.5 font-medium"
                  >
                    {connectLinkedInMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    Connect LinkedIn
                  </Button>
                )}
              </div>
            </div>

            {/* ======================= X (TWITTER) ROW ======================= */}
            <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/10 transition-colors">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground/10 text-foreground mt-0.5 sm:mt-0">
                  <FaXTwitter className="h-5 w-5" />
                </div>

                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base">X (Twitter)</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono px-1.5 py-0 cursor-help"
                        >
                          Stealth Browser
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Stealth browser automation using Playwright. Persists
                        cookies locally.
                      </TooltipContent>
                    </Tooltip>

                    {isLoadingX ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : isXCookiePresent ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs gap-1.5 py-0 px-2"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                        Session Active
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="text-xs text-muted-foreground py-0 px-2"
                      >
                        No Session
                      </Badge>
                    )}
                  </div>

                  {/* Session Path or Description */}
                  {xStatus?.session_dir ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5 max-w-md truncate">
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      <code className="text-[11px] font-mono truncate text-muted-foreground">
                        {xStatus.session_dir}
                      </code>
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
                          Copy local session directory path
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Automated via dedicated Chrome browser profile to evade
                      bot detection.
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 sm:self-center pl-15 sm:pl-0">
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
                      Verify
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    Runs a live headless check on x.com/home to test cookies and
                    feed detection.
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
