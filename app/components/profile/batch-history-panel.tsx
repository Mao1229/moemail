"use client"

import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Download, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

interface BatchHistoryItem {
  id: string
  domain: string
  totalCount: number
  createdCount: number
  status: "pending" | "processing" | "completed" | "failed"
  error?: string
  createdAt: Date
  completedAt?: Date
}

interface BatchHistoryResponse {
  history: Array<{
    id: string
    domain: string
    totalCount: number
    createdCount: number
    status: BatchHistoryItem["status"]
    error?: string
    createdAt: string
    completedAt?: string
  }>
  total: number
  limit: number
  offset: number
}

export function BatchHistoryPanel() {
  const t = useTranslations("profile.batchHistory")
  const tCommon = useTranslations("common.actions")
  const { toast } = useToast()
  const [history, setHistory] = useState<BatchHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  
  // 获取当前语言环境
  const currentLocale = useLocale()
  
  // 格式化相对时间
  const formatRelativeTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (currentLocale === "zh-CN") {
      if (days > 0) return `${days} 天前`
      if (hours > 0) return `${hours} 小时前`
      if (minutes > 0) return `${minutes} 分钟前`
      return "刚刚"
    } else {
      if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ago`
      if (hours > 0) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
      if (minutes > 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
      return "just now"
    }
  }

  const fetchHistory = async (currentOffset = 0) => {
    try {
      if (currentOffset === 0) {
        setLoading(true)
      } else {
        setLoadingMore(true)
      }

      const response = await fetch(`/api/emails/batch/history?limit=20&offset=${currentOffset}`)
      if (!response.ok) {
        throw new Error("获取批次历史失败")
      }

      const data = await response.json() as BatchHistoryResponse
      const items: BatchHistoryItem[] = data.history.map(item => ({
        ...item,
        createdAt: new Date(item.createdAt),
        completedAt: item.completedAt ? new Date(item.completedAt) : undefined,
      }))

      if (currentOffset === 0) {
        setHistory(items)
      } else {
        setHistory(prev => [...prev, ...items])
      }

      setHasMore(data.history.length === 20 && (currentOffset + data.history.length) < data.total)
      setOffset(currentOffset + data.history.length)
    } catch (error) {
      console.error("Failed to fetch batch history:", error)
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : "获取批次历史失败",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    fetchHistory(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const downloadEmailList = async (taskId: string) => {
    try {
      const response = await fetch(`/api/emails/batch/download/${taskId}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error((errorData as { error?: string }).error || "下载失败")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      // 文件名由后端 Content-Disposition 头控制，这里只是备用
      a.download = `email-links-${taskId}.txt`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: t("downloadSuccess"),
        description: "邮箱列表下载成功"
      })
    } catch (error) {
      console.error("Failed to download email list:", error)
      toast({
        title: t("downloadError"),
        description: error instanceof Error ? error.message : "下载失败，请稍后重试",
        variant: "destructive"
      })
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />
      case "processing":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
      default:
        return <Clock className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed":
        return t("status.completed")
      case "failed":
        return t("status.failed")
      case "processing":
        return t("status.processing")
      default:
        return t("status.pending")
    }
  }

  if (loading && history.length === 0) {
    return (
      <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
        <div className="flex items-center gap-2 mb-6">
          <Download className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">{t("title")}</h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Download className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
      </div>

      {history.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("noHistory")}
        </div>
      ) : (
        <div className="space-y-4">
          {history.map((item) => (
            <div
              key={item.id}
              className="border rounded-lg p-4 space-y-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    <span className="font-medium">{getStatusText(item.status)}</span>
                    <span className="text-sm text-muted-foreground">
                      @{item.domain}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t("createdCount", { count: item.createdCount })} / {t("totalCount", { count: item.totalCount })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("createdAt")}: {formatRelativeTime(item.createdAt)}
                    {item.completedAt && (
                      <> · {t("completedAt")}: {formatRelativeTime(item.completedAt)}</>
                    )}
                  </div>
                  {item.error && (
                    <div className="text-xs text-red-500">
                      {t("error")}: {item.error}
                    </div>
                  )}
                </div>
                {item.status === "completed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadEmailList(item.id)}
                    className="gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {t("download")}
                  </Button>
                )}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => fetchHistory(offset)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {tCommon("loading")}
                  </>
                ) : (
                  t("loadMore")
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

