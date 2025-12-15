import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { createDb } from "@/lib/db"
import { emails, batchTasks } from "@/lib/schema"
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
  emailList?: string[] // 保存创建的邮箱地址列表
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

    // 如果无法生成足够的唯一邮箱地址，记录警告但继续处理已生成的
    if (emailDataList.length === 0 && attempts >= maxAttempts) {
      console.warn(`Failed to generate any unique email addresses for task ${taskId} after ${maxAttempts} attempts`)
      // 继续处理，让 processedCount 增加，但不会创建任何邮箱
      // 这样可以避免任务卡在无限循环中
    }

    // 批量插入
    const INSERT_BATCH_SIZE = 20
    let created = 0
    const createdAddresses: string[] = []

    // 只有当有数据需要插入时才执行插入操作
    if (emailDataList.length > 0) {
      try {
        for (let i = 0; i < emailDataList.length; i += INSERT_BATCH_SIZE) {
          const batch = emailDataList.slice(i, i + INSERT_BATCH_SIZE)
          const batchResults = await db.insert(emails)
            .values(batch)
            .returning({ id: emails.id, address: emails.address })
          created += batchResults.length
          // 收集创建的邮箱地址
          createdAddresses.push(...batchResults.map(r => r.address))
        }
      } catch (insertError) {
        console.error(`Failed to insert emails for task ${taskId}:`, insertError)
        // 如果插入失败，抛出错误以便上层处理
        throw new Error(`邮箱插入失败: ${insertError instanceof Error ? insertError.message : "未知错误"}`)
      }
    }

    // 更新任务进度
    // 注意：processedCount 应该是实际尝试处理的数量（emailDataList.length），
    // 而不是 toProcess，因为可能由于碰撞等原因导致实际生成的邮箱数量少于 toProcess
    const actualProcessed = emailDataList.length
    task.processedCount += actualProcessed
    task.createdCount += created
    task.updatedAt = Date.now()
    
    // 累积保存创建的邮箱地址列表（只保存成功创建的）
    if (createdAddresses.length > 0) {
      if (!task.emailList) {
        task.emailList = []
      }
      task.emailList.push(...createdAddresses)
    }
    
    // 确保 processedCount 不会超过 totalCount（边界检查）
    if (task.processedCount > task.totalCount) {
      task.processedCount = task.totalCount
    }

    // 检查是否完成
    if (task.processedCount >= task.totalCount) {
      task.processedCount = task.totalCount // 确保精确等于总数
      task.status = "completed"
      
      // 保存到数据库以便历史查看
      try {
        // 先尝试更新，如果不存在则插入
        const existing = await db.query.batchTasks.findFirst({
          where: eq(batchTasks.id, taskId)
        })
        
        if (existing) {
          await db.update(batchTasks)
            .set({
              createdCount: task.createdCount,
              status: "completed",
              completedAt: new Date(),
            })
            .where(eq(batchTasks.id, taskId))
        } else {
          await db.insert(batchTasks).values({
            id: taskId,
            userId: task.userId,
            domain: task.domain,
            totalCount: task.totalCount,
            createdCount: task.createdCount,
            status: "completed",
            createdAt: new Date(task.createdAt),
            completedAt: new Date(),
          })
        }
      } catch (dbError) {
        // 数据库保存失败不影响 KV 存储，只记录错误
        console.error(`Failed to save batch task ${taskId} to database:`, dbError)
      }
    }

    // 保存任务状态
    // 检查 KV 存储大小限制（Cloudflare KV 单条记录最大 25MB）
    // 10 万个邮箱地址约 2.5MB（每个地址约 25 字节），加上 JSON 格式约 3-4MB，应该安全
    const taskJson = JSON.stringify(task)
    const taskSizeBytes = new TextEncoder().encode(taskJson).length
    const taskSizeMB = taskSizeBytes / (1024 * 1024)
    
    if (taskSizeMB > 20) {
      console.warn(`Task ${taskId} size is ${taskSizeMB.toFixed(2)}MB, close to KV limit (25MB)`)
    }
    
    await env.SITE_CONFIG.put(
      `batch_task:${taskId}`,
      taskJson,
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
      const env = getRequestContext().env
      const db = createDb()
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
          
          // 保存失败状态到数据库
          try {
            // 先尝试更新，如果不存在则插入
            const existing = await db.query.batchTasks.findFirst({
              where: eq(batchTasks.id, taskId)
            })
            
            if (existing) {
              await db.update(batchTasks)
                .set({
                  createdCount: task.createdCount,
                  status: "failed",
                  error: task.error,
                  completedAt: new Date(),
                })
                .where(eq(batchTasks.id, taskId))
            } else {
              await db.insert(batchTasks).values({
                id: taskId,
                userId: task.userId,
                domain: task.domain,
                totalCount: task.totalCount,
                createdCount: task.createdCount,
                status: "failed",
                error: task.error,
                createdAt: new Date(task.createdAt),
                completedAt: new Date(),
              })
            }
          } catch (dbError) {
            console.error(`Failed to save failed batch task ${taskId} to database:`, dbError)
          }
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

