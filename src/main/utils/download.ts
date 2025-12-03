import { net } from 'electron'
import { promises as fs } from 'fs'

export async function downloadFile(url: string, filePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = net.request(url)

    request.setHeader(
      'accept',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
    )
    request.setHeader('accept-encoding', 'gzip, deflate, br, zstd')
    request.setHeader('accept-language', 'zh-CN,zh;q=0.9')
    request.setHeader('priority', 'u=0, i')
    request.setHeader(
      'sec-ch-ua',
      '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"'
    )
    request.setHeader('sec-ch-ua-mobile', '?0')
    request.setHeader('sec-ch-ua-platform', '"macOS"')
    request.setHeader('sec-fetch-dest', 'document')
    request.setHeader('sec-fetch-mode', 'navigate')
    request.setHeader('sec-fetch-site', 'none')
    request.setHeader('sec-fetch-user', '?1')
    request.setHeader('upgrade-insecure-requests', '1')
    request.setHeader(
      'user-agent',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'
    )

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: HTTP ${response.statusCode}`))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk) => {
        chunks.push(chunk)
      })

      response.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks)
          await fs.writeFile(filePath, buffer)
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      response.on('error', (err) => {
        reject(err)
      })
    })

    request.on('error', (err) => {
      reject(err)
    })

    request.end()
  })
}
