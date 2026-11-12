# 项目踩坑与审查约定

> 本文件是项目自己的踩坑位：**踩过一次就记一条**，写「现象 → 根因 → 下次怎么做」。
> 上限 200 行 / 12,288 字节，超了先合并同类项再精简。通用治理规则不写在这里（那些在 `AGENTS.md` 与 `docs/sop/`）。

## 审查交付约定

当用户要求审查本项目、评估方案或给出审查意见时，审查者必须一次性交付完整结果，不得只列问题后停下。每次审查至少包括：

1. 明确的审查结论与是否建议通过；
2. 按优先级排序的问题、证据、影响和具体修订建议；
3. 对待拍板事项给出倾向、理由及主要风险，不把建议写成用户已决定；
4. 一份可直接转送开发者/智能体执行的完整提示词（目标、范围、约束、验收标准、交付要求）。

## 本项目踩坑

| 坑 | 现象 | 根因 | 下次怎么做 |
|---|---|---|---|
| 2026-11-03 口令未触发 Skill | 用户说「你是主开发者」，直接开工读计划，未调用 `main-developer-orchestrator-local-zh`，被用户反问 | 把口令当成普通自然语言理解，未把「口令→必须调 Skill」当强制路由 | 见到 `你是主开发者`／`锁定手机 xx`／`阶段复盘` 等口令，先查 available_skills 并调用，再动工 建议进用户级 |
| 2026-11-03 CodeArts 单任务输出被截断 | 退出码 0，但日志「思考内容较长，已达到模型输出长度上限」，目标文件未生成 | 单任务粒度过大（一次写十几个文件），超出模型单次输出上限 | 按文件组拆成 2–3 个串行任务；验收查目标文件存在与内容，不只看 exit code 建议进用户级 |
| 2026-11-03 注入坐标点击在 WebView / DocumentsUI 无效 | 浏览器 WebView 内点按钮无反应；系统文件选择器列表项也不吃 `input tap` | 小米浏览器 WebView 与 Android 11 DocumentsUI 不响应注入坐标点击 | 页面内操作走 WebView CDP（`/proc/net/unix` → `adb forward` → eval/click）；文件选择用 `KEYCODE_DPAD_DOWN` 聚焦 + `KEYCODE_ENTER` 确认，不盲点 建议进用户级 |
| 2026-11-03 导航与坐标误操作打开无关界面 | `KEYCODE_MENU` 弹出最近任务（可能含他人隐私）；盲点坐标误开支付宝等 App | 把 MENU 当返回；坐标随滚动/文件夹变化且连点太快 | 只用 `KEYCODE_BACK`/`HOME` 或 CDP 导航；每次操作前 dump 当前页与 mCurrentFocus、按最新 bounds 点，点后核对焦点 建议进用户级 |
| 2026-11-03 E2E 用例与实现不稳 | 单弹层设计下多弹层用例红；新 UI 后「第一个某 class」取到错误段落 | 用例假设与设计契约不符；选择器依赖位置 | 判缺陷前先对 UX 契约；断言改用语义化稳定 class（`.privacy-text`、`.export-download-hint`），新 UI 先给专用 class |
| 2026-11-03 账本硬失败 APP-BASELINE-MISSING | 文档看似齐备，`check-ledger.mjs` 仍 exit 1 | 校验器要求品牌/导航关键词与「关键：是」写法，文档只写了普通标记 | 收工前先跑 `node scripts/model/check-ledger.mjs docs/model`，按校验器实际规则补齐再报完工 建议进用户级 |
| 2026-11-03 误用 Chrome 做 Android 真机验收 | 用户明确要求手机端 PWA 测试与验收第一优先级用手机自带浏览器；我用 `am start -a VIEW` 让 Chrome 接管了链接 | 未指定 component，系统默认把 https 交给 Chrome | 一律显式组件启动自带浏览器（红米/小米：`am start -n com.android.browser/.BrowserActivity -a android.intent.action.VIEW -d <url>`）；先 `am force-stop com.android.chrome`；开屏广告等倒计时结束再截图 建议进用户级 |
| 2026-11-03 预览进程消失与 curl 000 | nohup 起的 preview 在沙箱内退出；`curl` 本地端口返回 000 | 沙箱回收后台子进程；shell 继承 `ALL_PROXY`，本地请求被送进代理 | 用 `run_in_background` 启预览；本地探测加 `curl --noproxy '*'` 建议进用户级 |
| 2026-11-03 iOS14 Safari 无法程序化驱动 | 想用 iPhone7/iOS14.7.1 自动开页点按验收，`webinspector launch`、`dvt launch <url>`、`apps pull` 均无法注入 URL 或点击 | iOS14 Safari「Web 检查器」默认关闭，`webinspector` 依赖它；无开发者签名装不了 WDA/XCUITest；CoreDevice 通道仅支持 iOS17+ | 老 iOS 真机 `developer dvt launch <bundleId>` 只能启动 App、带不了 URL；全自动验收改用 iOS 模拟器（`simctl openurl`/`io screenshot` + XCUITest 无签名）；真机需用户先开 Web 检查器 建议进用户级 |
| 2026-11-03 小米浏览器导出/选文件有坑 | 导出无 toast/无文件，Downloads 为空；PWA 独立窗口点「从文件恢复」无系统弹层 | 浏览器对 blob 下载弹「保存文件」需二次确认；PWA 窗口未实现文件选择 | 判导出失败前先 dump 看是否有「保存文件」对话框并在 UI 写明；导入改在同一 origin 的浏览器标签页完成 建议进用户级 |
| 2026-11-03 PWA 缺 manifest 链接 | manifest.webmanifest 存在且 200，但浏览器不认可安装、装桌面只得快捷方式 | index.html 从未 `<link rel="manifest">`，build 校验只查文件存在 | 构建期断言 index.html 链接 manifest 与 apple-touch-icon；评审 PWA 时先验 link 再验文件 建议进用户级 |
| 2026-11-03 小米浏览器/PWA 交付核对缺失 | 夜间模式强制覆盖页面主题；桌面快捷方式名漏 `.pwa` | 未区分浏览器自身覆盖与产品主题；未核对 manifest `short_name` 后缀 | 判主题缺陷前先查浏览器强制主题；PWA 交付前核对 `short_name` 以 `.pwa` 结尾并在 build 加断言 建议进用户级 |
| 2026-11-03 单点修复却顺手跑全量 | 用户要求只修「添加到桌面」，我又把添加/历史/离线/导出跑了一遍，被当场斥责 | 把「继续推进开发」当成重跑全量 AC 的许可，没区分修复验证与完整回归 | 用户点名一个修复点时，只验该修复点＋必要回归；新设备/新版本不等于重跑全量 建议进用户级 |
| 2026-11-03 HANDOFF 状态过期 | HANDOFF 写「未 push、线上 V1.3 未发布」，实际 origin/main 与线上已是 V1.3 | 接手时只读文档没核对 git/origin/live，也没注意文档记录时间 | 接手先只读核对 `git log origin/main`＋线上资源；文档状态与实际冲突时以实测为准并写回，但 push 仍须用户明确指令 |
| 2026-11-03 设置弹层切语言标题不刷新 | 弹层内容变英文，标题仍「设置/关闭」 | 弹层标题在 openSheet 时生成，语言切换只重建内容 | 判 i18n 缺陷前先关闭重开确认；修复时同步重建 sheet 头部 建议进用户级 |
| 2026-11-05 MIUI 安装与桌面图标缓存需真机配合 | 锁屏/熄屏时 `adb install` 被拒（INSTALL_FAILED_USER_RESTRICTED）；换图标后应用信息页已更新、桌面仍旧图 | MIUI 在屏幕未解锁时自动取消 USB 安装；桌面缓存图标且不响应 PACKAGE_CHANGED 广播 | 安装前 `KEYCODE_WAKEUP` + `wm dismiss-keyguard`，必要时 `svc power stayon usb`（装完恢复）；换图标后告知重启手机刷新 建议进用户级 |
| 2026-11-05 Android 15 内容压到系统栏 | Note 12T Pro 上标题与 Tab 被状态栏/手势区压住，顶部弹层也顶到状态栏 | targetSdk 36 强制 edge-to-edge，WebView 未提供 env()，Capacitor 注入的是 `--safe-area-inset-*` | CSS 统一用 `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`；固定顶/底元素逐个过真机安全区检查 建议进用户级 |
| 2026-11-05 系统字体缩放让布局比设计大 17% | 13px 计算样式 15.08px，一屏卡片数比预估少 2 条，用户两次打回布局 | 手机 font_scale=1.17，WebView 跟随缩放；按 CSS px 估算密度会失真 | 真机量 boundingBox 与可见条数，不按设计稿推算；布局按放大后的字号调 建议进用户级 |
| 2026-11-05 Capacitor Share 取消被当失败 | 用户取消系统分享时弹出「导出失败」 | SharePlugin 在 resultCode 非 OK 时 reject('Share canceled') | 捕获含 cancel 的报错当作用户取消，不提示失败也不弹「已导出」；只有真正异常才报错 |
| 2026-11-05 旧 PWA 数据不能自动进 APK | 包壳后 App 列表为空，旧 PWA 的 Carwash 不在 | PWA 与 Capacitor 壳是不同 origin（wanghoufan.github.io vs localhost），IndexedDB 不共享 | 迁移只能从旧 PWA 导出 JSON 再在 App 导入；不要承诺「装上就有数据」 建议进用户级 |
| 2026-11-12 先出包后提交导致 dirty 构建 | 版本登记写入的构建 commit 是 `df95527…-dirty`，该包无法从任何 commit 重建 | 改动未提交就执行 `assembleRelease`，工作区脏，登记脚本如实标 `-dirty` | 顺序固定为「bump + 改动本地提交 → 出包 → 登记」；登记出现 `-dirty` 时该包不得当作可复现版本分发，需提交后 bump 再出包 建议进用户级 |
| 2026-11-12 真机验收被前台占用打断 | `am start` 后前台变成微信朋友圈／fragmentplayer，三项验收未取到 | 上一步用 BACK 退出本应用会落回下层应用，且未先确认手机是否有人在用 | 取证只用 `am start` + `dumpsys activity activities \| grep topResumedActivity`，不用 BACK 退出；前台一变先查任务栈再停手报告，不抢 建议进用户级 |
