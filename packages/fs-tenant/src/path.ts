/**
 * 路径钉死的纯逻辑。
 *
 * 刻意与 cordis / 上游 FileSystem 解耦:安全逻辑必须能被独立、穷尽地测试。
 * 一段藏在服务方法里的路径校验,测试要先搭出整个运行时才碰得到 ——
 * 于是它就不会被穷尽地测。
 *
 * @module @dshwar/fs-tenant/path
 */
import { createHash } from 'node:crypto'
import { isAbsolute, normalize, resolve as resolvePath, sep } from 'node:path'
import type { Principal } from '@dshwar/principal'

/** 路径逃逸或非法标识符。 */
export class PathEscapeError extends Error {
  override readonly name = 'PathEscapeError'
  constructor(message: string) {
    super(message)
  }
}

/**
 * 可直接用作目录名的标识符形状。
 *
 * **白名单**,与 `@dshwar/principal` 的黑名单**刻意相反**:
 *
 * - principal 那层面对的是「什么样的 IdP subject 该被接受」,白名单会把
 *   `auth0|5f3c…`、SAML URN 这类合法标识挡在门外,导致用户根本登不进来。
 * - 这一层面对的是「什么样的字符串可以直接拼进文件系统路径」,那里**只有白名单
 *   是安全的** —— 黑名单永远漏:8.3 短名的 `~`、NTFS 数据流的 `:`、
 *   Windows 保留名 `CON`、尾部空格与点号(Windows 会静默去掉,于是
 *   `"acme "` 与 `"acme"` 指向同一个目录)。
 *
 * 两层用不同策略不是不一致,是各自面对不同的威胁。放不进白名单的标识符
 * 不会被拒绝,而是走 {@link encodeSegment} 编码 —— 见那里的说明。
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * 编码后段落的前缀标记。
 *
 * 它必须落在 {@link SAFE_SEGMENT} 之外,否则一个用户可以把自己的 id 起成
 * `_h_<别人的哈希>` 来占用别人的目录。`_` 开头正好不满足白名单的首字符要求,
 * 这个不变式由 `SAFE_SEGMENT` 的 `^[A-Za-z0-9]` 保证。
 */
const ENCODED_PREFIX = '_h_'

/**
 * Windows 保留设备名。即便在 Linux 上运行也要拦:工作区可能被挂到 SMB 共享,
 * 也可能被 rsync 到 Windows 机器上做备份,那时一个叫 `CON` 的目录会让整个
 * 备份链条炸掉,而排查时没人会想到是六个月前建的一个租户名。
 */
const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

/**
 * 把一个标识符编码成安全的目录名。
 *
 * 能原样使用的就原样使用 —— 运维在服务器上 `ls` 工作区根时,看到 `acme/`
 * 比看到 `_h_9f86d081884c7d65…` 有用得多,而这个可读性在排障时值回票价。
 *
 * 放不进白名单的(`auth0|5f3c…`、SAML URN、中文租户名、含 `~` 的 8.3 形状)
 * 一律走 SHA-256:
 *
 * - **不是拒绝**,因为这些 id 完全合法,拒绝等于把用户挡在门外
 * - **不是转义**(比如把 `|` 换成 `_`),因为转义会碰撞:`a|b` 与 `a_b`
 *   会映射到同一个目录,而那是跨用户的数据串通
 * - 哈希单射,且 `_h_` 前缀不可能被白名单段落伪造,两边互不侵犯
 *
 * @param value 原始标识符
 * @returns 可安全用作单个路径段的字符串
 */
export function encodeSegment(value: string): string {
  // NFC 归一化:`é` 有组合与预组合两种编码,不归一化会让同一个租户
  // 在不同客户端下落到两个目录。归一化后再判定白名单,判定才是稳定的。
  const normalized = value.normalize('NFC')

  if (
    SAFE_SEGMENT.test(normalized) &&
    !WINDOWS_RESERVED.has(normalized.toUpperCase()) &&
    // Windows 会静默去掉尾部的点与空格,于是 "acme." 与 "acme" 是同一个目录。
    // 白名单已排除空格,这里再挡住尾点。
    !normalized.endsWith('.')
  ) {
    return normalized
  }

  return ENCODED_PREFIX + createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32)
}

/** 参与路径拼接的标识符字段。三段**同级对待**,不因来源不同而放松校验。 */
export type PathField = 'tenantId' | 'userId' | 'workspaceId'

/**
 * 未指定工作区时落到的缺省工作区(R2)。
 *
 * ⚠️ **它不是特殊值。** `default` 走与任何其它 workspaceId 完全相同的校验与
 * 编码路径 —— 一旦给缺省值开一条旁路,那条旁路就是攻击面:调用方只要不传
 * workspaceId 就能绕过校验。这里的「缺省」只发生在**取值**阶段,不发生在
 * 校验阶段。
 */
export const DEFAULT_WORKSPACE_ID = 'default'

/**
 * 校验一个标识符可以参与路径拼接,并返回其编码后的路径段。
 *
 * @param value 原始标识符(`principal.tenantId` / `principal.id` / workspaceId)
 * @param field 用于报错的字段名
 * @returns 编码后的路径段
 * @throws {PathEscapeError} 值为空或仅含空白
 */
export function toPathSegment(value: string, field: PathField): string {
  if (value.length === 0) {
    // 空段落会让 {root}/{tenantId}/{userId}/{workspaceId} 塌陷少一层,
    // 而 path.resolve 会把 `//` 归一掉 —— 于是所有空段落的主体共享同一层目录。
    // 这正是「越过隔离」。四段路径下这个风险比三段时更大:塌陷的可能位置多了一处。
    throw new PathEscapeError(`${field} 不得为空 —— 空段落会让工作区根塌陷,等于越过隔离`)
  }
  // 仅含空白的段落同样危险:Windows 会把尾部空格静默去掉,`" "` 于是等价于空。
  // 白名单本身也排除空格,但先在这里拒绝能给出准确得多的错误信息。
  if (value.trim().length === 0) {
    throw new PathEscapeError(`${field} 不得仅含空白 —— Windows 会静默去掉它,等价于空段落`)
  }
  return encodeSegment(value)
}

/**
 * 计算某个主体在某个工作区下的根:`{root}/{tenantId}/{userId}/{workspaceId}`。
 *
 * ## 为什么是四段(V0.4.1)
 *
 * 工作台的核心体验是按项目分区干活。三段路径意味着用户把所有项目的文件混在
 * 一起。这个改动在 V0.1.0 **发布前**做成本为零,发布后就是破坏性变更 ——
 * 要升大版本、写迁移、维护双版本。
 *
 * ## 校验顺序是刻意的
 *
 * **先逐段校验,再拼接,再 resolve,最后断言仍在根内。** 不能用「拼接后再检查」
 * 替代「拼接前先校验」—— 两者拦的是不同的东西:
 *
 * - 拼接前:段落自身是否合法(空、空白、保留名、分隔符伪造)
 * - 拼接后:归一化之后是否还在根内(`..` 序列的净效果)
 *
 * 只做后者的话,一个叫 `..` 的 workspaceId 会先把路径抬高一层,再由后续段落
 * 补回来,最终 `isWithin` 通过 —— 但它落在了**别人的**用户目录下。
 *
 * @param root 全局工作区根(绝对路径)
 * @param principal 主体
 * @param workspaceId 工作区;省略时用 {@link DEFAULT_WORKSPACE_ID}
 * @returns 该主体在该工作区下的根,绝对路径
 * @throws {PathEscapeError} root 非绝对路径,或任一段为空 / 非法
 */
export function tenantWorkspaceRoot(
  root: string,
  principal: Principal,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): string {
  if (!isAbsolute(root)) {
    throw new PathEscapeError(`工作区根必须是绝对路径(收到 ${JSON.stringify(root)})`)
  }

  // ---- ① 逐段校验(拼接之前)----
  const tenant = toPathSegment(principal.tenantId, 'tenantId')
  const user = toPathSegment(principal.id, 'userId')
  const workspace = toPathSegment(workspaceId, 'workspaceId')

  // ---- ② 拼接 + resolve ----
  const pinned = resolvePath(root, tenant, user, workspace)

  // ---- ③ 断言仍在根内 ----
  // 编码后的段落理论上不可能含分隔符或 `..`,但这道断言不依赖那个理论:
  // 它直接检查最终结果。encodeSegment 哪天被改坏,这里先炸,而不是静默越权。
  if (!isWithin(resolvePath(root), pinned)) {
    throw new PathEscapeError(
      `工作区根拼接后逃出全局根(root ${JSON.stringify(root)},结果 ${JSON.stringify(pinned)})`,
    )
  }

  return pinned
}

/**
 * 该主体在**全部**工作区之上的用户根:`{root}/{tenantId}/{userId}`。
 *
 * 只用于「列出这个用户有哪些工作区」这类跨工作区的操作。
 * ⚠️ **不要拿它当读写的根** —— 那会让同一用户的两个工作区互相可见,
 * 而 V0.4.1 的隔离要求是它们之间也隔离。
 */
export function tenantUserRoot(root: string, principal: Principal): string {
  if (!isAbsolute(root)) {
    throw new PathEscapeError(`工作区根必须是绝对路径(收到 ${JSON.stringify(root)})`)
  }
  const tenant = toPathSegment(principal.tenantId, 'tenantId')
  const user = toPathSegment(principal.id, 'userId')
  return resolvePath(root, tenant, user)
}

/**
 * 判断 `candidate` 是否落在 `root` 之内(含 root 自身)。
 *
 * ⚠️ **两个参数都必须是已经 realpath 过的绝对路径。** 本函数只做字符串比较,
 * 不碰文件系统 —— 符号链接的解引用是调用方的责任。把它做成纯函数是刻意的:
 * 混进 I/O 之后,这段判定就没法穷尽测试了。
 *
 * 用 `startsWith(root + sep)` 而非 `startsWith(root)`:后者会让
 * `/data/acme-evil` 被判定为落在 `/data/acme` 之内。这是个经典的边界 off-by-one,
 * 而它的后果是跨租户读写。
 *
 * @param root 已 realpath 的根,绝对路径
 * @param candidate 已 realpath 的候选,绝对路径
 * @returns 是否被包含
 */
export function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = normalize(root)
  const normalizedCandidate = normalize(candidate)
  if (normalizedCandidate === normalizedRoot) return true

  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep
  return normalizedCandidate.startsWith(rootWithSep)
}

/**
 * 把一个调用方提供的相对路径钉进工作区根。
 *
 * 这是**字面层**的防线:拦掉 `../`、绝对路径、UNC、空字节这些一眼可见的逃逸。
 * 它**不足以**保证安全 —— 符号链接可以在字面层完全合法的路径上把你带到根外。
 * 因此调用方必须在 realpath 之后再用 {@link isWithin} 复查一次。
 *
 * **两道都要有。** 字面层拦掉绝大多数尝试并给出可读的错误;realpath 层
 * 兜住符号链接。少任何一道都有洞:只有字面层挡不住 symlink,
 * 只有 realpath 层则对不存在的路径无能为力(realpath 会失败)。
 *
 * @param workspaceRoot 该主体的工作区根,绝对路径
 * @param requestedPath 调用方提供的路径,相对于工作区根
 * @returns 钉死后的绝对路径(尚未 realpath)
 * @throws {PathEscapeError} 路径含空字节、是绝对路径 / UNC,或归一化后逃出根
 */
export function pinPath(workspaceRoot: string, requestedPath: string): string {
  if (requestedPath.includes('\u0000')) {
    throw new PathEscapeError('路径含空字节')
  }

  // 先做 NFC 归一化。不归一化的话,`..` 的某些 Unicode 变体在不同层
  // (Node / libc / NTFS)可能被不同地解读。
  const requested = requestedPath.normalize('NFC')

  // 绝对路径直接拒绝,不做「截掉开头的斜杠再拼」这种补救 ——
  // 补救会让 `/etc/passwd` 变成 `{root}/etc/passwd`,看起来安全了,
  // 实则掩盖了调用方的真实意图,让真正的 bug 更难发现。
  if (isAbsolute(requested)) {
    throw new PathEscapeError(`不接受绝对路径(收到 ${JSON.stringify(requestedPath)})`)
  }

  // Windows UNC 与盘符。isAbsolute 在 POSIX 上不认 `C:\` 与 `\\server\share`,
  // 而工作区可能被跨平台访问,所以显式拦。
  if (/^[A-Za-z]:/.test(requested) || requested.startsWith('\\\\') || requested.startsWith('//')) {
    throw new PathEscapeError(`不接受盘符或 UNC 路径(收到 ${JSON.stringify(requestedPath)})`)
  }

  const pinned = resolvePath(workspaceRoot, requested)

  if (!isWithin(workspaceRoot, pinned)) {
    throw new PathEscapeError(
      `路径逃出工作区根(请求 ${JSON.stringify(requestedPath)},归一化后为 ${JSON.stringify(pinned)})`,
    )
  }

  return pinned
}
