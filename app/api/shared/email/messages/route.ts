import { createDb } from "@/lib/db"
import { messages, emails, emailShares } from "@/lib/schema"
import { eq, and, or, ne, isNull, lt } from "drizzle-orm"
import { NextResponse } from "next/server"
import { encodeCursor, decodeCursor } from "@/lib/cursor"
import { sql } from "drizzle-orm"

export const runtime = "edge"

const PAGE_SIZE = 20

// 通过邮箱地址获取消息列表
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const emailAddress = searchParams.get('email')
  const cursor = searchParams.get('cursor')

  if (!emailAddress) {
    return NextResponse.json(
      { error: "Email parameter is required" },
      { status: 400 }
    )
  }

  const db = createDb()

  try {
    // 查找邮箱（使用大小写不敏感查询）
    const email = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, emailAddress.toLowerCase())
    })

    if (!email) {
      return NextResponse.json(
        { error: "Email not found" },
        { status: 404 }
      )
    }

    // 检查邮箱是否过期
    if (email.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "Email has expired" },
        { status: 410 }
      )
    }

    // 允许所有有效且未过期的邮箱通过地址访问

    // 只显示接收的邮件，不显示发送的邮件
    const baseConditions = and(
      eq(messages.emailId, email.id),
      or(
        ne(messages.type, "sent"),
        isNull(messages.type)
      )
    )

    // 获取消息总数（只统计接收的邮件）
    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(baseConditions)
    const totalCount = Number(totalResult[0].count)

    const conditions = [baseConditions]

    if (cursor) {
      const { timestamp, id } = decodeCursor(cursor)
      const cursorCondition = or(
        lt(messages.receivedAt, new Date(timestamp)),
        and(
          eq(messages.receivedAt, new Date(timestamp)),
          lt(messages.id, id)
        )
      )
      if (cursorCondition) {
        conditions.push(cursorCondition)
      }
    }

    const results = await db.query.messages.findMany({
      where: and(...conditions),
      orderBy: (messages, { desc }) => [
        desc(messages.receivedAt),
        desc(messages.id)
      ],
      limit: PAGE_SIZE + 1
    })

    const hasMore = results.length > PAGE_SIZE
    const nextCursor = hasMore
      ? encodeCursor(
          results[PAGE_SIZE - 1].receivedAt.getTime(),
          results[PAGE_SIZE - 1].id
        )
      : null
    const messageList = hasMore ? results.slice(0, PAGE_SIZE) : results

    return NextResponse.json({
      messages: messageList.map(msg => ({
        id: msg.id,
        from_address: msg.fromAddress,
        to_address: msg.toAddress,
        subject: msg.subject,
        received_at: msg.receivedAt,
        sent_at: msg.sentAt
      })),
      nextCursor,
      total: totalCount
    })
  } catch (error) {
    console.error("Failed to fetch shared messages by email:", error)
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    )
  }
}

