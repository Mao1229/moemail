"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { CreateDialog } from "./create-dialog"
import { ShareDialog } from "./share-dialog"
import { Mail, RefreshCw, Trash2, MoreVertical, CheckSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useThrottle } from "@/hooks/use-throttle"
import { EMAIL_CONFIG } from "@/config"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ROLES } from "@/lib/permissions"
import { useUserRole } from "@/hooks/use-user-role"
import { useConfig } from "@/hooks/use-config"

interface Email {
  id: string
  address: string
  createdAt: number
  expiresAt: number
}

interface EmailListProps {
  onEmailSelect: (email: Email | null) => void
  selectedEmailId?: string
}

interface EmailResponse {
  emails: Email[]
  nextCursor: string | null
  total: number
}

export function EmailList({ onEmailSelect, selectedEmailId }: EmailListProps) {
  const { data: session } = useSession()
  const { config } = useConfig()
  const { role } = useUserRole()
  const t = useTranslations("emails.list")
  const tCommon = useTranslations("common.actions")
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [emailToDelete, setEmailToDelete] = useState<Email | null>(null)
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set())
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { toast } = useToast()

  const fetchEmails = async (cursor?: string) => {
    try {
      const url = new URL("/api/emails", window.location.origin)
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }
      const response = await fetch(url)
      const data = await response.json() as EmailResponse
      
      if (!cursor) {
        const newEmails = data.emails
        const oldEmails = emails

        const lastDuplicateIndex = newEmails.findIndex(
          newEmail => oldEmails.some(oldEmail => oldEmail.id === newEmail.id)
        )

        if (lastDuplicateIndex === -1) {
          setEmails(newEmails)
          // 清理选中状态中不存在的邮箱ID
          setSelectedEmailIds(prev => {
            const newEmailIds = new Set(newEmails.map(e => e.id))
            return new Set([...prev].filter(id => newEmailIds.has(id)))
          })
          setNextCursor(data.nextCursor)
          setTotal(data.total)
          return
        }
        const uniqueNewEmails = newEmails.slice(0, lastDuplicateIndex)
        const finalEmails = [...uniqueNewEmails, ...oldEmails]
        setEmails(finalEmails)
        // 清理选中状态中不存在的邮箱ID
        setSelectedEmailIds(prev => {
          const finalEmailIds = new Set(finalEmails.map(e => e.id))
          return new Set([...prev].filter(id => finalEmailIds.has(id)))
        })
        setTotal(data.total)
        return
      }
      setEmails(prev => [...prev, ...data.emails])
      setNextCursor(data.nextCursor)
      setTotal(data.total)
    } catch (error) {
      console.error("Failed to fetch emails:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setSelectedEmailIds(new Set()) // 刷新时清空选中状态
    await fetchEmails()
  }

  const handleScroll = useThrottle((e: React.UIEvent<HTMLDivElement>) => {
    if (loadingMore) return

    const { scrollHeight, scrollTop, clientHeight } = e.currentTarget
    const threshold = clientHeight * 1.5
    const remainingScroll = scrollHeight - scrollTop

    if (remainingScroll <= threshold && nextCursor) {
      setLoadingMore(true)
      fetchEmails(nextCursor)
    }
  }, 200)

  useEffect(() => {
    if (session) fetchEmails()
  }, [session])

  const handleDelete = async (email: Email) => {
    try {
      const response = await fetch(`/api/emails/${email.id}`, {
        method: "DELETE"
      })

      if (!response.ok) {
        const data = await response.json()
        toast({
          title: t("error"),
          description: (data as { error: string }).error,
          variant: "destructive"
        })
        return
      }

      setEmails(prev => prev.filter(e => e.id !== email.id))
      setTotal(prev => prev - 1)
      setSelectedEmailIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(email.id)
        return newSet
      })

      toast({
        title: t("success"),
        description: t("deleteSuccess")
      })
      
      if (selectedEmailId === email.id) {
        onEmailSelect(null)
      }
    } catch {
      toast({
        title: t("error"),
        description: t("deleteFailed"),
        variant: "destructive"
      })
    } finally {
      setEmailToDelete(null)
    }
  }

  // 批量删除处理
  const handleBatchDelete = async () => {
    if (selectedEmailIds.size === 0) return

    setDeleting(true)
    try {
      const emailIds = Array.from(selectedEmailIds)
      const response = await fetch("/api/emails/batch/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ emailIds }),
      })

      if (!response.ok) {
        const data = await response.json()
        toast({
          title: t("error"),
          description: (data as { error: string }).error || t("batchDeleteFailed"),
          variant: "destructive",
        })
        return
      }

      const result = await response.json() as { deletedCount: number; failedCount: number }
      
      // 移除已删除的邮箱
      // 保存当前选中的邮箱ID（用于检查是否需要清空选中状态）
      const wasSelectedEmailDeleted = selectedEmailId && selectedEmailIds.has(selectedEmailId)
      
      // 移除已删除的邮箱
      setEmails(prev => prev.filter(e => !selectedEmailIds.has(e.id)))
      setTotal(prev => prev - result.deletedCount)
      
      // 清空选中状态
      setSelectedEmailIds(new Set())
      setBatchDeleteOpen(false)

      // 如果当前选中的邮箱被删除了，清空选中状态
      if (wasSelectedEmailDeleted) {
        onEmailSelect(null)
      }

      toast({
        title: t("success"),
        description: t("batchDeleteSuccess", { count: result.deletedCount }),
      })
    } catch (error) {
      console.error("Failed to batch delete emails:", error)
      toast({
        title: t("error"),
        description: t("batchDeleteFailed"),
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
    }
  }

  // 全部删除处理
  const handleDeleteAll = async () => {
    if (total === 0) return

    setDeleting(true)
    try {
      const response = await fetch("/api/emails/delete-all", {
        method: "POST",
      })

      if (!response.ok) {
        const data = await response.json()
        toast({
          title: t("error"),
          description: (data as { error: string }).error || t("deleteAllFailed"),
          variant: "destructive",
        })
        return
      }

      const result = await response.json() as { deletedCount: number }
      
      // 清空所有邮箱
      setEmails([])
      setTotal(0)
      setSelectedEmailIds(new Set())
      setDeleteAllOpen(false)
      
      // 如果当前选中的邮箱被删除，清空选中状态
      if (selectedEmailId) {
        onEmailSelect(null)
      }

      toast({
        title: t("success"),
        description: t("deleteAllSuccess", { count: result.deletedCount }),
      })
      
      // 刷新列表（虽然应该是空的）
      handleRefresh()
    } catch (error) {
      console.error("Failed to delete all emails:", error)
      toast({
        title: t("error"),
        description: t("deleteAllFailed"),
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
    }
  }

  // 切换单个邮箱的选中状态
  const toggleEmailSelection = (emailId: string) => {
    setSelectedEmailIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(emailId)) {
        newSet.delete(emailId)
      } else {
        newSet.add(emailId)
      }
      return newSet
    })
  }

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedEmailIds(new Set(emails.map(e => e.id)))
    } else {
      setSelectedEmailIds(new Set())
    }
  }

  const allSelected = emails.length > 0 && selectedEmailIds.size === emails.length
  const someSelected = selectedEmailIds.size > 0 && selectedEmailIds.size < emails.length

  if (!session) return null

  const hasSelection = selectedEmailIds.size > 0

  return (
    <>
      <div className="flex flex-col h-full">
        {/* 顶部工具栏 - 平滑过渡 */}
        <div className="border-b border-primary/20 p-2">
          <div className="flex justify-between items-center transition-all duration-200">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing}
                className={cn("h-8 w-8 shrink-0", refreshing && "animate-spin")}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              
              {/* 动态内容区域 - 使用绝对定位避免布局跳动 */}
              <div className="relative flex items-center gap-3 flex-1 min-w-0">
                {/* 正常模式内容 */}
                <div className={cn(
                  "flex items-center gap-2 transition-all duration-200 absolute inset-0",
                  hasSelection ? "opacity-0 pointer-events-none -translate-x-2" : "opacity-100 translate-x-0"
                )}>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {role === ROLES.EMPEROR ? (
                      t("emailCountUnlimited", { count: total })
                    ) : (
                      t("emailCount", { count: total, max: config?.maxEmails || EMAIL_CONFIG.MAX_ACTIVE_EMAILS })
                    )}
                  </span>
                  {emails.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() => handleSelectAll(true)}
                        >
                          <CheckSquare className="h-4 w-4 mr-2" />
                          {t("selectAll")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteAllOpen(true)}
                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t("deleteAll")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                
                {/* 批量选择模式内容 */}
                <div className={cn(
                  "flex items-center gap-2.5 transition-all duration-200 absolute inset-0",
                  hasSelection ? "opacity-100 translate-x-0" : "opacity-0 pointer-events-none translate-x-2"
                )}>
                  <div className="flex items-center">
                    <Checkbox
                      checked={allSelected}
                      onChange={handleSelectAll}
                      className="shrink-0 scale-75"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {t("selectedCount", { count: selectedEmailIds.size })}
                  </span>
                  {someSelected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSelectAll(true)}
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {t("selectAll")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            
            {/* 右侧操作按钮区域 */}
            <div className="flex items-center gap-2 shrink-0">
              {hasSelection && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedEmailIds(new Set())}
                    className="h-7 px-3 text-xs transition-all duration-200 animate-in fade-in slide-in-from-right-2"
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setBatchDeleteOpen(true)}
                    className="h-7 gap-1.5 px-3 transition-all duration-200 animate-in fade-in slide-in-from-right-2"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("batchDelete")}
                  </Button>
                </>
              )}
              {!hasSelection && (
                <div className="transition-all duration-200 animate-in fade-in">
                  <CreateDialog onEmailCreated={handleRefresh} />
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto p-2" onScroll={handleScroll}>
          {loading ? (
            <div className="text-center text-sm text-muted-foreground">{t("loading")}</div>
          ) : emails.length > 0 ? (
            <div className="space-y-0.5">
              {emails.map(email => {
                const isSelected = selectedEmailIds.has(email.id)
                const isCurrentSelected = selectedEmailId === email.id
                
                return (
                  <div
                    key={email.id}
                    className={cn(
                      "group flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer text-sm transition-all duration-150",
                      "hover:bg-accent/40",
                      isCurrentSelected && !isSelected && "bg-accent/30"
                    )}
                    onClick={() => onEmailSelect(email)}
                  >
                    <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleEmailSelection(email.id)}
                        className="shrink-0 scale-75"
                      />
                    </div>
                    <Mail className={cn(
                      "h-4 w-4 shrink-0 transition-colors duration-150",
                      isSelected ? "text-primary/80" : "text-muted-foreground/60 group-hover:text-muted-foreground"
                    )} />
                    <div className="truncate flex-1 min-w-0">
                      <div className={cn(
                        "font-medium truncate transition-colors duration-150",
                        isSelected ? "text-foreground" : "text-foreground/90 group-hover:text-foreground"
                      )}>
                        {email.address}
                      </div>
                      <div className="text-xs text-muted-foreground/70">
                        {new Date(email.expiresAt).getFullYear() === 9999 ? (
                          t("permanent")
                        ) : (
                          `${t("expiresAt")}: ${new Date(email.expiresAt).toLocaleString()}`
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {/* 分享按钮：始终显示 */}
                      <ShareDialog emailId={email.id} emailAddress={email.address} />
                      {/* 删除按钮：只在无批量选中时显示 */}
                      {!hasSelection && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEmailToDelete(email)
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
              {loadingMore && (
                <div className="text-center text-sm text-muted-foreground py-2">
                  {t("loadingMore")}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              {t("noEmails")}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!emailToDelete} onOpenChange={() => setEmailToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { email: emailToDelete?.address || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => emailToDelete && handleDelete(emailToDelete)}
            >
              {tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batchDeleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batchDeleteDescription", { count: selectedEmailIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleBatchDelete}
              disabled={deleting}
            >
              {deleting ? t("deleting") : tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteAllConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteAllDescription", { count: total })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleDeleteAll}
              disabled={deleting}
            >
              {deleting ? t("deleting") : tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
} 