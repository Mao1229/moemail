import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"
import { and, desc, eq, sql } from "drizzle-orm"
import { getUserId } from "@/lib/apiKey"
import { checkBasicSendPermission } from "@/lib/send-permissions"

export const runtime = "edge"

// 通过邮箱地址获取该邮箱的最新一封邮件（默认收件，type=sent 查看发件）
export async function GET(request: Request) {
  const userId = await getUserId()
  const { searchParams } = new URL(request.url)
  const emailAddress = searchParams.get("email")
  const messageType = searchParams.get("type") // "sent" | undefined

  if (!emailAddress) {
    return NextResponse.json(
      { error: "email 参数不能为空" },
      { status: 400 }
    )
  }

  try {
    const db = createDb()

    // 找到当前用户的邮箱（忽略大小写）
    const email = await db.query.emails.findFirst({
      where: and(
        eq(emails.userId, userId!),
        eq(sql`LOWER(${emails.address})`, emailAddress.toLowerCase())
      ),
    })

    if (!email) {
      return NextResponse.json({ error: "邮箱不存在或无权限查看" }, { status: 403 })
    }

    // 发件需要权限
    if (messageType === "sent") {
      const permissionResult = await checkBasicSendPermission(userId!)
      if (!permissionResult.canSend) {
        return NextResponse.json(
          { error: permissionResult.error || "您没有查看发送邮件的权限" },
          { status: 403 }
        )
      }
    }

    const orderByTime =
      messageType === "sent" ? messages.sentAt : messages.receivedAt

    const conditions = [eq(messages.emailId, email.id)]
    if (messageType === "sent") {
      conditions.push(eq(messages.type, "sent"))
    }

    const latest = await db.query.messages.findFirst({
      where: and(...conditions),
      orderBy: [desc(orderByTime)],
    })

    if (!latest) {
      return NextResponse.json({ message: null })
    }

    return NextResponse.json({ message: latest })
  } catch (error) {
    console.error("Failed to fetch latest message by email:", error)
    return NextResponse.json(
      { error: "获取最新邮件失败" },
      { status: 500 }
    )
  }
}

