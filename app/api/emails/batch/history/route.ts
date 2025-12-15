import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { batchTasks } from "@/lib/schema"
import { eq, desc, sql } from "drizzle-orm"
import { getUserId } from "@/lib/apiKey"

export const runtime = "edge"

export async function GET(request: Request) {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "20")
    const offset = parseInt(searchParams.get("offset") || "0")

    const db = createDb()

    // 获取批次历史列表
    const history = await db.query.batchTasks.findMany({
      where: eq(batchTasks.userId, userId),
      orderBy: [desc(batchTasks.createdAt)],
      limit: Math.min(limit, 100), // 最多 100 条
      offset: offset,
    })

    // 获取总数
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(batchTasks)
      .where(eq(batchTasks.userId, userId))
    const total = Number(totalResult[0]?.count || 0)

    return NextResponse.json({
      history: history.map(task => ({
        id: task.id,
        domain: task.domain,
        totalCount: task.totalCount,
        createdCount: task.createdCount,
        status: task.status,
        error: task.error,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to fetch batch history:', error)
    return NextResponse.json(
      { error: "获取批次历史失败" },
      { status: 500 }
    )
  }
}

