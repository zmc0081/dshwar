#!/usr/bin/env node
/**
 * **advisory**:本地领先远端多少个提交 —— 超过阈值就说一声,**永不阻塞**。
 *
 * ## 它防的是什么:同一组检查,在两个时间点上跑
 *
 * 「本地与 CI 不是同一组检查」那条已经由「CI 只调 `check:all` 一个入口」解决了 ——
 * 两边**跑的东西**相同。而这一条是它的下一层:**同一组检查,在两个时间点上跑**。
 *
 * `check:all` 在本机跑的是**此刻**的工作区;CI 跑的是**上一次 push** 的快照。
 * 两者之间每积一个没推的提交,「本地全绿」离「CI 会绿」就远一步 ——
 * 而那段距离**不在任何输出里**。
 *
 * ⚠️ **实测,不是假设**:V0.9.0 Session 6 收尾时第一次推 CI,
 * `origin/main` 停在 **Session 1**,本地已经领先 **13 个提交**。
 * 那一推,五个 job 里四个红,而它们全都**不是新代码的问题** ——
 * 是 13 个提交里逐渐攒下的冷构建缺陷、步骤顺序、平台差异。
 *
 * 🚨 **关键在于每一次「这次先不推」当时都是成立的**:改到一半、正在跑门禁、
 * 想先把这个 Session 收完。没有哪一次是错的,而它们加起来是错的。
 * ⇒ 所以这不能靠「记得推」。它需要一个**会说话的东西**。
 *
 * ## 为什么是 advisory,不是阻塞
 *
 * 三种完全正当的状态都会让它非零,而阻塞会把它们全部拦死:
 *
 * | 状态 | 为什么正当 |
 * | --- | --- |
 * | 断网 / 在飞机上 | 推不了,而门禁与联网无关 |
 * | 刚 clone、还没有远端跟踪分支 | 什么都还没发生 |
 * | 故意攒着一批改动 | 那是人的决定,不是缺陷 |
 *
 * 🚨 而最要命的一条:**它想帮的那个人,正是此刻推不了的那个人。**
 * 一条在「推不了」时把门禁弄红的规则,只会教人学会绕过它。
 *
 * ⇒ 判据是「**说出来**」,不是「拦住」。退出码恒为 0,
 * 而负向验证钉的正是这一点:构造落后 5 个提交,确认它**打印**且**退出码不变**。
 *
 * ## ⚠️ 不联网:比的是本地那份 `origin/main` 引用
 *
 * 不 `git fetch`。两条理由:
 *
 * 1. 门禁里发网络请求会挂,而挂住比红更难查(见 CLAUDE.md 那条「负向验证的
 *    预期结果不只有红,还有挂住」);
 * 2. **本地的远端跟踪引用由你自己的 push 更新** —— 而这里要量的正是
 *    「我推了没有」。别人推了什么与这个数无关。
 *
 * 代价:很久没 fetch 时这个数会**偏大**(别人的提交也算进"远端落后")。
 * 偏大的 advisory 只是多说一句,不会说错方向。
 *
 * 跑法:`node scripts/check-unpushed.mjs`(已进 `check:all`,排在最前)
 *
 * @module scripts/check-unpushed
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 攒到几个就说一声。
 *
 * 3 的理由:一次正常的会话通常是「改几处 → 提交一两次 → 推」;
 * 到第四个还没推,说明这个循环断了。
 * 定得更大(比如 10)就等于默许攒着 —— 而 13 那次正是这么攒出来的。
 */
const THRESHOLD = 3

/** 在指定目录跑一条 git,失败返回 undefined(而不是抛)。 */
function git(/** @type {string[]} */ args, /** @type {string} */ cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

// 从 cwd 找仓库根,取不到就退回本脚本所在的仓库 ——
// 这样它既能在子目录里跑,也能被负向验证指到一个临时仓库上。
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = git(['rev-parse', '--show-toplevel'], process.cwd()) ?? here

console.log('DSHWAR · 未推送提交(advisory,不阻塞)')

const head = git(['rev-parse', 'HEAD'], repo)
if (head === undefined) {
  // ⚠️ 说出来而不是静默返回:一个什么都没查却安静通过的检查,
  //   与一个查过并通过的检查在输出上一模一样。
  console.log('  跳过  这里不是一个 git 仓库(或没有提交)—— 无从比较')
  process.exit(0)
}

/**
 * 拿哪个引用当"远端"。
 *
 * 优先当前分支的上游(`@{upstream}`),没有就退到 `origin/main` ——
 * 后者是本仓的主干(CLAUDE.md 第六节:`main` 始终是主干)。
 */
const upstream =
  git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo) ??
  (git(['rev-parse', '--verify', '--quiet', 'origin/main'], repo) === undefined
    ? undefined
    : 'origin/main')

if (upstream === undefined) {
  console.log('  跳过  没有远端跟踪分支 —— 还没 push 过,或者这是个本地仓库')
  process.exit(0)
}

const countText = git(['rev-list', '--count', `${upstream}..HEAD`], repo)
const count = countText === undefined ? undefined : Number.parseInt(countText, 10)

if (count === undefined || Number.isNaN(count)) {
  console.log(`  跳过  数不出与 ${upstream} 的差距(引用不存在?)`)
  process.exit(0)
}

if (count <= THRESHOLD) {
  console.log(`  通过  领先 ${upstream} ${count} 个提交(阈值 ${THRESHOLD})`)
  process.exit(0)
}

// 最早那个没推的提交是多久之前的 —— 「13 个提交」不如「13 个提交,最早的在 6 天前」。
const oldest = git(['log', '--format=%cr', `${upstream}..HEAD`], repo)
  ?.split('\n')
  .pop()

console.log('')
console.log(`  ⚠️  领先 ${upstream} ${count} 个提交,还没推。`)
if (oldest !== undefined && oldest !== '') {
  console.log(`      最早的那个:${oldest}`)
}
console.log('')
console.log('     为什么说这句话:本机的 check:all 跑的是**此刻**的工作区,')
console.log('     而 CI 跑的是**上一次 push** 的快照。每积一个没推的提交,')
console.log('     「本地全绿」离「CI 会绿」就远一步,而那段距离不在任何输出里。')
console.log('')
console.log('     V0.9.0 Session 6 实测:攒到 13 个提交才推,五个 job 里四个红,')
console.log('     而它们全都不是新代码的问题 —— 是这 13 个提交里攒下的')
console.log('     冷构建缺陷、步骤顺序、平台差异。')
console.log('')
console.log('     ⚠️ 每一次「这次先不推」当时都成立;它们加起来才是错的。')
console.log('')
console.log('  这条**不阻塞**(推不了的时候不该被门禁拦住)—— 退出码仍是 0。')

process.exit(0)
