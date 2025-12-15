import { Lock } from "lucide-react"

export const runtime = "edge"

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  await params // 符合接口要求，但不需要使用 locale

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="text-center px-4 space-y-4">
        <div className="flex justify-center mb-4">
          <Lock className="h-16 w-16 text-gray-400 dark:text-gray-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          无法访问
        </h1>
        <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          本网站不对外公开，仅限授权用户访问。
        </p>
      </div>
    </div>
  )
}

