import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { emails, messages } from "@/lib/schema"
import { eq, and, inArray } from "drizzle-orm"
import { getUserId } from "@/lib/apiKey"

export const runtime = "edge"

// 批量删除的最大数量限制
const MAX_BATCH_DELETE_SIZE = 100

export async function POST(request: Request) {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      )
    }

    const { emailIds } = await request.json() as { emailIds: string[] }

    // 验证请求参数
    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return NextResponse.json(
        { error: "邮箱ID列表不能为空" },
        { status: 400 }
      )
    }

    // 限制批量删除数量
    if (emailIds.length > MAX_BATCH_DELETE_SIZE) {
      return NextResponse.json(
        { error: `单次最多只能删除 ${MAX_BATCH_DELETE_SIZE} 个邮箱` },
        { status: 400 }
      )
    }

    // 去重
    const uniqueEmailIds = [...new Set(emailIds)]

    const db = createDb()

    // 验证这些邮箱是否都属于当前用户
    const userEmails = await db.query.emails.findMany({
      where: and(
        eq(emails.userId, userId),
        inArray(emails.id, uniqueEmailIds)
      ),
      columns: { id: true }
    })

    const userEmailIds = userEmails.map(e => e.id)
    const unauthorizedIds = uniqueEmailIds.filter(id => !userEmailIds.includes(id))

    // 如果有部分邮箱不属于当前用户，返回错误
    if (unauthorizedIds.length > 0) {
      return NextResponse.json(
        { error: "部分邮箱不存在或无权限删除" },
        { status: 403 }
      )
    }

    if (userEmailIds.length === 0) {
      return NextResponse.json(
        { error: "没有可删除的邮箱" },
        { status: 400 }
      )
    }

    // 分批删除，避免 SQLite 变量数量限制
    // SQLite IN 子句最多支持约 999 个变量，每批使用较小的数量更安全
    const DELETE_BATCH_SIZE = 50
    let deletedCount = 0
    const errors: string[] = []

    // 先删除关联的消息
    try {
      for (let i = 0; i < userEmailIds.length; i += DELETE_BATCH_SIZE) {
        const batch = userEmailIds.slice(i, i + DELETE_BATCH_SIZE)
        await db.delete(messages)
          .where(inArray(messages.emailId, batch))
      }
    } catch (error) {
      console.error('Failed to delete messages:', error)
      return NextResponse.json(
        { error: "删除关联消息失败" },
        { status: 500 }
      )
    }

    // 再删除邮箱
    try {
      for (let i = 0; i < userEmailIds.length; i += DELETE_BATCH_SIZE) {
        const batch = userEmailIds.slice(i, i + DELETE_BATCH_SIZE)
        await db.delete(emails)
          .where(inArray(emails.id, batch))
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
      failedCount: 0,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error) {
    console.error('Failed to batch delete emails:', error)
    return NextResponse.json(
      { error: "批量删除失败" },
      { status: 500 }
    )
  }
}

