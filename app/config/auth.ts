/**
 * 认证相关配置
 * 登录路径使用随机字符串，避免被轻易猜到
 */

// 可以通过环境变量覆盖登录路径，默认为随机字符串
export const LOGIN_PATH = process.env.NEXT_PUBLIC_LOGIN_PATH || "auth-entry-7x9k2m"

/**
 * 获取登录页面的完整路径
 */
export function getLoginPath(locale: string): string {
  return `/${locale}/${LOGIN_PATH}`
}

/**
 * 获取登录路径（不含 locale）
 */
export function getLoginPathSegment(): string {
  return LOGIN_PATH
}

