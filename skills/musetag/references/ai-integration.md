# AI 看图集成

## 默认实现

模板通过 Vite 本地服务代理 OpenAI Responses API。浏览器只请求 `/api/suggest-tags`，因此 `OPENAI_API_KEY` 不进入前端代码、浏览器存储或备份。

默认模型为 `gpt-5.6-luna`，原因是它支持图片输入、Responses API 与结构化输出，适合高频、成本敏感的图片分类。允许用户通过 `OPENAI_MODEL` 覆盖，但更换模型后必须重新验证图像输入与 JSON Schema 支持。

## 请求约束

- 图片使用低细节模式完成标签分类，除非用户明确需要识别细小文字。
- 设置 `store: false`。
- JSON Schema 把标签值限定为 `taxonomy.json` 中的枚举，并要求 5～8 个唯一值。
- 提示中区分内容事实与个人用途；用途没有足够视觉证据时不选。
- 把库中已经使用的规范标签作为偏好提示，但不能越过词表边界。

## 隐私文案

界面和 README 必须说明：原图库保存在浏览器本地；AI 分析时，当前图片会发送到配置的 OpenAI API。不要把 `store: false` 描述成“图片从不离开电脑”或“绝对不会留存”。数据处理边界以 [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) 为准。

## 参考文档

- [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
