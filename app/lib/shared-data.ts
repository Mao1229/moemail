import { createDb } from "@/lib/db"
import { emailShares, messageShares, messages, emails } from "@/lib/schema"
import { eq, desc, and, or, ne, isNull } from "drizzle-orm"
import { sql } from "drizzle-orm"

export interface SharedEmail {
  id: string
  address: string
  createdAt: Date
  expiresAt: Date
}

export interface SharedMessage {
  id: string
  from_address?: string
  to_address?: string
  subject: string
  content?: string
  html?: string
  received_at?: Date
  sent_at?: Date
  expiresAt?: Date
  emailAddress?: string
  emailExpiresAt?: Date
}

export async function getSharedEmail(token: string): Promise<SharedEmail | null> {
  const db = createDb()

  try {
    const share = await db.query.emailShares.findFirst({
      where: eq(emailShares.token, token),
      with: {
        email: true
      }
    })

    if (!share) {
      return null
    }

    // 检查分享是否过期
    if (share.expiresAt && share.expiresAt < new Date()) {
      return null
    }

    // 检查邮箱是否过期
    if (share.email.expiresAt < new Date()) {
      return null
    }

    return {
      id: share.email.id,
      address: share.email.address,
      createdAt: share.email.createdAt,
      expiresAt: share.email.expiresAt
    }
  } catch (error) {
    console.error("Failed to fetch shared email:", error)
    return null
  }
}

// 通过邮箱地址获取共享邮箱信息（允许所有有效且未过期的邮箱访问）
export async function getSharedEmailByAddress(emailAddress: string): Promise<SharedEmail | null> {
  const db = createDb()

  try {
    // 先查找邮箱（使用大小写不敏感查询）
    const email = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, emailAddress.toLowerCase())
    })

    if (!email) {
      console.log(`Email not found: ${emailAddress}`)
      return null
    }

    // 检查邮箱是否过期
    if (email.expiresAt < new Date()) {
      console.log(`Email expired: ${emailAddress}, expiresAt: ${email.expiresAt}`)
      return null
    }

    // 允许所有有效且未过期的邮箱通过地址访问
    return {
      id: email.id,
      address: email.address,
      createdAt: email.createdAt,
      expiresAt: email.expiresAt
    }
  } catch (error) {
    console.error("Failed to fetch shared email by address:", error)
    return null
  }
}

export interface SharedMessagesResult {
  messages: SharedMessage[]
  nextCursor: string | null
  total: number
}

export async function getSharedEmailMessages(token: string, limit = 20): Promise<SharedMessagesResult> {
  const db = createDb()

  try {
    const share = await db.query.emailShares.findFirst({
      where: eq(emailShares.token, token),
      with: {
        email: true
      }
    })

    if (!share) {
      return { messages: [], nextCursor: null, total: 0 }
    }

    // 检查分享是否过期
    if (share.expiresAt && share.expiresAt < new Date()) {
      return { messages: [], nextCursor: null, total: 0 }
    }

    return getEmailMessagesByEmailId(share.emailId, limit)
  } catch (error) {
    console.error("Failed to fetch shared email messages:", error)
    return { messages: [], nextCursor: null, total: 0 }
  }
}

// 通过邮箱ID获取邮件列表（内部函数，供两种方式共用）
async function getEmailMessagesByEmailId(emailId: string, limit = 20): Promise<SharedMessagesResult> {
  const db = createDb()

  try {
    // 只显示接收的邮件，不显示发送的邮件
    const baseConditions = and(
      eq(messages.emailId, emailId),
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

    // 获取邮箱的消息列表（多获取一条用于判断是否有更多）
    const messageList = await db.query.messages.findMany({
      where: baseConditions,
      orderBy: [desc(messages.receivedAt), desc(messages.id)],
      limit: limit + 1
    })

    const hasMore = messageList.length > limit
    const results = hasMore ? messageList.slice(0, limit) : messageList

    // 生成下一页的cursor
    let nextCursor: string | null = null
    if (hasMore) {
      const { encodeCursor } = await import("@/lib/cursor")
      const lastMessage = results[results.length - 1]
      nextCursor = encodeCursor(
        lastMessage.receivedAt.getTime(),
        lastMessage.id
      )
    }

    return {
      messages: results.map(msg => ({
        id: msg.id,
        from_address: msg.fromAddress ?? undefined,
        to_address: msg.toAddress ?? undefined,
        subject: msg.subject,
        received_at: msg.receivedAt,
        sent_at: msg.sentAt
      })),
      nextCursor,
      total: totalCount
    }
  } catch (error) {
    console.error("Failed to fetch email messages:", error)
    return { messages: [], nextCursor: null, total: 0 }
  }
}

// 通过邮箱地址获取邮件列表
export async function getSharedEmailMessagesByAddress(emailAddress: string, limit = 20): Promise<SharedMessagesResult> {
  const db = createDb()

  try {
    const email = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, emailAddress.toLowerCase())
    })

    if (!email) {
      return { messages: [], nextCursor: null, total: 0 }
    }

    // 检查邮箱是否过期
    if (email.expiresAt < new Date()) {
      return { messages: [], nextCursor: null, total: 0 }
    }

    // 允许所有有效且未过期的邮箱通过地址访问邮件列表
    return getEmailMessagesByEmailId(email.id, limit)
  } catch (error) {
    console.error("Failed to fetch shared email messages by address:", error)
    return { messages: [], nextCursor: null, total: 0 }
  }
}

export async function getSharedMessage(token: string): Promise<SharedMessage | null> {
  const db = createDb()

  try {
    const share = await db.query.messageShares.findFirst({
      where: eq(messageShares.token, token)
    })

    if (!share) {
      return null
    }

    // 检查分享是否过期
    if (share.expiresAt && share.expiresAt < new Date()) {
      return null
    }

    // 获取消息详情
    const message = await db.query.messages.findFirst({
      where: eq(messages.id, share.messageId)
    })

    if (!message) {
      return null
    }

    // 获取邮箱信息
    const email = await db.query.emails.findFirst({
      where: eq(emails.id, message.emailId)
    })

    return {
      id: message.id,
      from_address: message.fromAddress ?? undefined,
      to_address: message.toAddress ?? undefined,
      subject: message.subject,
      content: message.content ?? undefined,
      html: message.html ?? undefined,
      received_at: message.receivedAt,
      sent_at: message.sentAt,
      expiresAt: share.expiresAt ?? undefined,
      emailAddress: email?.address,
      emailExpiresAt: email?.expiresAt
    }
  } catch (error) {
    console.error("Failed to fetch shared message:", error)
    return null
  }
}
