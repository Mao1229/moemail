import { getSharedEmail, getSharedEmailMessages, getSharedEmailByAddress, getSharedEmailMessagesByAddress } from "@/lib/shared-data"
import { SharedErrorPage } from "@/components/emails/shared-error-page"
import { SharedEmailPageClient } from "@/components/emails/shared-email-page-client"

interface PageProps {
  params: Promise<{
    token: string
    locale: string
  }>
  searchParams: Promise<{ email?: string }>
}

export default async function SharedEmailPage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { email: emailAddress } = await searchParams

  let email = null
  let messagesResult = null
  let accessToken: string | null = null

  // 如果提供了 email 查询参数，优先使用邮箱地址方式访问
  if (emailAddress) {
    email = await getSharedEmailByAddress(emailAddress)
    if (email) {
      messagesResult = await getSharedEmailMessagesByAddress(emailAddress)
      accessToken = null // 通过邮箱地址访问时，token 为 null
    }
  }

  // 如果没有通过邮箱地址获取到数据，或者没有提供 email 参数，则使用 token 方式
  if (!email) {
    email = await getSharedEmail(token)
    if (email) {
      messagesResult = await getSharedEmailMessages(token)
      accessToken = token
    }
  }

  if (!email || !messagesResult) {
    return (
      <SharedErrorPage
        titleKey="emailNotFound"
        subtitleKey="linkExpired"
        errorKey="linkInvalid"
        descriptionKey="linkInvalidDescription"
        ctaTextKey="createOwnEmail"
      />
    )
  }

  return (
    <SharedEmailPageClient
      email={email}
      initialMessages={messagesResult.messages}
      initialNextCursor={messagesResult.nextCursor}
      initialTotal={messagesResult.total}
      token={accessToken || ""}
    />
  )
}
