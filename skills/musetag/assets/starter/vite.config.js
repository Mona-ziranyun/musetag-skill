import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "node:fs";

const taxonomy = JSON.parse(readFileSync(new URL("./src/taxonomy.json", import.meta.url), "utf8"));

const allowedTags = taxonomy.groups.flatMap((group) => group.tags);
const taxonomyPrompt = taxonomy.groups
  .map((group) => `${group.label}：${group.tags.join("、")}`)
  .join("\n");

function readJsonBody(request, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error("图片过大"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("请求格式无效"));
      }
    });
    request.on("error", reject);
  });
}

function outputText(response) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function aiTagPlugin({ apiKey, model }) {
  return {
    name: "musetag-ai-tags",
    configureServer(server) {
      server.middlewares.use("/api/suggest-tags", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: "仅支持 POST" }));
          return;
        }
        if (!apiKey) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "尚未配置 OPENAI_API_KEY" }));
          return;
        }

        try {
          const { imageDataUrl, existingTags = [] } = await readJsonBody(request);
          if (!/^data:image\/(jpeg|png|webp);base64,/.test(imageDataUrl || "")) {
            throw new Error("只支持 JPG、PNG、WebP 图片");
          }

          const apiResponse = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              store: false,
              reasoning: { effort: "none" },
              input: [{
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: [
                      "你是设计素材库的编目助手。分析图片后推荐 5 至 8 个最有助于以后找回素材的中文标签。",
                      "只能从下面的受控标签库选择，禁止发明新词、近义词、品牌名、人物身份或无法从画面确认的信息。",
                      "优先覆盖主体、媒介、构图、色彩与风格；用途标签只有在画面明显适用时选择。",
                      `用户素材库里已使用过的标签：${existingTags.filter((tag) => allowedTags.includes(tag)).join("、") || "暂无"}`,
                      taxonomyPrompt,
                    ].join("\n"),
                  },
                  { type: "input_image", image_url: imageDataUrl, detail: "low" },
                ],
              }],
              text: {
                verbosity: "low",
                format: {
                  type: "json_schema",
                  name: "controlled_tag_suggestions",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      tags: {
                        type: "array",
                        minItems: 5,
                        maxItems: 8,
                        items: { type: "string", enum: allowedTags },
                      },
                    },
                    required: ["tags"],
                    additionalProperties: false,
                  },
                },
              },
            }),
          });

          const payload = await apiResponse.json();
          if (!apiResponse.ok) throw new Error(payload?.error?.message || "AI 识图失败");
          const parsed = JSON.parse(outputText(payload));
          const tags = [...new Set((parsed.tags || []).filter((tag) => allowedTags.includes(tag)))].slice(0, 8);
          if (tags.length < 5) throw new Error("AI 返回的有效标签不足 5 个");
          response.end(JSON.stringify({ tags, model }));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: error.message || "AI 识图失败" }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [aiTagPlugin({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || "gpt-5.6-luna",
    })],
  };
});
