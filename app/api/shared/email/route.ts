import { NextResponse } from "next/server"
import { getSharedEmailByAddress } from "@/lib/shared-data"

export const runtime = "edge"

// 通过邮箱地址获取邮箱信息
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const emailAddress = searchParams.get('email')

  if (!emailAddress) {
    return NextResponse.json(
      { error: "Email parameter is required" },
      { status: 400 }
    )
  }

  try {
    const email = await getSharedEmailByAddress(emailAddress)

    if (!email) {
      return NextResponse.json(
        { error: "Email not found or not accessible" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      email: {
        id: email.id,
        address: email.address,
        createdAt: email.createdAt,
        expiresAt: email.expiresAt
      }
    })
  } catch (error) {
    console.error("Failed to fetch shared email by address:", error)
    return NextResponse.json(
      { error: "Failed to fetch shared email" },
      { status: 500 }
    )
  }
}

