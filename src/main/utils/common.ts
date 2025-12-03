/**
 * 睡眠指定毫秒数
 * @param ms 毫秒数
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
