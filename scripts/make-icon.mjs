#!/usr/bin/env node
/**
 * 生成**中性**的应用图标源图(1024×1024 PNG),交给 `cargo tauri icon` 展开成各平台尺寸。
 *
 * ## 为什么是生成的,不是一张设计稿
 *
 * 白牌走**运行期主题**:安装包永远中性,一个二进制服务所有租户
 * (V0.7.0 已定决策)。图标是安装包的一部分,而它**没有运行期** ——
 * 装出来是什么样就一直是什么样。
 *
 * ⇒ 那它就不能带任何租户的品牌色。把这件事交给一张美术稿,意味着
 * 「中性」由人每次记得;交给一段代码,意味着它由**判据**保证:
 * 这里用的两个颜色都来自中性令牌,一个品牌色都没有。
 *
 * ⚠️ **不要在这里读租户配置**。图标要变成品牌色的那一天,变的是
 * 「谁来打包」,不是「打包脚本读了什么」—— 白牌客户自己签名、自己出包
 * (CLAUDE.md 第八节),那时他们换掉这张源图。
 *
 * ## 为什么手写 PNG 而不是引一个画图库
 *
 * 打包链路上多一个依赖,就多一份要跟着平台走的东西 —— 而这条链路
 * 正在解决的问题就是「原生依赖分平台」。PNG 的最小合法编码只要
 * `zlib`(Node 自带):IHDR + IDAT + IEND 三块,没有第三方代码。
 *
 * 跑法:`node scripts/make-icon.mjs`(产物 `src-tauri/icons/source.png`)
 *
 * @module scripts/make-icon
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(REPO, 'src-tauri', 'icons', 'source.png')

const SIZE = 1024

/**
 * 两个颜色都取自中性令牌(`styles/neutral.css`),**不含任何品牌色**。
 *
 * - 底:n-950 附近的深色,暗浅两种系统托盘上都看得清
 * - 记号:n-100 附近的浅色
 */
const BACKGROUND = [11, 13, 16, 255]
const MARK = [230, 232, 235, 255]

/** 记号:一个居中的圆环 + 一个缺口 —— 几何形,不是字母,于是不挑语言。 */
const RING_OUTER = SIZE * 0.34
const RING_INNER = SIZE * 0.22
/** 缺口的半角(弧度)。开口朝右下,让它在小尺寸下仍然「不是一个实心圆」。 */
const GAP_HALF = 0.42

/** @param {number} x @param {number} y */
function colorAt(x, y) {
  const dx = x - SIZE / 2
  const dy = y - SIZE / 2
  const r = Math.hypot(dx, dy)
  if (r > RING_OUTER || r < RING_INNER) return BACKGROUND
  // atan2 的 0 在右侧,正方向向下(因为 y 轴向下)—— 缺口开在 45°。
  const angle = Math.atan2(dy, dx)
  const delta = Math.abs(((angle - Math.PI / 4 + Math.PI) % (2 * Math.PI)) - Math.PI)
  return delta < GAP_HALF ? BACKGROUND : MARK
}

/** PNG 的每行前面要有一个 filter 字节;这里一律用 0(None)。 */
function rawPixels() {
  const row = SIZE * 4 + 1
  const raw = Buffer.alloc(row * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    const base = y * row
    raw[base] = 0
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = colorAt(x, y)
      const at = base + 1 + x * 4
      raw[at] = r ?? 0
      raw[at + 1] = g ?? 0
      raw[at + 2] = b ?? 0
      raw[at + 3] = a ?? 255
    }
  }
  return raw
}

/** CRC-32(PNG 每个 chunk 都要)。表按需现算,不抄一份常量表。 */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
// 10/11/12 = compression / filter / interlace,全 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(rawPixels(), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`已生成 ${OUT}  (${SIZE}×${SIZE}, ${String(png.length)} 字节)`)
console.log('展开成各平台尺寸:cargo tauri icon src-tauri/icons/source.png')
