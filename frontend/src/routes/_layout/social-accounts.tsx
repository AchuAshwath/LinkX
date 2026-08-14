import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  ExternalLink,
  Folder,
  Laptop,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
} from "lucide-react"
import * as React from "react"
import { FaLinkedinIn, FaXTwitter } from "react-icons/fa6"
import { z } from "zod"

import { AuthService, LinkedinService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const [isCliExpanded, setIsCliExpanded] = React.useState<boolean>(false)

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
  const sessionPath = xStatus?.session_dir || "sessions/x"
  const linkedinProfile = linkedinStatus?.profile as
    | {
        display_name?: string
        email?: string
        profile_picture_url?: string
      }
    | undefined

  const copyText = (text: string, key: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
    showSuccessToast(`${label} copied to clipboard!`)
  }

  const headedLoginCmd = "uv run python scripts/headed_login.py --platform x"
  const testSessionCmd = "uv run python scripts/test_session.py --platform x"

  return (
    <TooltipProvider>
      <div className="container max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Connected Accounts
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Connect API keys and browser sessions for publishing automation.
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
              Refresh connection states
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ======================= ULTRA-MINIMAL FLAT LIST ======================= */}
        <div className="divide-y divide-border/60 rounded-xl border bg-card shadow-xs overflow-hidden">
          {/* --- 1. LINKEDIN ROW --- */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 hover:bg-muted/10 transition-colors">
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
                      {linkedinProfile.email && `(${linkedinProfile.email})`}
                    </span>
                  ) : (
                    <span>
                      Official REST API connection for posting and scheduling.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 sm:self-center">
              {isLinkedInConnected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnectLinkedInMutation.mutate()}
                  disabled={disconnectLinkedInMutation.isPending}
                  className="text-xs h-8 font-medium border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive gap-1.5 transition-all shadow-xs"
                >
                  {disconnectLinkedInMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  Disconnect
                </Button>
              ) : needsLinkedInReconnect ? (
                <Button
                  onClick={() => connectLinkedInMutation.mutate()}
                  disabled={connectLinkedInMutation.isPending}
                  size="sm"
                  className="text-xs h-8 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1.5 font-medium shadow-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reconnect
                </Button>
              ) : (
                <Button
                  onClick={() => connectLinkedInMutation.mutate()}
                  disabled={connectLinkedInMutation.isPending}
                  size="sm"
                  className="text-xs h-8 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white gap-1.5 font-medium shadow-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Connect
                </Button>
              )}
            </div>
          </div>

          {/* --- 2. X (TWITTER) ROW & EXPANDABLE CLI DRAWER --- */}
          <div className="flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 hover:bg-muted/10 transition-colors">
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

                  {/* Session Path with lone Copy icon */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    <Folder className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                    <span className="font-mono text-[11px] text-foreground/75 truncate max-w-xs sm:max-w-sm">
                      {sessionPath}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            copyText(sessionPath, "path", "Session path")
                          }
                        >
                          {copiedKey === "path" ? (
                            <Check className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Copy path</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              {/* Right Action Hub */}
              <div className="flex items-center gap-2 shrink-0 sm:self-center">
                {/* CLI Expand Drawer Button */}
                <Button
                  variant={isCliExpanded ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setIsCliExpanded((prev) => !prev)}
                  className="text-xs h-8 gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  CLI
                  {isCliExpanded ? (
                    <ChevronUp className="h-3 w-3 opacity-60" />
                  ) : (
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  )}
                </Button>

                {/* Launch / Re-login */}
                <Button
                  onClick={() => connectXMutation.mutate(true)}
                  disabled={connectXMutation.isPending}
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 gap-1.5 font-medium"
                >
                  {connectXMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Laptop className="h-3.5 w-3.5" />
                  )}
                  {isXCookiePresent ? "Re-login" : "Launch Login"}
                </Button>

                {/* Live Headless Verify Check */}
                {isXCookiePresent && (
                  <Button
                    size="sm"
                    onClick={() => verifyXMutation.mutate()}
                    disabled={verifyXMutation.isPending}
                    className="text-xs h-8 gap-1.5 font-medium shadow-xs"
                  >
                    {verifyXMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    Verify
                  </Button>
                )}
              </div>
            </div>

            {/* --- EXPANDABLE INLINE CLI DRAWER (Animated Accordion Stretch) --- */}
            {isCliExpanded && (
              <div className="px-4 pb-4 sm:px-6 pt-1 bg-muted/20 border-t border-border/40 animate-in slide-in-from-top-2 duration-200">
                <div className="p-3 rounded-lg bg-background/80 border border-border/60 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Code2 className="h-3.5 w-3.5 text-primary" />
                    Terminal Automation Scripts
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* Command 1: Headed Login */}
                    <div className="p-2.5 rounded-md bg-muted/50 border border-border/40 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-muted-foreground font-semibold block uppercase tracking-wider mb-0.5">
                          1. Headed Login
                        </span>
                        <code className="text-[11px] font-mono text-primary block truncate select-all">
                          {headedLoginCmd}
                        </code>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={() =>
                              copyText(
                                headedLoginCmd,
                                "cli-login",
                                "Login command",
                              )
                            }
                          >
                            {copiedKey === "cli-login" ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Copy command</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Command 2: Verify Session */}
                    <div className="p-2.5 rounded-md bg-muted/50 border border-border/40 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-muted-foreground font-semibold block uppercase tracking-wider mb-0.5">
                          2. Verify Session
                        </span>
                        <code className="text-[11px] font-mono text-primary block truncate select-all">
                          {testSessionCmd}
                        </code>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={() =>
                              copyText(
                                testSessionCmd,
                                "cli-verify",
                                "Verify command",
                              )
                            }
                          >
                            {copiedKey === "cli-verify" ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Copy command</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
