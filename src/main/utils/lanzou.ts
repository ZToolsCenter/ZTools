import axios from 'axios'

let globalAcwCookie = ''

export async function getLanzouDownloadLink(url: string): Promise<string> {
  try {
    // 1. 请求初始链接
    const initialContent = await fetchContent(url)

    // 2. 查找 iframe src
    const iframeMatch = initialContent.match(/<iframe\s+class="ifr2"\s+name="\d+"\s+src="([^"]+)"/)
    if (!iframeMatch) {
      throw new Error('未找到 Iframe')
    }
    const iframeSrc = iframeMatch[1]
    const iframeUrl = new URL(iframeSrc, new URL(url).origin).toString()

    // 3. 请求 iframe 内容
    const iframeContent = await fetchContent(iframeUrl)

    // 4. 查找包含 $.ajax 的 script 标签内容
    let scriptContent = ''
    const scripts = iframeContent.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/g)
    if (scripts) {
      for (const script of scripts) {
        if (script.includes('$.ajax')) {
          // 移除 <script...> 和 </script> 标签
          scriptContent = script.replace(/<script[^>]*>|<\/script>/g, '')
          break
        }
      }
    }

    if (!scriptContent) {
      throw new Error('未找到脚本')
    }

    // 5. 模拟 $ 对象并执行脚本
    let downloadLink = ''

    const mockDollar = {
      ajax: async (obj: any) => {
        const origin = new URL(iframeUrl).origin
        const requestUrl = origin + obj.url

        // 将 data 对象转换为 URLSearchParams
        const formData = new URLSearchParams()
        for (const key in obj.data) {
          formData.append(key, obj.data[key])
        }

        const response = await axios.post(requestUrl, formData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: iframeUrl,
            Cookie: `codelen=1; pc_ad1=1${globalAcwCookie ? '; ' + globalAcwCookie : ''}`
          }
        })

        const jsonResponse = response.data

        if (jsonResponse.zt === 1) {
          downloadLink = jsonResponse.dom + '/file/' + jsonResponse.url
        } else {
          throw new Error(`获取下载链接失败，状态码: ${jsonResponse.zt}`)
        }
      }
    }

    // 我们需要在定义了 $ 的上下文中执行脚本。
    // 脚本内容包含 'var ...'，所以如果我们提供了 $，直接 eval 应该可以工作。
    // 因为脚本中的 ajax 调用是异步的（在我们的 mock 中），但脚本执行本身是同步的
    // （它只是调用 $.ajax），我们需要处理异步特性。
    // 然而，我们的 mock $.ajax 是异步的，但脚本并没有 await 它。
    // 我们可以让 mock $.ajax 返回一个 promise，如果我们能捕获它，就可以等待它。
    // 但是脚本只是调用 $.ajax({...})。

    // 实际上，脚本调用了 $.ajax。我们可以让模拟的 $.ajax 将 promise 赋值给一个变量
    // 以便在外部访问，这样我们就可以 await 它。

    let ajaxPromise: Promise<void> | null = null
    const mockDollarWithPromiseCapture = {
      ajax: (obj: any) => {
        ajaxPromise = mockDollar.ajax(obj)
      }
    }

    const runScript = new Function('$', scriptContent)
    runScript(mockDollarWithPromiseCapture)

    if (ajaxPromise) {
      await ajaxPromise
    } else {
      throw new Error('$.ajax 未被调用')
    }

    console.log('downloadLink', downloadLink)

    // 解析重定向
    // Axios 默认跟随重定向。我们使用 HEAD 请求来获取最终 URL，而不下载内容。
    const finalResponse = await axios.head(downloadLink, {
      maxRedirects: 1, // 一次重定向
      validateStatus: () => true, // 不验证状态码
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    })

    // 在 axios node 环境中，最终 url 可以在 `finalResponse.request.res.responseUrl` 中找到
    return finalResponse.request.res.responseUrl || downloadLink
  } catch (error) {
    console.error('解析蓝奏云链接出错:', error)
    throw error
  }
}

export async function getLanzouFolderFileList(url: string, password?: string): Promise<any> {
  try {
    const content = await fetchContent(url)

    // 查找包含 function file() 的 script 标签内容
    let scriptContent = ''
    const scripts = content.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/g)
    if (scripts) {
      for (const script of scripts) {
        if (script.includes('function file()') || script.includes('$.ajax')) {
          // 移除 <script...> 和 </script> 标签
          scriptContent = script.replace(/<script[^>]*>|<\/script>/g, '')
          break
        }
      }
    }

    if (!scriptContent) {
      throw new Error('未找到脚本')
    }

    let ajaxData: any = null
    let ajaxUrl = ''

    const mockDollar = {
      ajax: (config: any) => {
        ajaxData = config.data
        ajaxUrl = config.url
      },
      val: () => {},
      text: () => {},
      html: () => {},
      appendTo: () => {},
      hide: () => {},
      show: () => {},
      removeClass: () => {}
    }

    // 模拟 $ 函数
    const mockDollarFn = (): any => mockDollar
    Object.assign(mockDollarFn, mockDollar)

    const mockDocument = {
      getElementById: (id: string) => {
        if (id === 'pwd') return { value: password || '' }
        return { style: {}, innerHTML: '', value: '', addEventListener: () => {} }
      },
      title: ''
    }

    // 模拟 window
    const mockWindow = {}

    // 追加调用 file()
    const scriptToRun = scriptContent + '\nfile();'

    // 执行脚本
    const runScript = new Function('$', 'document', 'window', scriptToRun)
    runScript(mockDollarFn, mockDocument, mockWindow)

    if (!ajaxData || !ajaxUrl) {
      throw new Error('未捕获到 AJAX 请求')
    }

    // 发送实际请求
    const origin = new URL(url).origin
    const requestUrl = new URL(ajaxUrl, origin).toString()

    const formData = new URLSearchParams()
    for (const key in ajaxData) {
      formData.append(key, ajaxData[key])
    }

    const response = await axios.post(requestUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: url,
        Cookie: `codelen=1; pc_ad1=1${globalAcwCookie ? '; ' + globalAcwCookie : ''}`
      }
    })

    // console.log('文件夹列表响应:', response.data)

    // 检查响应状态
    if (response.data.zt === 1) {
      // 成功，转换并返回文件列表
      return response.data.text.map((file: any) => ({
        id: file.id,
        name_all: file.name_all,
        size: file.size,
        time: file.time
      }))
    } else if (response.data.zt === 3) {
      // 密码错误
      throw new Error('密码错误: ' + (response.data.info || ''))
    } else {
      // 其他错误
      throw new Error('获取文件列表失败: ' + (response.data.info || '未知错误'))
    }
  } catch (error) {
    console.error('获取文件夹列表失败:', error)
    throw error
  }
}

export function getGlobalAcwCookie(): string {
  return globalAcwCookie
}

async function fetchContent(url: string): Promise<string> {
  const headers: Record<string, string> = {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'Cache-Control': 'max-age=0',
    Cookie: `codelen=1; pc_ad1=1${globalAcwCookie ? '; ' + globalAcwCookie : ''}`,
    DNT: '1',
    Priority: 'u=0, i',
    'Sec-CH-UA': '"Chromium";v="140", "Not=A?Brand";v="24", "Microsoft Edge";v="140"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
  }

  const response = await axios.get(url, { headers })
  // console.log('fetchContent response:', response)

  // 检查反爬虫保护
  if (
    response.data &&
    typeof response.data === 'string' &&
    response.data.includes('document.location.reload()')
  ) {
    console.log('触发反爬虫保护，正在解密 Cookie...')
    try {
      const targetHost = new URL(url).host
      const cookieResult = getAcwCookie(response.data, targetHost)

      if (cookieResult.success && cookieResult.cookieHeader) {
        console.log('解密成功，正在使用 Cookie 重试:', cookieResult.cookieHeader)
        // 更新全局 Cookie
        globalAcwCookie = cookieResult.cookieHeader

        // 合并 Cookies
        // 如果有 Set-Cookie，从响应中提取（虽然如果使用 jar，axios 可能会自动处理，但这里我们手动处理）
        // 实际上，对于这种情况，我们只需要追加计算出的 Cookie
        const currentCookie = headers['Cookie'] || ''
        headers['Cookie'] = `${currentCookie}; ${cookieResult.cookieHeader}`
        console.log('合并后的 Cookies:', headers['Cookie'])

        // 重试请求
        const retryResponse = await axios.get(url, { headers })
        return retryResponse.data
      } else {
        console.error('Cookie 解密失败:', cookieResult.error)
      }
    } catch (e) {
      console.error('Cookie 解密过程中出错:', e)
    }
  }

  return response.data
}

interface CookieResult {
  success: boolean
  name?: string
  value?: string
  expires?: string
  domain?: string
  fullCookie?: string
  cookieHeader?: string
  error?: string
  rawCookie?: string
}

function getAcwCookie(htmlContent: string, targetHost: string): CookieResult {
  // 1. 提取JS代码
  const scriptMatch = htmlContent.match(/<script>([\s\S]*?)<\/script>/)
  if (!scriptMatch) {
    return { success: false, error: '未找到 Script 标签' }
  }

  let jsCode = scriptMatch[1]

  // 2. 创建最小化的浏览器环境模拟
  const mockEnv = {
    document: {
      cookie: ''
    },
    location: {
      host: targetHost,
      reload: function () {
        // 空实现，不需要真的刷新
      }
    },
    // Node.js原生支持的对象
    Date: Date,
    Math: Math,
    RegExp: RegExp,
    String: String,
    parseInt: parseInt,
    decodeURIComponent: decodeURIComponent,
    // atob的Node.js实现
    atob: function (str: string) {
      return Buffer.from(str, 'base64').toString('binary')
    }
  }

  // 3. 移除页面刷新代码
  jsCode = jsCode.replace('document.location.reload()', '')

  // 修复反爬虫检测：替换函数定义以匹配正则检查
  // 原代码中的正则检查非常严格，要求 function (){return 而不是 function () { return
  jsCode = jsCode.replace(/function \(\) \{ return/g, 'function (){return')

  // 4. 构造可执行的函数
  const functionBody = `
      const document = mockEnv.document;
      const location = mockEnv.location;
      const Date = mockEnv.Date;
      const Math = mockEnv.Math;
      const RegExp = mockEnv.RegExp;
      const String = mockEnv.String;
      const parseInt = mockEnv.parseInt;
      const decodeURIComponent = mockEnv.decodeURIComponent;
      const atob = mockEnv.atob;
      
      ${jsCode}
      
      return document.cookie;
  `

  try {
    // 5. 执行代码
    const executeCode = new Function('mockEnv', functionBody)
    const cookieString = executeCode(mockEnv)

    // 6. 解析Cookie
    const cookieMatch = cookieString.match(/acw_sc__v2=([^;]+)/)

    if (cookieMatch) {
      // 解析完整的cookie信息
      const expiresMatch = cookieString.match(/expires=([^;]+)/)
      const domainMatch = cookieString.match(/domain=([^;]+)/)

      return {
        success: true,
        name: 'acw_sc__v2',
        value: cookieMatch[1],
        expires: expiresMatch ? expiresMatch[1] : undefined,
        domain: domainMatch ? domainMatch[1] : undefined,
        fullCookie: cookieString,
        // 生成可直接用于HTTP请求的Cookie字符串
        cookieHeader: `acw_sc__v2=${cookieMatch[1]}`
      }
    } else {
      return {
        success: false,
        error: 'Cookie 生成失败',
        rawCookie: cookieString
      }
    }
  } catch (e: any) {
    return {
      success: false,
      error: `执行错误: ${e.message}`
    }
  }
}
