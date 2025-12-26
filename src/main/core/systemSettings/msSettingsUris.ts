import type { SystemSetting } from './windowsSettings'

/**
 * 完整的 ms-settings URI 列表
 * 来源：
 * - https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings
 * - https://ss64.com/nt/syntax-settings.html
 */
export const MS_SETTINGS_URIS: Omit<SystemSetting, 'icon'>[] = [
  // === 主页 ===
  {
    name: '设置主页',
    uri: 'ms-settings:',
    category: '系统'
  },

  // === 系统（System）===
  {
    name: '屏幕显示',
    uri: 'ms-settings:display',
    category: '系统'
  },
  {
    name: '高级屏幕设置',
    uri: 'ms-settings:display-advanced',
    category: '系统'
  },
  {
    name: '显卡性能偏好',
    uri: 'ms-settings:display-advancedgraphics',
    category: '系统'
  },
  {
    name: '默认显卡设置',
    uri: 'ms-settings:display-advancedgraphics-default',
    category: '系统'
  },
  {
    name: '夜间护眼模式',
    uri: 'ms-settings:nightlight',
    category: '系统'
  },
  {
    name: '音频声音',
    uri: 'ms-settings:sound',
    category: '系统'
  },
  {
    name: '音频设备管理',
    uri: 'ms-settings:sound-devices',
    category: '系统'
  },
  {
    name: '麦克风输入属性',
    uri: 'ms-settings:sound-defaultinputproperties',
    category: '系统'
  },
  {
    name: '扬声器输出属性',
    uri: 'ms-settings:sound-defaultoutputproperties',
    category: '系统'
  },
  {
    name: '应用音量控制',
    uri: 'ms-settings:apps-volume',
    category: '系统'
  },
  {
    name: '系统通知',
    uri: 'ms-settings:notifications',
    category: '系统'
  },
  {
    name: '勿扰模式',
    uri: 'ms-settings:quiethours',
    category: '系统'
  },
  {
    name: '电源睡眠',
    uri: 'ms-settings:powersleep',
    category: '系统'
  },
  {
    name: '电池节能',
    uri: 'ms-settings:batterysaver',
    category: '系统'
  },
  {
    name: '电池节能配置',
    uri: 'ms-settings:batterysaver-settings',
    category: '系统'
  },
  {
    name: '电池用量详情',
    uri: 'ms-settings:batterysaver-usagedetails',
    category: '系统'
  },
  {
    name: '节能建议',
    uri: 'ms-settings:energyrecommendations',
    category: '系统'
  },
  {
    name: '磁盘存储',
    uri: 'ms-settings:storagesense',
    category: '系统'
  },
  {
    name: '存储感知自动清理',
    uri: 'ms-settings:storagepolicies',
    category: '系统'
  },
  {
    name: '清理存储建议',
    uri: 'ms-settings:storagerecommendations',
    category: '系统'
  },
  {
    name: '磁盘卷管理',
    uri: 'ms-settings:disksandvolumes',
    category: '系统'
  },
  {
    name: '文件默认保存位置',
    uri: 'ms-settings:savelocations',
    category: '系统'
  },
  {
    name: '窗口多任务',
    uri: 'ms-settings:multitasking',
    category: '系统'
  },
  {
    name: '无线投影接收',
    uri: 'ms-settings:project',
    category: '系统'
  },
  {
    name: '跨设备共享',
    uri: 'ms-settings:crossdevice',
    category: '系统'
  },
  {
    name: '任务栏设置',
    uri: 'ms-settings:taskbar',
    category: '系统'
  },
  {
    name: '剪贴板历史',
    uri: 'ms-settings:clipboard',
    category: '系统'
  },
  {
    name: '远程桌面连接',
    uri: 'ms-settings:remotedesktop',
    category: '系统'
  },
  {
    name: 'BitLocker 设备加密',
    uri: 'ms-settings:deviceencryption',
    category: '系统'
  },
  {
    name: '系统信息',
    uri: 'ms-settings:about',
    category: '系统'
  },

  // === 设备（Devices）===
  {
    name: '蓝牙设备',
    uri: 'ms-settings:bluetooth',
    category: '设备'
  },
  {
    name: '已连接设备',
    uri: 'ms-settings:connecteddevices',
    category: '设备'
  },
  {
    name: '设备自动发现',
    uri: 'ms-settings-connectabledevices:devicediscovery',
    category: '设备'
  },
  {
    name: '打印机扫描仪',
    uri: 'ms-settings:printers',
    category: '设备'
  },
  {
    name: '鼠标触摸板',
    uri: 'ms-settings:mousetouchpad',
    category: '设备'
  },
  {
    name: '笔记本触摸板',
    uri: 'ms-settings:devices-touchpad',
    category: '设备'
  },
  {
    name: 'USB 设备',
    uri: 'ms-settings:usb',
    category: '设备'
  },
  {
    name: '摄像头',
    uri: 'ms-settings:camera',
    category: '设备'
  },

  // === 网络和Internet（Network）===
  {
    name: '网络和互联网',
    uri: 'ms-settings:network',
    category: '网络'
  },
  {
    name: '网络连接状态',
    uri: 'ms-settings:network-status',
    category: '网络'
  },
  {
    name: 'Wi-Fi 无线网络',
    uri: 'ms-settings:network-wifi',
    category: '网络'
  },
  {
    name: 'Wi-Fi 高级设置',
    uri: 'ms-settings:network-wifisettings',
    category: '网络'
  },
  {
    name: '以太网有线网络',
    uri: 'ms-settings:network-ethernet',
    category: '网络'
  },
  {
    name: 'VPN 虚拟专用网',
    uri: 'ms-settings:network-vpn',
    category: '网络'
  },
  {
    name: '网络代理',
    uri: 'ms-settings:network-proxy',
    category: '网络'
  },
  {
    name: '飞行模式开关',
    uri: 'ms-settings:network-airplanemode',
    category: '网络'
  },
  {
    name: '移动热点共享',
    uri: 'ms-settings:network-mobilehotspot',
    category: '网络'
  },
  {
    name: '流量使用统计',
    uri: 'ms-settings:datausage',
    category: '网络'
  },

  // === 个性化（Personalization）===
  {
    name: '个性化设置',
    uri: 'ms-settings:personalization',
    category: '个性化'
  },
  {
    name: '桌面背景壁纸',
    uri: 'ms-settings:personalization-background',
    category: '个性化'
  },
  {
    name: '主题颜色',
    uri: 'ms-settings:personalization-colors',
    category: '个性化'
  },
  {
    name: '锁屏界面',
    uri: 'ms-settings:lockscreen',
    category: '个性化'
  },
  {
    name: '主题包',
    uri: 'ms-settings:themes',
    category: '个性化'
  },
  {
    name: '系统字体',
    uri: 'ms-settings:fonts',
    category: '个性化'
  },
  {
    name: '开始菜单布局',
    uri: 'ms-settings:personalization-start',
    category: '个性化'
  },
  {
    name: '快速控制中心',
    uri: 'ms-settings:controlcenter',
    category: '个性化'
  },

  // === 应用（Apps）===
  {
    name: '已安装应用',
    uri: 'ms-settings:appsfeatures',
    category: '应用'
  },
  {
    name: '默认程序',
    uri: 'ms-settings:defaultapps',
    category: '应用'
  },
  {
    name: '开机自启动',
    uri: 'ms-settings:startupapps',
    category: '应用'
  },
  {
    name: 'Windows 可选功能',
    uri: 'ms-settings:optionalfeatures',
    category: '应用'
  },

  // === 账户（Accounts）===
  {
    name: '账户信息',
    uri: 'ms-settings:yourinfo',
    category: '账户'
  },
  {
    name: '邮箱账户',
    uri: 'ms-settings:emailandaccounts',
    category: '账户'
  },
  {
    name: '登录方式',
    uri: 'ms-settings:signinoptions',
    category: '账户'
  },
  {
    name: '家庭其他用户',
    uri: 'ms-settings:otherusers',
    category: '账户'
  },
  {
    name: '账户同步',
    uri: 'ms-settings:sync',
    category: '账户'
  },

  // === 时间和语言（Time & Language）===
  {
    name: '日期时间',
    uri: 'ms-settings:dateandtime',
    category: '时间'
  },
  {
    name: '语言区域',
    uri: 'ms-settings:regionlanguage',
    category: '语言'
  },
  {
    name: '区域格式化',
    uri: 'ms-settings:regionformatting',
    category: '语言'
  },
  {
    name: '键盘布局',
    uri: 'ms-settings:keyboard',
    category: '语言'
  },
  {
    name: '高级键盘',
    uri: 'ms-settings:keyboard-advanced',
    category: '语言'
  },
  {
    name: '打字输入',
    uri: 'ms-settings:typing',
    category: '语言'
  },
  {
    name: '语音识别',
    uri: 'ms-settings:speech',
    category: '语言'
  },

  // === 隐私和安全（Privacy）===
  {
    name: '隐私设置',
    uri: 'ms-settings:privacy',
    category: '隐私'
  },
  {
    name: '隐私常规设置',
    uri: 'ms-settings:privacy-general',
    category: '隐私'
  },
  {
    name: '位置定位权限',
    uri: 'ms-settings:privacy-location',
    category: '隐私'
  },
  {
    name: '相机摄像头权限',
    uri: 'ms-settings:privacy-webcam',
    category: '隐私'
  },
  {
    name: '麦克风录音权限',
    uri: 'ms-settings:privacy-microphone',
    category: '隐私'
  },

  // === 更新和安全（Update & Security）===
  {
    name: '系统更新',
    uri: 'ms-settings:windowsupdate',
    category: '更新'
  },
  {
    name: '立即检查更新',
    uri: 'ms-settings:windowsupdate-action',
    category: '更新'
  },
  {
    name: '更新活动时间',
    uri: 'ms-settings:windowsupdate-activehours',
    category: '更新'
  },
  {
    name: '更新历史',
    uri: 'ms-settings:windowsupdate-history',
    category: '更新'
  },
  {
    name: '可选更新补丁',
    uri: 'ms-settings:windowsupdate-optionalupdates',
    category: '更新'
  },
  {
    name: '更新高级选项',
    uri: 'ms-settings:windowsupdate-options',
    category: '更新'
  },
  {
    name: '更新重启计划',
    uri: 'ms-settings:windowsupdate-restartoptions',
    category: '更新'
  },
  {
    name: '按需更新搜索',
    uri: 'ms-settings:windowsupdate-seekerondemand',
    category: '更新'
  },
  {
    name: '更新传递优化',
    uri: 'ms-settings:delivery-optimization',
    category: '更新'
  },
  {
    name: 'Defender 安全中心',
    uri: 'ms-settings:windowsdefender',
    category: '安全'
  },
  {
    name: '系统疑难解答',
    uri: 'ms-settings:troubleshoot',
    category: '系统'
  },
  {
    name: '系统恢复重置',
    uri: 'ms-settings:recovery',
    category: '系统'
  },
  {
    name: 'Windows 激活',
    uri: 'ms-settings:activation',
    category: '系统'
  },
  {
    name: '查找设备定位',
    uri: 'ms-settings:findmydevice',
    category: '安全'
  },
  {
    name: '开发者模式',
    uri: 'ms-settings:developers',
    category: '系统'
  },

  // === 搜索（Search）===
  {
    name: '搜索索引',
    uri: 'ms-settings:search',
    category: '搜索'
  },
  {
    name: '搜索权限设置',
    uri: 'ms-settings:search-permissions',
    category: '搜索'
  },
  {
    name: '搜索详细设置',
    uri: 'ms-settings:search-moredetails',
    category: '搜索'
  }
]
