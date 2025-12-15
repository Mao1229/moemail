// 已弃用：请使用 /api/emails/latest?email=xxx 版本
export const runtime = "edge"

export async function GET() {
  return new Response("Use /api/emails/latest?email=... instead", {
    status: 410,
  })
}

