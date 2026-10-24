# 测试用角色卡素材

现成的社区角色卡，用于 v0.6 角色卡功能的单测（`tests/character-cards.test.mjs`）和实测。**暂存**在仓库里，不随插件发布（插件包的 `files` 不包含本目录）。

| 文件 | 角色 | 格式 | 来源 | 许可 |
|---|---|---|---|---|
| `tangtuantuan.v2.json` | 唐团团（面包店老板娘，日常治愈） | V2 JSON | [foreverse-app/character-card-skills](https://github.com/foreverse-app/character-card-skills) `cards/zh/tangtuantuan` | CC BY 4.0 |
| `songzhixia.v2.json` | 宋知夏（毒舌学姐，校园） | V2 JSON | 同上 `cards/zh/songzhixia` | CC BY 4.0 |
| `peiyu.v2.json` | 裴聿（古风刑侦） | V2 JSON | 同上 `cards/zh/peiyu` | CC BY 4.0 |
| `wangushi.v2.json` | 晚孤市（世界卡 / 模拟器） | V2 JSON | 同上 `cards/zh/wangushi` | CC BY 4.0 |
| `frankie-doyle.v2.json` | Frankie Doyle（英文，cozy） | V2 JSON | 同上 `cards/en/frankie-doyle` | CC BY 4.0 |
| `seraphina.png` | Seraphina（SillyTavern 默认角色） | PNG（`chara` V2 + `ccv3` V3 两个块，带 4 条世界书） | [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern) `default/content/default_Seraphina.png` | AGPL-3.0（随 SillyTavern 分发） |

取用版本：character-card-skills `dab0da4`，SillyTavern `06bde93`（2026-10-18）。内容未改动。

署名：Foreverse 的卡片 © Foreverse (foreverse.app)，CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。Seraphina © SillyTavern contributors。

这些卡的特点正好覆盖了编译要处理的情况：

- `first_mes` 里有 HTML 卡片样式，编译时会转成纯文本；
- `system_prompt` 很长；
- 世界书里既有 `constant` 常驻条目，也有关键词条目；
- `post_history_instructions` 都是空的，所以会走默认的每轮提醒模板；
- 有中文卡和英文卡，有 JSON 也有 PNG。
