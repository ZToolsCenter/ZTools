import { app } from 'electron'
import path from 'path'

export function getAppBundlePath(...segments: string[]): string {
  return path.join(app.getAppPath(), ...segments)
}

export function getPreloadPath(fileName = 'index.js'): string {
  return getAppBundlePath('out', 'preload', fileName)
}

export function getRendererPath(fileName: string): string {
  return getAppBundlePath('out', 'renderer', fileName)
}
