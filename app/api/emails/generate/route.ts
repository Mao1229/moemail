import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { createDb } from "@/lib/db"
import { emails, batchTasks } from "@/lib/schema"
import { eq, and, gt, sql } from "drizzle-orm"
import { EXPIRY_OPTIONS } from "@/types/email"
import { EMAIL_CONFIG } from "@/config"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import { ROLES } from "@/lib/permissions"

export const runtime = "edge"

export async function POST(request: Request) {
  const db = createDb()
  const env = getRequestContext().env

  const userId = await getUserId()
  const userRole = await getUserRole(userId!)

  try {
    const { name, expiryTime, domain, batch } = await request.json<{ 
      name?: string
      expiryTime: number
      domain: string
      batch?: number
    }>()

    const batchCount = batch || 1
    
    if (userRole !== ROLES.EMPEROR) {
      const maxEmails = await env.SITE_CONFIG.get("MAX_EMAILS") || EMAIL_CONFIG.MAX_ACTIVE_EMAILS.toString()
      const activeEmailsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(emails)
        .where(
          and(
            eq(emails.userId, userId!),
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

    // 限制批量创建数量，避免超时和资源消耗过大
    const MAX_BATCH_SIZE = 50
    if (batchCount < 1 || batchCount > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `批量创建数量必须在 1-${MAX_BATCH_SIZE} 之间` },
        { status: 400 }
      )
    }

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

    const now = new Date()
    const expires = expiryTime === 0 
      ? new Date('9999-01-01T00:00:00.000Z')
      : new Date(now.getTime() + expiryTime)
    
    // 批量创建
    if (batchCount > 1) {
      const emailDataList: (typeof emails.$inferInsert)[] = []
      const addressSet = new Set<string>()
      let attempts = 0
      const maxAttempts = batchCount * 5 // 允许最多尝试 5 倍数量
      
      // 优化：nanoid 的碰撞概率极低，可以先批量生成，然后批量检查
      // 这样可以减少数据库往返次数
      while (emailDataList.length < batchCount && attempts < maxAttempts) {
        attempts++
        const address = `${nanoid(8)}@${domain}`
        const addressLower = address.toLowerCase()
        
        // 检查是否已在本次批量中生成
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
            userId: userId!
          })
        }
      }
      
      if (emailDataList.length === 0) {
        return NextResponse.json(
          { error: "无法生成唯一的邮箱地址，请稍后重试" },
          { status: 500 }
        )
      }
      
      // 分批插入，避免 SQLite 变量数量限制
      // SQLite 最多支持约 999 个 SQL 变量，每个邮箱 4 个字段，所以每批最多约 200 个
      // 为了安全，使用更小的批次大小
      const INSERT_BATCH_SIZE = 20
      const allResults: Array<{ id: string; address: string }> = []
      
      for (let i = 0; i < emailDataList.length; i += INSERT_BATCH_SIZE) {
        const batch = emailDataList.slice(i, i + INSERT_BATCH_SIZE)
        const batchResults = await db.insert(emails)
          .values(batch)
          .returning({ id: emails.id, address: emails.address })
        allResults.push(...batchResults)
      }

      // 将同步批量创建记录到批次历史（便于历史查询与下载）
      const taskId = nanoid(16)
      await db.insert(batchTasks).values({
        id: taskId,
        userId: userId!,
        domain,
        totalCount: allResults.length,
        createdCount: allResults.length,
        status: "completed",
        createdAt: now,
        completedAt: new Date(),
      })
      
      return NextResponse.json({ 
        count: allResults.length,
        emails: allResults.map(r => r.address),
        taskId,
        status: "completed",
      })
    }
    
    // 单个创建
    const address = `${name || nanoid(8)}@${domain}`
    const existingEmail = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, address.toLowerCase())
    })

    if (existingEmail) {
      return NextResponse.json(
        { error: "该邮箱地址已被使用" },
        { status: 409 }
      )
    }
    
    const emailData: typeof emails.$inferInsert = {
      address,
      createdAt: now,
      expiresAt: expires,
      userId: userId!
    }
    
    const result = await db.insert(emails)
      .values(emailData)
      .returning({ id: emails.id, address: emails.address })
    
    return NextResponse.json({ 
      id: result[0].id,
      email: result[0].address 
    })
  } catch (error) {
    console.error('Failed to generate email:', error)
    return NextResponse.json(
      { error: "创建邮箱失败" },
      { status: 500 }
    )
  }
} 