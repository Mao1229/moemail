import { getSharedEmailByAddress, getSharedEmailMessagesByAddress } from "@/lib/shared-data"
import { SharedErrorPage } from "@/components/emails/shared-error-page"
import { SharedEmailPageClient } from "../[token]/page-client"
import { redirect } from "next/navigation"

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ email?: string }>
}

export default async function SharedEmailByAddressPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { email: emailAddress } = await searchParams

  if (!emailAddress) {
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

  // 服务端获取数据
  const email = await getSharedEmailByAddress(emailAddress)

  if (!email) {
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

  // 获取初始消息列表
  const messagesResult = await getSharedEmailMessagesByAddress(emailAddress)

  return (
    <SharedEmailPageClient
      email={email}
      initialMessages={messagesResult.messages}
      initialNextCursor={messagesResult.nextCursor}
      initialTotal={messagesResult.total}
      token=""
    />
  )
}

