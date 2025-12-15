"use client"

import { useEffect, useState, useRef } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Copy, Plus, RefreshCw } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { nanoid } from "nanoid"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { EXPIRY_OPTIONS } from "@/types/email"
import { useCopy } from "@/hooks/use-copy"
import { useConfig } from "@/hooks/use-config"

interface CreateDialogProps {
  onEmailCreated: () => void
}

export function CreateDialog({ onEmailCreated }: CreateDialogProps) {
  const { config } = useConfig()
  const t = useTranslations("emails.create")
  const tList = useTranslations("emails.list")
  const tCommon = useTranslations("common.actions")
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [emailName, setEmailName] = useState("")
  const [currentDomain, setCurrentDomain] = useState("")
  const [expiryTime, setExpiryTime] = useState(EXPIRY_OPTIONS[1].value.toString())
  const [batchMode, setBatchMode] = useState(false)
  const [batchCount, setBatchCount] = useState(5)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<{
    status: string
    progress: number
    processed: number
    total: number
    created: number
  } | null>(null)
  // setTimeout 在浏览器与 Node 类型不同，这里使用 ReturnType 兼容两端
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { toast } = useToast()
  const { copyToClipboard } = useCopy()

  const generateRandomName = () => setEmailName(nanoid(8))

  const copyEmailAddress = () => {
    copyToClipboard(`${emailName}@${currentDomain}`)
  }

  const createEmail = async () => {
    if (!batchMode && !emailName.trim()) {
      toast({
        title: tList("error"),
        description: t("namePlaceholder"),
        variant: "destructive"
      })
      return
    }

    if (batchMode) {
      if (batchCount < 1) {
        toast({
          title: tList("error"),
          description: t("batchCountInvalid"),
          variant: "destructive"
        })
        return
      }
    }

    setLoading(true)
    setTaskId(null)
    setTaskStatus(null)
    
    try {
      // 大批量创建（>50）：使用异步任务
      const useAsync = batchMode && batchCount > 50
      const apiEndpoint = useAsync ? "/api/emails/batch/create" : "/api/emails/generate"
      
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: batchMode ? undefined : emailName,
          domain: currentDomain,
          expiryTime: parseInt(expiryTime),
          batch: batchMode ? batchCount : undefined
        })
      })

      if (!response.ok) {
        const data = await response.json()
        toast({
          title: tList("error"),
          description: (data as { error: string }).error,
          variant: "destructive"
        })
        setLoading(false)
        return
      }

      const data = await response.json() as { 
        id?: string
        email?: string
        count?: number
        emails?: string[]
        taskId?: string
        status?: string
      }

      // 如果是异步任务
      if (useAsync && data.taskId) {
        setTaskId(data.taskId)
        // 立即触发一次处理
        try {
          const processResponse = await fetch(`/api/emails/batch/process?taskId=${data.taskId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          })
          if (!processResponse.ok) {
            console.warn("Initial process trigger returned:", processResponse.status)
            // 即使失败也继续轮询
          }
        } catch (err) {
          console.error("Failed to trigger initial process:", err)
          // 即使失败也继续轮询，轮询时会重试
        }
        // 立即开始轮询
        pollTaskStatus(data.taskId)
      } else {
        // 同步任务完成
        if (batchMode && data.count) {
          toast({
            title: tList("success"),
            description: t("batchSuccess", { count: data.count })
          })
        } else {
          toast({
            title: tList("success"),
            description: t("success")
          })
        }
        onEmailCreated()
        setOpen(false)
        setEmailName("")
        setBatchCount(5)
        setLoading(false)
      }
    } catch (error) {
      toast({
        title: tList("error"),
        description: t("failed"),
        variant: "destructive"
      })
      setLoading(false)
    }
  }

  const pollTaskStatus = async (currentTaskId: string) => {
    // 清除之前的轮询
    if (pollingRef.current) {
      clearTimeout(pollingRef.current)
      pollingRef.current = null
    }

    const checkStatus = async () => {
      // 如果对话框已关闭，停止轮询
      if (!open) {
        if (pollingRef.current) {
          clearTimeout(pollingRef.current)
          pollingRef.current = null
        }
        return
      }

      try {
        const response = await fetch(`/api/emails/batch/status/${currentTaskId}`)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error("Failed to get task status:", response.status, errorData)
          throw new Error(`获取任务状态失败: ${response.status}`)
        }
        const status = await response.json() as {
          status: string
          progress: number
          processedCount: number
          totalCount: number
          createdCount: number
          error?: string
        }
        
        // 调试日志（开发环境可见，生产构建时会自动移除）
        // console.log("Task status:", status)
        
        setTaskStatus({
          status: status.status,
          progress: status.progress,
          processed: status.processedCount,
          total: status.totalCount,
          created: status.createdCount
        })

        if (status.status === "completed") {
          toast({
            title: tList("success"),
            description: t("batchSuccess", { count: status.createdCount })
          })
          onEmailCreated()
          setOpen(false)
          setEmailName("")
          setBatchCount(5)
          setTaskId(null)
          setTaskStatus(null)
          setLoading(false)
          if (pollingRef.current) {
            clearTimeout(pollingRef.current)
            pollingRef.current = null
          }
        } else if (status.status === "failed") {
          toast({
            title: tList("error"),
            description: status.error || "批量创建失败",
            variant: "destructive"
          })
          setTaskId(null)
          setTaskStatus(null)
          setLoading(false)
          if (pollingRef.current) {
            clearTimeout(pollingRef.current)
            pollingRef.current = null
          }
        } else {
          // 如果任务还没完成，检查是否需要触发下一批处理
          const needsTrigger = 
            (status.status === "pending" && status.processedCount === 0) || // 还没开始
            (status.status === "processing" && status.processedCount < status.totalCount) // 正在处理但还有剩余
          
          if (needsTrigger) {
            // 调试日志（开发环境可见，生产构建时会自动移除）
            // console.log(`Task status: ${status.status}, triggering next batch (${status.processedCount}/${status.totalCount})...`)
            fetch(`/api/emails/batch/process?taskId=${currentTaskId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" }
            }).then(res => {
              if (!res.ok) {
                console.error("Failed to trigger process:", res.status)
              } else {
                console.log("Process triggered successfully")
              }
            }).catch(err => {
              console.error("Failed to trigger process:", err)
            })
          }
          // 继续轮询
          pollingRef.current = setTimeout(checkStatus, 2000) // 每2秒轮询一次
        }
      } catch (error) {
        console.error("Failed to poll task status:", error)
        // 显示错误提示
        if (open) {
          toast({
            title: "查询任务状态失败",
            description: error instanceof Error ? error.message : "未知错误",
            variant: "destructive"
          })
        }
        // 只在对话框打开时继续
        if (open) {
          pollingRef.current = setTimeout(checkStatus, 3000) // 错误时3秒后重试
        }
      }
    }
    
    checkStatus()
  }

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if ((config?.emailDomainsArray?.length ?? 0) > 0) {
      setCurrentDomain(config?.emailDomainsArray[0] ?? "")
    }
  }, [config])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="batch-mode" className="text-sm font-medium">
              {t("batchMode")}
            </Label>
            <Switch
              id="batch-mode"
              checked={batchMode}
              onCheckedChange={(checked) => {
                setBatchMode(checked)
                if (checked) {
                  setEmailName("")
                }
              }}
            />
          </div>

          {!batchMode ? (
            <div className="flex gap-2">
              <Input
                value={emailName}
                onChange={(e) => setEmailName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className="flex-1"
              />
              {(config?.emailDomainsArray?.length ?? 0) > 1 && (
                <Select value={currentDomain} onValueChange={setCurrentDomain}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {config?.emailDomainsArray?.map(d => (
                      <SelectItem key={d} value={d}>@{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={generateRandomName}
                type="button"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="batch-count" className="text-sm text-muted-foreground mb-1 block">
                    {t("batchCount")}
                  </Label>
                  <Input
                    id="batch-count"
                    type="number"
                    min="1"
                    value={batchCount}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 1
                      setBatchCount(Math.max(1, value))
                    }}
                    placeholder={t("batchCountPlaceholder")}
                  />
                </div>
                {(config?.emailDomainsArray?.length ?? 0) > 1 && (
                  <div className="w-[180px]">
                    <Label className="text-sm text-muted-foreground mb-1 block">
                      {t("domain")}
                    </Label>
                    <Select value={currentDomain} onValueChange={setCurrentDomain}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {config?.emailDomainsArray?.map(d => (
                          <SelectItem key={d} value={d}>@{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("batchHint")}
              </p>
              {loading && batchMode && taskStatus && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>
                      {taskStatus.status === "processing" 
                        ? t("batchCreatingProgress", { 
                            processed: taskStatus.processed, 
                            total: taskStatus.total 
                          })
                        : taskStatus.status === "pending"
                        ? "任务已创建，等待处理..."
                        : "处理中..."
                      }
                    </span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${taskStatus.progress}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    进度: {taskStatus.processed} / {taskStatus.total} ({taskStatus.progress}%) | 
                    已创建: {taskStatus.created}
                  </div>
                </div>
              )}
              {loading && batchMode && !taskStatus && batchCount <= 50 && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>{t("batchCreatingProgress", { processed: 0, total: batchCount })}</span>
                </div>
              )}
              {loading && batchMode && !taskStatus && batchCount > 50 && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>正在创建异步任务...</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4">
            <Label className="shrink-0 text-muted-foreground">{t("expiryTime")}</Label>
            <RadioGroup
              value={expiryTime}
              onValueChange={setExpiryTime}
              className="flex gap-6"
            >
              {EXPIRY_OPTIONS.map((option, index) => {
                const labels = [t("oneHour"), t("oneDay"), t("threeDays"), t("permanent")]
                return (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem value={option.value.toString()} id={option.value.toString()} />
                    <Label htmlFor={option.value.toString()} className="cursor-pointer text-sm">
                      {labels[index]}
                    </Label>
                  </div>
                )
              })}
            </RadioGroup>
          </div>

          {!batchMode && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="shrink-0">{t("domain")}:</span>
              {emailName ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{`${emailName}@${currentDomain}`}</span>
                  <div
                    className="shrink-0 cursor-pointer hover:text-primary transition-colors"
                    onClick={copyEmailAddress}
                  >
                    <Copy className="size-4" />
                  </div>
                </div>
              ) : (
                <span className="text-gray-400">...</span>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={createEmail} disabled={loading}>
            {loading 
              ? (batchMode ? t("batchCreating") : t("creating")) 
              : (batchMode ? t("batchCreate") : t("create"))
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
} 