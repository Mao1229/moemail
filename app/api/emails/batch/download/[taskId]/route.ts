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
  emailList?: string[]
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

    // 验证用户权限（只能下载自己的任务）
    if (task.userId !== userId) {
      return NextResponse.json(
        { error: "无权访问此任务" },
        { status: 403 }
      )
    }

    // 检查任务是否完成
    if (task.status !== "completed") {
      return NextResponse.json(
        { error: "任务尚未完成" },
        { status: 400 }
      )
    }

    // 生成 TXT 文件内容
    const emailList = task.emailList || []
    if (emailList.length === 0) {
      return NextResponse.json(
        { error: "没有可下载的邮箱地址" },
        { status: 400 }
      )
    }
    const content = emailList.join("\n")

    // 对文件名进行编码，确保特殊字符正确处理
    const encodedFilename = encodeURIComponent(`emails-${taskId}.txt`)

    // 返回 TXT 文件
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
      },
    })
  } catch (error) {
    console.error('Failed to download batch emails:', error)
    return NextResponse.json(
      { error: "下载失败" },
      { status: 500 }
    )
  }
}

