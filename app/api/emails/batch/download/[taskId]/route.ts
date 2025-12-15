import { NextResponse } from "next/server"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { createDb } from "@/lib/db"
import { batchTasks, emails } from "@/lib/schema"
import { eq, and, gte } from "drizzle-orm"

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

    // 先从 KV 获取任务（包含完整的 emailList）
    let emailList: string[] = []
    let taskStatus = "unknown"
    
    const taskData = await env.SITE_CONFIG.get(`batch_task:${taskId}`)
    if (taskData) {
      // KV 中的任务还在，使用 KV 中的数据（包含 emailList）
      const task: BatchTask = JSON.parse(taskData)
      
      // 验证用户权限
      if (task.userId !== userId) {
        return NextResponse.json(
          { error: "无权访问此任务" },
          { status: 403 }
        )
      }

      if (task.status !== "completed") {
        return NextResponse.json(
          { error: "任务尚未完成" },
          { status: 400 }
        )
      }

      emailList = task.emailList || []
      taskStatus = task.status
    } else {
      // KV 中的任务已过期，从数据库查询
      const db = createDb()
      const dbTask = await db.query.batchTasks.findFirst({
        where: eq(batchTasks.id, taskId)
      })

      if (!dbTask) {
        return NextResponse.json(
          { error: "任务不存在" },
          { status: 404 }
        )
      }

      // 验证用户权限
      if (dbTask.userId !== userId) {
        return NextResponse.json(
          { error: "无权访问此任务" },
          { status: 403 }
        )
      }

      if (dbTask.status !== "completed") {
        return NextResponse.json(
          { error: "任务尚未完成" },
          { status: 400 }
        )
      }

      // 从数据库查询该批次创建的邮箱地址
      // 注意：由于无法精确匹配批次，我们查询该用户在任务创建时间前后创建的邮箱
      // 优先查询符合域名的邮箱，按创建时间排序
      const taskEmails = await db.query.emails.findMany({
        where: and(
          eq(emails.userId, userId),
          gte(emails.createdAt, dbTask.createdAt)
        ),
        orderBy: (emails, { asc }) => [asc(emails.createdAt)],
        limit: dbTask.totalCount * 2 // 多查询一些以确保覆盖
      })

      // 筛选出符合域名的邮箱，按创建时间排序，取前 createdCount 个
      const matchingEmails = taskEmails
        .filter(email => email.address.endsWith(`@${dbTask.domain}`))
        .slice(0, dbTask.createdCount)
        .map(email => email.address)

      emailList = matchingEmails
      
      // 如果查询到的邮箱数量少于实际创建数量，警告但不阻止下载
      if (emailList.length < dbTask.createdCount) {
        console.warn(`Task ${taskId}: Found ${emailList.length} emails, expected ${dbTask.createdCount}`)
      }
      taskStatus = dbTask.status
    }

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

