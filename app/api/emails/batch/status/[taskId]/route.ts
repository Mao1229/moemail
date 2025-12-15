import { NextResponse } from "next/server"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"

export const runtime = "edge"

interface BatchTask {
  taskId: string
  userId: string
  domain: string
  expiryTime: number
  totalCount: number
  processedCount: number
  createdCount: number
  status: "pending" | "processing" | "completed" | "failed"
  error?: string
  createdAt: number
  updatedAt: number
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const env = getRequestContext().env
  const { taskId } = await params

  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      )
    }

    // 从 KV 获取任务
    const taskData = await env.SITE_CONFIG.get(`batch_task:${taskId}`)
    if (!taskData) {
      return NextResponse.json(
        { error: "任务不存在或已过期" },
        { status: 404 }
      )
    }

    const task: BatchTask = JSON.parse(taskData)

    // 验证用户权限（只能查看自己的任务）
    if (task.userId !== userId) {
      return NextResponse.json(
        { error: "无权访问此任务" },
        { status: 403 }
      )
    }

    return NextResponse.json({
      taskId: task.taskId,
      status: task.status,
      totalCount: task.totalCount,
      processedCount: task.processedCount,
      createdCount: task.createdCount,
      progress: Math.round((task.processedCount / task.totalCount) * 100),
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    })
  } catch (error) {
    console.error('Failed to get batch task status:', error)
    return NextResponse.json(
      { error: "获取任务状态失败" },
      { status: 500 }
    )
  }
}

