import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { createDb } from "@/lib/db"
import { emails } from "@/lib/schema"
import { eq, sql } from "drizzle-orm"
import { getRequestContext } from "@cloudflare/next-on-pages"

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

// 每次处理的数量（可根据性能调整）
const PROCESS_BATCH_SIZE = 100

export async function POST(request: Request) {
  const env = getRequestContext().env
  const db = createDb()

  try {
    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get("taskId")

    if (!taskId) {
      return NextResponse.json(
        { error: "任务ID不能为空" },
        { status: 400 }
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

    // 检查任务状态
    if (task.status === "completed") {
      return NextResponse.json({
        status: "completed",
        processed: task.processedCount,
        total: task.totalCount,
        created: task.createdCount,
        progress: 100,
        message: "任务已完成"
      })
    }

    if (task.status === "failed") {
      return NextResponse.json({
        status: "failed",
        error: task.error,
        processed: task.processedCount,
        total: task.totalCount,
        created: task.createdCount,
        progress: Math.round((task.processedCount / task.totalCount) * 100)
      })
    }

    // 如果已经在处理中，但还没完成，继续处理
    if (task.status === "processing" && task.processedCount < task.totalCount) {
      // 继续处理剩余的（状态已经是 processing，不需要更新）
    } else if (task.status === "pending") {
      // 更新任务状态为处理中
      task.status = "processing"
      task.updatedAt = Date.now()
      
      // 立即保存状态更新
      await env.SITE_CONFIG.put(
        `batch_task:${taskId}`,
        JSON.stringify(task),
        { expirationTtl: 3600 * 24 }
      )
    } else {
      // 其他状态（completed/failed），不需要处理
      return NextResponse.json({
        status: task.status,
        processed: task.processedCount,
        total: task.totalCount,
        created: task.createdCount,
        progress: Math.round((task.processedCount / task.totalCount) * 100),
        message: task.status === "completed" ? "任务已完成" : "任务已失败"
      })
    }

    // 计算本次需要处理的数量
    const remaining = task.totalCount - task.processedCount
    const toProcess = Math.min(PROCESS_BATCH_SIZE, remaining)

    // 生成邮箱地址
    const emailDataList: (typeof emails.$inferInsert)[] = []
    const addressSet = new Set<string>()
    let attempts = 0
    const maxAttempts = toProcess * 5

    const now = new Date()
    const expires = task.expiryTime === 0 
      ? new Date('9999-01-01T00:00:00.000Z')
      : new Date(now.getTime() + task.expiryTime)

    while (emailDataList.length < toProcess && attempts < maxAttempts) {
      attempts++
      const address = `${nanoid(8)}@${task.domain}`
      const addressLower = address.toLowerCase()

      if (addressSet.has(addressLower)) {
        continue
      }

      addressSet.add(addressLower)

      // 检查数据库中是否已存在
      const existingEmail = await db.query.emails.findFirst({
        where: eq(sql`LOWER(${emails.address})`, addressLower)
      })

      if (!existingEmail) {
        emailDataList.push({
          address,
          createdAt: now,
          expiresAt: expires,
          userId: task.userId
        })
      }
    }

    // 批量插入
    const INSERT_BATCH_SIZE = 20
    let created = 0

    for (let i = 0; i < emailDataList.length; i += INSERT_BATCH_SIZE) {
      const batch = emailDataList.slice(i, i + INSERT_BATCH_SIZE)
      const batchResults = await db.insert(emails)
        .values(batch)
        .returning({ id: emails.id, address: emails.address })
      created += batchResults.length
    }

    // 更新任务进度
    // 注意：processedCount 应该是实际尝试处理的数量（emailDataList.length），
    // 而不是 toProcess，因为可能由于碰撞等原因导致实际生成的邮箱数量少于 toProcess
    const actualProcessed = emailDataList.length
    task.processedCount += actualProcessed
    task.createdCount += created
    task.updatedAt = Date.now()
    
    // 确保 processedCount 不会超过 totalCount（边界检查）
    if (task.processedCount > task.totalCount) {
      task.processedCount = task.totalCount
    }

    // 检查是否完成
    if (task.processedCount >= task.totalCount) {
      task.processedCount = task.totalCount // 确保精确等于总数
      task.status = "completed"
    }

    // 保存任务状态
    await env.SITE_CONFIG.put(
      `batch_task:${taskId}`,
      JSON.stringify(task),
      { expirationTtl: 3600 * 24 }
    )

    // 注意：不再在后端使用 fetch 触发下一批，因为 Edge Runtime 中可能不会立即执行
    // 改为由前端轮询时检测进度并主动触发下一批处理

    return NextResponse.json({
      status: task.status,
      processed: task.processedCount,
      total: task.totalCount,
      created: task.createdCount,
      progress: Math.round((task.processedCount / task.totalCount) * 100),
      hasMore: task.processedCount < task.totalCount // 告诉前端是否还有更多
    })
  } catch (error) {
    console.error('Failed to process batch task:', error)
    
    // 尝试更新任务状态为失败
    try {
      const { searchParams } = new URL(request.url)
      const taskId = searchParams.get("taskId")
      if (taskId) {
        const taskData = await env.SITE_CONFIG.get(`batch_task:${taskId}`)
        if (taskData) {
          const task: BatchTask = JSON.parse(taskData)
          task.status = "failed"
          task.error = error instanceof Error ? error.message : "处理失败"
          task.updatedAt = Date.now()
          await env.SITE_CONFIG.put(
            `batch_task:${taskId}`,
            JSON.stringify(task),
            { expirationTtl: 3600 * 24 }
          )
        }
      }
    } catch (updateError) {
      console.error("Failed to update task status:", updateError)
    }

    return NextResponse.json(
      { error: "处理批量任务失败" },
      { status: 500 }
    )
  }
}

