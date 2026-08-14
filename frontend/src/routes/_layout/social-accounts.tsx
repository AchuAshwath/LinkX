import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Grid,
  Laptop,
  List,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  const [activeView, setActiveView] = React.useState<string>("flat-list")

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
      <div className="container max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header with Live Style Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Connected Accounts
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Connect API keys and browser sessions for publishing automation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* View Comparison Switcher */}
            <Tabs
              value={activeView}
              onValueChange={setActiveView}
              className="w-auto"
            >
              <TabsList className="h-8 bg-muted/60 p-0.5">
                <TabsTrigger
                  value="flat-list"
                  className="text-xs h-7 gap-1.5 px-2.5"
                >
                  <List className="h-3.5 w-3.5" />
                  Flat List (Option 1)
                </TabsTrigger>
                <TabsTrigger
                  value="compact-grid"
                  className="text-xs h-7 gap-1.5 px-2.5"
                >
                  <Grid className="h-3.5 w-3.5" />
                  Grid Cards (Option 2)
                </TabsTrigger>
              </TabsList>
            </Tabs>

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

        {/* ========================================================================= */}
        {/* OPTION 1: ULTRA-MINIMAL FLAT LIST (Apple / Raycast Settings Style)        */}
        {/* ========================================================================= */}
        {activeView === "flat-list" && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <div className="divide-y divide-border/60 rounded-xl border bg-card shadow-xs">
              {/* --- LINKEDIN FLAT ROW --- */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0077b5]/10 text-[#0077b5]">
                    <FaLinkedinIn className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">LinkedIn</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono py-0 px-1.5 text-muted-foreground"
                      >
                        OAuth 2.0 API
                      </Badge>
                      {isLinkedInConnected ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                          Connected
                        </span>
                      ) : needsLinkedInReconnect ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium bg-amber-500/10 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="h-3 w-3" /> Token Expired
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          Disconnected
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {isLinkedInConnected && linkedinProfile ? (
                        <span className="text-foreground/80">
                          {linkedinProfile.display_name}{" "}
                          {linkedinProfile.email &&
                            `(${linkedinProfile.email})`}
                        </span>
                      ) : (
                        <span>
                          Official REST API connection for posting and
                          scheduling.
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 sm:self-center">
                  {isLinkedInConnected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => disconnectLinkedInMutation.mutate()}
                      disabled={disconnectLinkedInMutation.isPending}
                      className="text-xs h-8 text-muted-foreground hover:text-destructive gap-1.5"
                    >
                      {disconnectLinkedInMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Unlink className="h-3 w-3" />
                      )}
                      Disconnect
                    </Button>
                  ) : needsLinkedInReconnect ? (
                    <Button
                      onClick={() => connectLinkedInMutation.mutate()}
                      disabled={connectLinkedInMutation.isPending}
                      size="sm"
                      className="text-xs h-8 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1.5"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reconnect
                    </Button>
                  ) : (
                    <Button
                      onClick={() => connectLinkedInMutation.mutate()}
                      disabled={connectLinkedInMutation.isPending}
                      size="sm"
                      className="text-xs h-8 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1.5"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Connect
                    </Button>
                  )}
                </div>
              </div>

              {/* --- X (TWITTER) FLAT ROW --- */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
                    <FaXTwitter className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">X (Twitter)</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono py-0 px-1.5 text-muted-foreground"
                      >
                        Browser Profile
                      </Badge>
                      {isXCookiePresent ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                          Session Active
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          No Session
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono text-[11px] text-foreground/75 truncate max-w-xs sm:max-w-sm">
                        {xStatus?.session_dir || "sessions/x"}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              copyToClipboard(
                                xStatus?.session_dir || "sessions/x",
                              )
                            }
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

                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground"
                            title="CLI Commands"
                          >
                            <Terminal className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-80 p-3 text-xs space-y-2"
                        >
                          <div className="font-semibold flex items-center gap-1.5">
                            <Code2 className="h-3.5 w-3.5 text-primary" />X CLI
                            Scripts
                          </div>
                          <div className="p-1.5 rounded bg-muted/60 font-mono text-[11px] select-all">
                            uv run python scripts/headed_login.py --platform x
                          </div>
                          <div className="p-1.5 rounded bg-muted/60 font-mono text-[11px] select-all">
                            uv run python scripts/test_session.py --platform x
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 sm:self-center">
                  <Button
                    onClick={() => connectXMutation.mutate(true)}
                    disabled={connectXMutation.isPending}
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 gap-1.5"
                  >
                    {connectXMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Laptop className="h-3.5 w-3.5" />
                    )}
                    {isXCookiePresent ? "Re-login (Chrome)" : "Launch Login"}
                  </Button>

                  {isXCookiePresent && (
                    <Button
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
                      Verify
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* OPTION 2: COMPACT GRID CARDS (Vercel / Linear Integrations Style)         */}
        {/* ========================================================================= */}
        {activeView === "compact-grid" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in-50 duration-200">
            {/* --- LINKEDIN COMPACT CARD --- */}
            <Card className="flex flex-col justify-between border shadow-xs bg-card hover:border-border/80 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0077b5]/10 text-[#0077b5]">
                      <FaLinkedinIn className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">
                        LinkedIn
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground">
                        Official REST API
                      </p>
                    </div>
                  </div>

                  {isLinkedInConnected ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] py-0 px-2"
                    >
                      Connected
                    </Badge>
                  ) : needsLinkedInReconnect ? (
                    <Badge
                      variant="outline"
                      className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] py-0 px-2"
                    >
                      Expired
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-[10px] text-muted-foreground py-0 px-2"
                    >
                      Inactive
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="text-xs space-y-2 pb-4">
                {isLinkedInConnected && linkedinProfile ? (
                  <div className="p-2.5 rounded-md bg-muted/40 border border-border/40 space-y-0.5">
                    <p className="font-medium truncate text-foreground">
                      {linkedinProfile.display_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {linkedinProfile.email || "OAuth Token Active"}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Connect via official OAuth 2.0 to publish updates and fetch
                    analytics.
                  </p>
                )}
              </CardContent>

              <CardFooter className="pt-0 border-t py-2.5 px-4 bg-muted/10 flex items-center justify-end">
                {isLinkedInConnected ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => disconnectLinkedInMutation.mutate()}
                    disabled={disconnectLinkedInMutation.isPending}
                    className="text-xs h-7 text-destructive hover:bg-destructive/10 gap-1 px-2"
                  >
                    <Unlink className="h-3 w-3" />
                    Disconnect
                  </Button>
                ) : needsLinkedInReconnect ? (
                  <Button
                    onClick={() => connectLinkedInMutation.mutate()}
                    disabled={connectLinkedInMutation.isPending}
                    size="sm"
                    className="text-xs h-7 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1 w-full"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reconnect
                  </Button>
                ) : (
                  <Button
                    onClick={() => connectLinkedInMutation.mutate()}
                    disabled={connectLinkedInMutation.isPending}
                    size="sm"
                    className="text-xs h-7 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1 w-full"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Connect
                  </Button>
                )}
              </CardFooter>
            </Card>

            {/* --- X (TWITTER) COMPACT CARD --- */}
            <Card className="flex flex-col justify-between border shadow-xs bg-card hover:border-border/80 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
                      <FaXTwitter className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">
                        X (Twitter)
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground">
                        Stealth Browser
                      </p>
                    </div>
                  </div>

                  {isXCookiePresent ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] py-0 px-2"
                    >
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-[10px] text-muted-foreground py-0 px-2"
                    >
                      Inactive
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="text-xs space-y-2 pb-4">
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/40 border border-border/40 font-mono text-[11px]">
                  <span className="truncate text-muted-foreground">
                    {xStatus?.session_dir || "sessions/x"}
                  </span>
                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                        >
                          <Terminal className="h-3 w-3" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-72 p-2.5 text-xs space-y-1.5"
                      >
                        <span className="font-semibold block">
                          CLI Login Script:
                        </span>
                        <code className="text-primary text-[10px] block select-all">
                          uv run python scripts/headed_login.py --platform x
                        </code>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="pt-0 border-t py-2.5 px-4 bg-muted/10 flex items-center justify-between gap-2">
                <Button
                  onClick={() => connectXMutation.mutate(true)}
                  disabled={connectXMutation.isPending}
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 gap-1 flex-1"
                >
                  {connectXMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Laptop className="h-3 w-3" />
                  )}
                  {isXCookiePresent ? "Re-login" : "Login"}
                </Button>

                {isXCookiePresent && (
                  <Button
                    size="sm"
                    onClick={() => verifyXMutation.mutate()}
                    disabled={verifyXMutation.isPending}
                    className="text-xs h-7 gap-1 flex-1"
                  >
                    {verifyXMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3 w-3" />
                    )}
                    Verify
                  </Button>
                )}
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
