/**
 * 判断进程启动参数是否携带命令行唤起标记。
 *
 * @param argv 进程启动参数列表（通常为 process.argv）。
 * @returns 参数列表中存在 --ztools-wake 时返回 true。
 */
export function isZToolsCliWake(argv: string[]): boolean {
  return argv.includes('--ztools-wake')
}
