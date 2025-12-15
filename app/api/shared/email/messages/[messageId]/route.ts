import { createDb } from "@/lib/db"
import { messages, emails } from "@/lib/schema"
import { eq, and } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { NextResponse } from "next/server"

export const runtime = "edge"

// 通过邮箱地址和消息ID获取消息详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params
  const { searchParams } = new URL(request.url)
  const emailAddress = searchParams.get('email')

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

    // 获取消息详情
    const message = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.emailId, email.id)
      )
    })

    if (!message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      message: {
        id: message.id,
        from_address: message.fromAddress,
        to_address: message.toAddress,
        subject: message.subject,
        content: message.content,
        html: message.html,
        received_at: message.receivedAt,
        sent_at: message.sentAt
      }
    })
  } catch (error) {
    console.error("Failed to fetch shared message:", error)
    return NextResponse.json(
      { error: "Failed to fetch message" },
      { status: 500 }
    )
  }
}

