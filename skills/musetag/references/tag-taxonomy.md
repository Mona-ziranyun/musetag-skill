# 受控标签体系

## 为什么不是让 AI 自由写词

自由生成会迅速产生近义词、粒度不一致和偶发专有名词，最终降低检索质量。MuseTag 使用“小而稳定”的受控词表：AI 只能选择已有词，用户只做删除、少量补选和确认。

## 分类框架

词表按个人设计素材的复用方式组织：

| 维度 | 回答的问题 | 示例 |
| --- | --- | --- |
| 用途 | 我以后拿它做什么 | 封面参考、排版参考、拍摄参考 |
| 媒介 | 它是什么类型的作品 | 摄影、插画、品牌视觉、UI界面 |
| 主体 | 画面主要是什么 | 人物、产品、建筑、文字 |
| 场景 | 内容发生在哪里 | 工作空间、咖啡馆、街头、棚拍 |
| 构图 | 画面如何组织 | 居中构图、特写、留白、强透视 |
| 版式 | 文字与图形如何排布 | 网格排版、大字标题、图文混排 |
| 色彩 | 主色彩关系是什么 | 暖色、低饱和、撞色、渐变 |
| 光线 | 光如何塑造画面 | 自然光、侧光、柔光、低调 |
| 风格 | 视觉语言是什么 | 极简、复古、编辑感、未来感 |
| 氛围 | 给人的感受是什么 | 克制、温暖、安静、力量感 |

## 行业依据

这不是任何单一机构词表的复制品，而是将成熟的视觉编目方法裁剪成个人素材库可用的中文词表：

- [Getty Art & Architecture Thesaurus](https://www.getty.edu/research/tools/vocabularies/aat/)：参考其层级化、首选词和可扩展概念结构。
- [Library of Congress Thesaurus for Graphic Materials](https://www.loc.gov/pictures/collection/tgm/fields.html)：参考其将视觉材料按主题与体裁／形式分开索引的方式。
- [IPTC Photo Metadata Standard](https://iptc.org/standards/photo-metadata/iptc-standard/)：参考其主题、体裁与受控词表字段的互操作思路。
- [Adobe Lightroom Classic Keywords](https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/keywords.html)：参考层级关键词、同义词、关键词集与最近关键词工作流。
- [Adobe Stock metadata guidance](https://helpx.adobe.com/stock/contributor/content-policies-guidelines/metadata/tips-effective-titles-keywords.html)：参考相关性优先，以及主体、动作、场景和概念的描述顺序。
- [Behance Creative Fields](https://help.behance.net/hc/en-us/articles/204483944-Guide-Creative-Fields)：参考设计领域分类对发现和浏览的作用。

## 维护规则

1. 新标签必须解决真实检索问题，不能只因为某一张图“看起来像”。
2. 同义词进入映射表而不是成为两个正式标签；UI 只展示首选词。
3. 维度内粒度保持一致，避免“人物”和某个具体人物姓名并列。
4. 至少在 30 张真实素材上验证：同类能聚合、组合筛选能缩小结果、两周后仍看得懂。
5. 每次词表变更递增 `taxonomy.json` 的版本，并记录重命名或合并关系。

## AI 输出约束

- 使用结构化输出，`tags` 数组的每个值都由 JSON Schema `enum` 限制。
- 服务端收到结果后再次过滤、去重，并截断到 8 个。
- 少于 5 个有效标签视为失败，提示重试，避免模型用无效词凑数。
- 推荐顺序按检索价值排序，而不是按画面位置排序。
- 不推测人物身份、品牌、地点或用途；不能从画面确认时不选。
