import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { createDb } from "@/lib/db"
import { emails } from "@/lib/schema"
import { eq, and, gt, sql } from "drizzle-orm"
import { EXPIRY_OPTIONS } from "@/types/email"
import { EMAIL_CONFIG } from "@/config"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import { ROLES } from "@/lib/permissions"

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

// 大批量创建的阈值：超过这个数量使用异步任务模式
const ASYNC_THRESHOLD = 50

export async function POST(request: Request) {
  const env = getRequestContext().env
  const userId = await getUserId()
  
  if (!userId) {
    return NextResponse.json(
      { error: "未授权" },
      { status: 401 }
    )
  }
  
  const userRole = await getUserRole(userId)

  try {
    const { name, expiryTime, domain, batch } = await request.json<{ 
      name?: string
      expiryTime: number
      domain: string
      batch?: number
    }>()

    const batchCount = batch || 1

    // 验证参数
    if (!EXPIRY_OPTIONS.some(option => option.value === expiryTime)) {
      return NextResponse.json(
        { error: "无效的过期时间" },
        { status: 400 }
      )
    }

    const domainString = await env.SITE_CONFIG.get("EMAIL_DOMAINS")
    const domains = domainString ? domainString.split(',') : ["moemail.app"]

    if (!domains || !domains.includes(domain)) {
      return NextResponse.json(
        { error: "无效的域名" },
        { status: 400 }
      )
    }

    // 检查数量限制
    if (userRole !== ROLES.EMPEROR) {
      const db = createDb()
      const maxEmails = await env.SITE_CONFIG.get("MAX_EMAILS") || EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString()
      const activeEmailsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(emails)
        .where(
          and(
            eq(emails.userId, userId),
            gt(emails.expiresAt, new Date())
          )
        )
      
      const currentCount = Number(activeEmailsCount[0]?.count ?? 0)
      const maxCount = Number(maxEmails)
      
      if (currentCount + batchCount > maxCount) {
        return NextResponse.json(
          { error: `批量创建后邮箱数量将超过最大限制。当前: ${currentCount}/${maxCount}，尝试创建: ${batchCount}` },
          { status: 403 }
        )
      }
    }

    // 大批量创建：使用异步任务
    if (batchCount > ASYNC_THRESHOLD) {
      const taskId = nanoid(16)
      const now = Date.now()
      
      const task: BatchTask = {
        taskId,
        userId,
        domain,
        expiryTime,
        totalCount: batchCount,
        processedCount: 0,
        createdCount: 0,
        status: "pending",
        createdAt: now,
        updatedAt: now
      }

      // 存储任务到 KV
      await env.SITE_CONFIG.put(
        `batch_task:${taskId}`,
        JSON.stringify(task),
        { expirationTtl: 3600 * 24 } // 24小时过期
      )

      // 尝试触发任务处理（如果失败，前端轮询时会重试）
      // 注意：在 Edge Runtime 中，fetch 调用可能不会立即执行，所以前端也会触发
      try {
        const origin = new URL(request.url).origin
        const processUrl = `${origin}/api/emails/batch/process?taskId=${taskId}`
        
        // 不等待结果，让它在后台执行
        // 注意：在 Edge Runtime 中 fetch 可能不会立即执行，前端会通过轮询触发
        fetch(processUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        }).catch(() => {
          // 静默失败，前端会通过轮询检测并触发
        })
      } catch (err) {
        console.error("Error setting up batch process trigger:", err)
        // 即使失败也继续，前端会轮询并触发
      }

      return NextResponse.json({
        taskId,
        status: "pending",
        message: "批量创建任务已启动，请使用任务ID查询进度"
      })
    }

    // 小批量创建：直接处理（原有的同步逻辑）
    return NextResponse.json(
      { error: "请使用 /api/emails/generate 接口进行小批量创建（≤50）" },
      { status: 400 }
    )
  } catch (error) {
    console.error('Failed to create batch task:', error)
    return NextResponse.json(
      { error: "创建批量任务失败" },
      { status: 500 }
    )
  }
}

