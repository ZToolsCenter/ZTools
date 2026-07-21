import { open } from 'lmdb'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DOC_COUNT = Number(process.env.DOC_COUNT || 5000)
const DOC_PAYLOAD_BYTES = Number(process.env.DOC_PAYLOAD_BYTES || 512)
const MAP_SIZE = Number(process.env.MAP_SIZE || 2 * 1024 * 1024 * 1024)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-lmdb-memory-'))
const opened = []

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    global.gc?.()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function snapshot() {
  const usage = process.memoryUsage()
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  }
}

function print(label, current, baseline, previous) {
  const row = (key) => ({
    current: formatBytes(current[key]),
    fromStart: formatBytes(current[key] - baseline[key]),
    fromPrev: formatBytes(current[key] - previous[key])
  })
  console.log(`\n## ${label}`)
  console.table({
    rss: row('rss'),
    heapUsed: row('heapUsed'),
    heapTotal: row('heapTotal'),
    external: row('external'),
    arrayBuffers: row('arrayBuffers')
  })
}

function openZToolsLikeDb(name, mapSize = MAP_SIZE) {
  const dir = path.join(tempRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  const env = open({
    path: dir,
    mapSize,
    maxDbs: 6,
    compression: false,
    encoding: 'binary'
  })
  const dbs = {
    main: env.openDB({ name: 'main', encoding: 'string' }),
    meta: env.openDB({ name: 'meta', encoding: 'string' }),
    attachment: env.openDB({ name: 'attachment', encoding: 'binary' }),
    changelog: env.openDB({ name: 'changelog', encoding: 'string' }),
    revision: env.openDB({ name: 'revision', encoding: 'string' }),
    syncTask: env.openDB({ name: 'syncTask', encoding: 'string' })
  }
  const handle = { env, dbs, dir }
  opened.push(handle)
  return handle
}

function writeSmallDocs(handle, count, prefix) {
  const payload = 'x'.repeat(DOC_PAYLOAD_BYTES)
  for (let i = 0; i < count; i += 1) {
    const id = `PLUGIN/${prefix}/doc-${i}`
    const rev = `1-${prefix}-${i}`
    const doc = { _id: id, _rev: rev, payload, index: i }
    const now = Date.now()
    handle.dbs.main.putSync(id, JSON.stringify(doc))
    handle.dbs.meta.putSync(
      id,
      JSON.stringify({
        _rev: rev,
        _winningRev: rev,
        _lastModified: now,
        _cloudSynced: false,
        _deleted: false
      })
    )
    handle.dbs.revision.putSync(
      `rev:${id}:${rev}`,
      JSON.stringify({
        docId: id,
        rev,
        parentRev: null,
        deleted: false,
        timestamp: now,
        doc,
        isLeaf: true
      })
    )
    handle.dbs.changelog.putSync(
      String(i + 1).padStart(10, '0'),
      JSON.stringify({
        seq: i + 1,
        docId: id,
        rev,
        parentRev: null,
        deleted: false,
        timestamp: now
      })
    )
  }
}

async function measure() {
  console.log('LMDB memory measurement')
  console.log(`tempRoot=${tempRoot}`)
  console.log(`DOC_COUNT=${DOC_COUNT}`)
  console.log(`DOC_PAYLOAD_BYTES=${DOC_PAYLOAD_BYTES}`)
  console.log(`MAP_SIZE=${formatBytes(MAP_SIZE)}`)
  console.log(
    `gc=${typeof global.gc === 'function' ? 'enabled' : 'disabled; run with node --expose-gc for better signal'}`
  )

  await settle()
  const baseline = snapshot()
  let previous = baseline
  print('baseline', baseline, baseline, previous)

  const deviceDb = openZToolsLikeDb('device')
  await settle()
  let current = snapshot()
  print('open one empty ZTools-like LMDB env', current, baseline, previous)
  previous = current

  writeSmallDocs(deviceDb, DOC_COUNT, 'device')
  await settle()
  current = snapshot()
  print(`after writing ${DOC_COUNT} small docs into first env`, current, baseline, previous)
  previous = current

  const accountDb = openZToolsLikeDb('account')
  await settle()
  current = snapshot()
  print('open second empty ZTools-like LMDB env', current, baseline, previous)
  previous = current

  writeSmallDocs(accountDb, DOC_COUNT, 'account')
  await settle()
  current = snapshot()
  print(`after writing ${DOC_COUNT} small docs into second env`, current, baseline, previous)
  previous = current

  for (const handle of opened.reverse()) {
    handle.env.close()
  }
  await settle()
  current = snapshot()
  print('after closing envs', current, baseline, previous)
}

measure()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    for (const handle of opened) {
      try {
        handle.env.close()
      } catch {
        // ignore
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })
