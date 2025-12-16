import { MS_SETTINGS_URIS } from './msSettingsUris'

export interface SystemSetting {
  name: string
  uri: string
  category: string
  icon?: string
}

// 合并所有系统设置并统一添加图标
const allSettings: Omit<SystemSetting, 'icon'>[] = [
  // === ms-settings URI（来自微软官方文档和 SS64）===
  ...MS_SETTINGS_URIS,

  // === 控制面板和系统工具（非 ms-settings）===
  // 控制面板（16项）
  {
    name: '编辑用户环境变量',
    uri: 'rundll32 sysdm.cpl,EditEnvironmentVariables',
    category: '系统'
  },
  {
    name: '编辑系统环境变量',
    uri: 'SystemPropertiesAdvanced.exe',
    category: '系统'
  },
  {
    name: '系统属性',
    uri: 'SystemPropertiesAdvanced.exe',
    category: '系统'
  },
  {
    name: '计算机名',
    uri: 'SystemPropertiesComputerName.exe',
    category: '系统'
  },
  {
    name: '系统保护',
    uri: 'SystemPropertiesProtection.exe',
    category: '系统'
  },
  {
    name: '远程设置',
    uri: 'SystemPropertiesRemote.exe',
    category: '系统'
  },
  {
    name: '程序和功能',
    uri: 'appwiz.cpl',
    category: '应用'
  },
  {
    name: '控制面板',
    uri: 'control.exe',
    category: '系统'
  },
  {
    name: '鼠标属性',
    uri: 'main.cpl',
    category: '设备'
  },
  {
    name: '网络连接',
    uri: 'ncpa.cpl',
    category: '网络'
  },
  {
    name: '电源选项',
    uri: 'powercfg.cpl',
    category: '系统'
  },
  {
    name: '防火墙',
    uri: 'firewall.cpl',
    category: '安全'
  },
  {
    name: '用户账户',
    uri: 'netplwiz.exe',
    category: '账户'
  },
  {
    name: '日期和时间',
    uri: 'timedate.cpl',
    category: '时间'
  },

  // 管理工具（12项）
  {
    name: '设备管理器',
    uri: 'devmgmt.msc',
    category: '管理'
  },
  {
    name: '磁盘管理',
    uri: 'diskmgmt.msc',
    category: '管理'
  },
  {
    name: '计算机管理',
    uri: 'compmgmt.msc',
    category: '管理'
  },
  {
    name: '服务',
    uri: 'services.msc',
    category: '管理'
  },
  {
    name: '任务管理器',
    uri: 'taskmgr.exe',
    category: '系统'
  },
  {
    name: '注册表编辑器',
    uri: 'regedit.exe',
    category: '系统'
  },
  {
    name: '事件查看器',
    uri: 'eventvwr.msc',
    category: '管理'
  },
  {
    name: '任务计划程序',
    uri: 'taskschd.msc',
    category: '管理'
  },
  {
    name: '性能监视器',
    uri: 'perfmon.msc',
    category: '管理'
  },
  {
    name: '资源监视器',
    uri: 'resmon.exe',
    category: '系统'
  },
  {
    name: '组策略编辑器',
    uri: 'gpedit.msc',
    category: '管理'
  },
  {
    name: '本地安全策略',
    uri: 'secpol.msc',
    category: '安全'
  },

  // 常用系统工具（15项）
  {
    name: '命令提示符',
    uri: 'cmd.exe',
    category: '系统'
  },
  {
    name: 'PowerShell',
    uri: 'powershell.exe',
    category: '系统'
  },
  {
    name: 'Windows Terminal',
    uri: 'wt.exe',
    category: '系统'
  },
  {
    name: '记事本',
    uri: 'notepad.exe',
    category: '应用'
  },
  {
    name: '计算器',
    uri: 'calc.exe',
    category: '应用'
  },
  {
    name: '画图',
    uri: 'mspaint.exe',
    category: '应用'
  },
  {
    name: '截图工具',
    uri: 'snippingtool.exe',
    category: '应用'
  },
  {
    name: '放大镜工具',
    uri: 'magnify.exe',
    category: '辅助'
  },
  {
    name: '字符映射表',
    uri: 'charmap.exe',
    category: '应用'
  },
  {
    name: '远程桌面连接',
    uri: 'mstsc.exe',
    category: '系统'
  },
  {
    name: '系统配置',
    uri: 'msconfig.exe',
    category: '系统'
  },
  {
    name: '磁盘清理',
    uri: 'cleanmgr.exe',
    category: '系统'
  },
  {
    name: '磁盘碎片整理',
    uri: 'dfrgui.exe',
    category: '系统'
  },
  {
    name: '系统信息工具',
    uri: 'msinfo32.exe',
    category: '系统'
  },
  {
    name: '步骤记录器',
    uri: 'psr.exe',
    category: '系统'
  },

  // 高级功能（10项）
  {
    name: '键盘属性',
    uri: 'control.exe keyboard',
    category: '设备'
  },
  {
    name: '声音属性',
    uri: 'mmsys.cpl',
    category: '系统'
  },
  {
    name: '添加打印机',
    uri: 'printui.exe',
    category: '设备'
  },
  {
    name: '系统还原',
    uri: 'rstrui.exe',
    category: '系统'
  },
  {
    name: 'DirectX 诊断工具',
    uri: 'dxdiag.exe',
    category: '系统'
  },
  {
    name: '程序兼容性助手',
    uri: 'msdt.exe -id PCWDiagnostic',
    category: '系统'
  },
  {
    name: '内存诊断工具',
    uri: 'MdSched.exe',
    category: '系统'
  },
  {
    name: 'Windows 功能',
    uri: 'optionalfeatures.exe',
    category: '系统'
  },
  {
    name: '打开运行',
    uri: 'rundll32 shell32.dll,#61',
    category: '系统'
  },
  {
    name: '关于 Windows',
    uri: 'winver.exe',
    category: '系统'
  }
]

// 导出系统设置（图标由前端统一渲染）
export const WINDOWS_SETTINGS: SystemSetting[] = allSettings
