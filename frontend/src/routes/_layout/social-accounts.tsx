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
      AuthService.xConnect({ force: force ?? true }),
    onSuccess: () => {
      showSuccessToast(
        "Chrome window launched! Complete login on X.com to save session.",
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
    showSuccessToast("Session path copied to clipboard!")
  }

  return (
    <TooltipProvider>
      <div className="container max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Page Header */}
        <div className="flex items-center justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Connected Accounts
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
              Manage your API authorizations and browser automation sessions.
            </p>
          </div>

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
              Refresh connection statuses
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ======================= CARD 1: LINKEDIN ======================= */}
        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0077b5]/10 text-[#0077b5]">
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
                        OAuth 2.0
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Official LinkedIn REST API
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Official Developer REST API
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
            ) : needsLinkedInReconnect ? (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs gap-1 py-0.5 px-2.5"
              >
                <AlertTriangle className="h-3 w-3" /> Token Expired
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

          <CardContent className="pb-4">
            {isLinkedInConnected && linkedinProfile ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                {linkedinProfile.profile_picture_url ? (
                  <img
                    src={linkedinProfile.profile_picture_url}
                    alt="Profile"
                    className="h-9 w-9 rounded-full object-cover ring-1 ring-border"
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
                    {linkedinProfile.email || "OAuth token active"}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    Valid access token in Redis
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : needsLinkedInReconnect ? (
              <p className="text-xs text-amber-600/90 dark:text-amber-400">
                Token expired for{" "}
                {linkedinProfile?.display_name || "linked profile"}. Please
                reconnect.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Connect your profile via LinkedIn OAuth 2.0 to publish text
                posts, carousels, and manage scheduled updates.
              </p>
            )}
          </CardContent>

          <CardFooter className="pt-0 flex items-center justify-end gap-2 border-t py-3 bg-muted/10">
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
              <div className="flex items-center justify-between w-full">
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
                  Reconnect LinkedIn
                </Button>
              </div>
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
          </CardFooter>
        </Card>

        {/* ======================= CARD 2: X (TWITTER) ======================= */}
        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground/10 text-foreground">
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
                        Stealth Browser
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Headless browser automation via Playwright
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Persistent Local Chrome Session
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

          <CardContent className="pb-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automated via a dedicated local Chrome profile to evade bot
              detection without enterprise API keys.
            </p>

            {/* Session Path & CLI Helper Row (Only on X card) */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                <code className="text-[11px] font-mono truncate text-foreground/80">
                  {xStatus?.session_dir || "sessions/x"}
                </code>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        copyToClipboard(xStatus?.session_dir || "sessions/x")
                      }
                    >
                      {copiedPath ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Copy session path</TooltipContent>
                </Tooltip>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      title="CLI Commands"
                    >
                      <Terminal className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-80 p-3 text-xs space-y-2"
                  >
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <Code2 className="h-3.5 w-3.5 text-primary" />X CLI
                      Scripts
                    </div>
                    <div className="p-2 rounded bg-muted/60 border font-mono space-y-1">
                      <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                        1. Headed Login
                      </span>
                      <code className="text-primary text-[11px] block truncate select-all">
                        uv run python scripts/headed_login.py --platform x
                      </code>
                    </div>
                    <div className="p-2 rounded bg-muted/60 border font-mono space-y-1">
                      <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                        2. Test Session
                      </span>
                      <code className="text-primary text-[11px] block truncate select-all">
                        uv run python scripts/test_session.py --platform x
                      </code>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-0 flex items-center justify-between gap-2 border-t py-3 bg-muted/10">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => connectXMutation.mutate(true)}
                  disabled={connectXMutation.isPending}
                  size="sm"
                  variant={isXCookiePresent ? "outline" : "default"}
                  className="text-xs h-8 gap-1.5 font-medium"
                >
                  {connectXMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Laptop className="h-3.5 w-3.5" />
                  )}
                  {isXCookiePresent
                    ? "Re-login (Chrome)"
                    : "Launch Chrome Login"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                Opens a Google Chrome window to log in and save cookies to the
                persistent session directory.
              </TooltipContent>
            </Tooltip>

            {isXCookiePresent && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => verifyXMutation.mutate()}
                    disabled={verifyXMutation.isPending}
                    className="text-xs h-8 gap-1.5"
                  >
                    {verifyXMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3 w-3" />
                    )}
                    Verify Session
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  Runs a live headless check on x.com/home to test cookies and
                  feed detection.
                </TooltipContent>
              </Tooltip>
            )}
          </CardFooter>
        </Card>
      </div>
    </TooltipProvider>
  )
}
