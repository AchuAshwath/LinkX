import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Folder,
  Laptop,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
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
                    className="text-[11px] py-0 px-2 font-normal text-muted-foreground"
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
                    <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
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

          {/* --- 2. X (TWITTER) ROW & EXPANDABLE COMMAND BLOCKS --- */}
          <div className="flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 hover:bg-muted/10 transition-colors">
              <button
                type="button"
                onClick={() => setIsCliExpanded((prev) => !prev)}
                className="flex items-center gap-3.5 min-w-0 text-left cursor-pointer flex-1 group focus:outline-none"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground group-hover:bg-foreground/15 transition-colors">
                  <FaXTwitter className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">X (Twitter)</span>
                    <Badge
                      variant="outline"
                      className="text-[11px] py-0 px-2 font-normal text-muted-foreground"
                    >
                      Browser Profile
                    </Badge>
                    {isXCookiePresent ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                        Session Active
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
                        No Session
                      </span>
                    )}
                  </div>

                  {/* Session Path with embedded copy button */}
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/60 border border-border/50 text-xs text-foreground/80 group/path">
                      <Folder className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                      <code className="text-[11px] font-mono truncate max-w-[180px] sm:max-w-[260px] select-all">
                        {sessionPath}
                      </code>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors ml-0.5 focus:outline-none"
                            onClick={(e) => {
                              e.stopPropagation()
                              copyText(sessionPath, "path", "Session path")
                            }}
                          >
                            {copiedKey === "path" ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Copy session path
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </button>

              {/* Right Action Hub */}
              <div className="flex items-center gap-2 shrink-0 sm:self-center">
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

            {/* --- EXPANDABLE INLINE CLI COMMAND SNIPPET BLOCKS --- */}
            {isCliExpanded && (
              <div className="p-4 sm:px-6 sm:pb-5 pt-2 bg-muted/15 border-t border-border/40 space-y-3 animate-in slide-in-from-top-1 duration-150">
                {/* Command 1: Headed Login */}
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground font-medium pl-0.5">
                    1. Headed Login
                  </span>
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground/90 shadow-2xs group">
                    <span className="truncate select-all flex items-center gap-2 text-xs font-mono">
                      <span className="text-muted-foreground/60 select-none">
                        $
                      </span>
                      <span className="text-primary font-medium">
                        {headedLoginCmd}
                      </span>
                    </span>
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
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Copy command</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Command 2: Verify Session */}
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground font-medium pl-0.5">
                    2. Verify Session
                  </span>
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground/90 shadow-2xs group">
                    <span className="truncate select-all flex items-center gap-2 text-xs font-mono">
                      <span className="text-muted-foreground/60 select-none">
                        $
                      </span>
                      <span className="text-primary font-medium">
                        {testSessionCmd}
                      </span>
                    </span>
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
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Copy command</TooltipContent>
                    </Tooltip>
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
