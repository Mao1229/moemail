import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"
import { eq, and, inArray } from "drizzle-orm"
import { getUserId } from "@/lib/apiKey"

export const runtime = "edge"

export async function POST(request: Request) {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      )
    }

    const db = createDb()

    // 先统计要删除的邮箱数量
    const userEmails = await db.query.emails.findMany({
      where: eq(emails.userId, userId),
      columns: { id: true }
    })

    if (userEmails.length === 0) {
      return NextResponse.json(
        { error: "没有可删除的邮箱" },
        { status: 400 }
      )
    }

    const emailIds = userEmails.map(e => e.id)
    const DELETE_BATCH_SIZE = 50

    // 先删除所有关联的消息
    try {
      // 分批删除消息，避免 SQLite 变量数量限制
      for (let i = 0; i < emailIds.length; i += DELETE_BATCH_SIZE) {
        const batch = emailIds.slice(i, i + DELETE_BATCH_SIZE)
        await db.delete(messages)
          .where(inArray(messages.emailId, batch))
      }
    } catch (error) {
      console.error('Failed to delete messages:', error)
      // 继续尝试删除邮箱，即使消息删除失败
    }

    // 再删除所有邮箱（分批删除）
    let deletedCount = 0
    
    try {
      for (let i = 0; i < emailIds.length; i += DELETE_BATCH_SIZE) {
        const batch = emailIds.slice(i, i + DELETE_BATCH_SIZE)
        await db.delete(emails)
          .where(
            and(
              eq(emails.userId, userId),
              inArray(emails.id, batch)
            )
          )
        deletedCount += batch.length
      }
    } catch (error) {
      console.error('Failed to delete emails:', error)
      return NextResponse.json(
        { error: "删除邮箱失败" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      deletedCount,
    })
  } catch (error) {
    console.error('Failed to delete all emails:', error)
    return NextResponse.json(
      { error: "全部删除失败" },
      { status: 500 }
    )
  }
}
