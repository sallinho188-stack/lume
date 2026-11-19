import { createServerFn } from "@tanstack/react-start";
import { blockedReason } from "./guard";

const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
const VIDEO_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

type ImageRatio = (typeof IMAGE_RATIOS)[number];
type VideoRatio = (typeof VIDEO_RATIOS)[number];

function apiKey() {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
  return key;
}

function extractError(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const message = (record.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof record.message === "string") return record.message;
  return "";
}

function humanize(message: string, status: number): string {
  const lower = message.toLowerCase();
  if (
    /content policy|moderation|safety|violat|not allowed|disallowed|prohibited|refused/.test(
      lower,
    )
  ) {
    return "Este pedido não passou na revisão do modelo. Mude a cena e tente de novo.";
  }
  if (status === 429) return "O estúdio está no limite agora. Espere um instante e tente de novo.";
  if (status === 401 || status === 403) return "A criação não está disponível neste ambiente.";
  const clean = message.replace(/\s+/g, " ").trim();
  if (clean && clean.length < 280) return clean;
  return `Não deu para criar agora (${status}).`;
}

async function xai(path: string, init?: RequestInit): Promise<
  | { ok: true; body: unknown }
  | { ok: false; error: string }
> {
  const key = apiKey();
  if (!key) return { ok: false, error: "A criação não está disponível neste ambiente." };

  let res: Response;
  try {
    res = await fetch(`https://api.x.ai/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
    });
  } catch {
    return { ok: false, error: "Sem conexão com o estúdio. Tente de novo." };
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 280) };
    }
  }
  if (!res.ok) return { ok: false, error: humanize(extractError(body), res.status) };
  return { ok: true, body };
}

function imageUrlFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.url === "string") return record.url;
  const data = record.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const url = (data[0] as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }
  const image = record.image;
  if (image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string") {
    return (image as { url: string }).url;
  }
  return null;
}

function asPrompt(value: unknown, max = 4000): string {
  if (typeof value !== "string") throw new Error("Escreva o que você quer ver.");
  const prompt = value.trim();
  if (prompt.length < 2) throw new Error("Escreva o que você quer ver.");
  if (prompt.length > max) throw new Error("O pedido passou de 4000 caracteres.");
  return prompt;
}

function asImageRef(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Imagem inválida.");
  if (value.startsWith("data:image/")) {
    if (value.length > 7_000_000) throw new Error("Imagem grande demais. Use um arquivo menor.");
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("Imagem inválida.");
    return value;
  } catch {
    throw new Error("Imagem inválida.");
  }
}

export const studioReady = createServerFn({ method: "GET" }).handler(async () => {
  return { ready: Boolean(process.env.XAI_API_KEY) };
});

export const directPrompt = createServerFn({ method: "POST" })
  .validator((input: { prompt: string; mode: "image" | "video" }) => {
    const prompt = asPrompt(input?.prompt);
    if (input?.mode !== "image" && input?.mode !== "video") throw new Error("Modo inválido.");
    return { prompt, mode: input.mode };
  })
  .handler(async ({ data }) => {
    const blocked = blockedReason(data.prompt);
    if (blocked) return { ok: false as const, error: blocked };

    const result = await xai("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 420,
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content:
              "You are the picture director for LUME, a studio. Rewrite the user's request as one visual prompt for an image or video model. Preserve their intent, subjects, mood, wardrobe, and any adult details they stated. Do not soften, lecture, or add a disclaimer. Do not invent real people. Write the prompt in English, as prose, nothing else. If the request sexualizes anyone under 18, reply with exactly RECUSADO.",
          },
          {
            role: "user",
            content: `Mode: ${data.mode}\nRequest: ${data.prompt}`,
          },
        ],
      }),
    });
    if (!result.ok) return result;

    const content = (
      result.body as { choices?: { message?: { content?: string } }[] }
    ).choices?.[0]?.message?.content?.trim();
    if (!content) return { ok: false as const, error: "O diretor não devolveu um pedido." };
    if (content.toUpperCase().includes("RECUSADO")) {
      return { ok: false as const, error: "Não gero conteúdo sexual envolvendo menores." };
    }
    const prompt = content.replace(/^["“]|["”]$/g, "").trim();
    return { ok: true as const, prompt };
  });

export const generateImage = createServerFn({ method: "POST" })
  .validator(
    (input: { prompt: string; aspect: ImageRatio; resolution: "1k" | "2k" }) => {
      const prompt = asPrompt(input?.prompt);
      if (!IMAGE_RATIOS.includes(input?.aspect)) throw new Error("Proporção inválida.");
      if (input?.resolution !== "1k" && input?.resolution !== "2k") {
        throw new Error("Resolução inválida.");
      }
      return { prompt, aspect: input.aspect, resolution: input.resolution };
    },
  )
  .handler(async ({ data }) => {
    const blocked = blockedReason(data.prompt);
    if (blocked) return { ok: false as const, error: blocked };

    const result = await xai("/images/generations", {
      method: "POST",
      body: JSON.stringify({
        model: "grok-imagine-image-2.0",
        prompt: data.prompt,
        n: 1,
        aspect_ratio: data.aspect,
        resolution: data.resolution,
        response_format: "url",
      }),
    });
    if (!result.ok) return result;
    const url = imageUrlFrom(result.body);
    if (!url) return { ok: false as const, error: "A imagem veio sem endereço." };
    return { ok: true as const, url };
  });

export const editImage = createServerFn({ method: "POST" })
  .validator(
    (input: {
      prompt: string;
      image: string;
      aspect: ImageRatio;
      resolution: "1k" | "2k";
    }) => {
      const prompt = asPrompt(input?.prompt);
      const image = asImageRef(input?.image);
      if (!image) throw new Error("Falta a imagem para editar.");
      if (!IMAGE_RATIOS.includes(input?.aspect)) throw new Error("Proporção inválida.");
      if (input?.resolution !== "1k" && input?.resolution !== "2k") {
        throw new Error("Resolução inválida.");
      }
      return { prompt, image, aspect: input.aspect, resolution: input.resolution };
    },
  )
  .handler(async ({ data }) => {
    const blocked = blockedReason(data.prompt);
    if (blocked) return { ok: false as const, error: blocked };

    const result = await xai("/images/edits", {
      method: "POST",
      body: JSON.stringify({
        model: "grok-imagine-image-2.0",
        prompt: data.prompt,
        image: { url: data.image, type: "image_url" },
        aspect_ratio: data.aspect,
        resolution: data.resolution,
      }),
    });
    if (!result.ok) return result;
    const url = imageUrlFrom(result.body);
    if (!url) return { ok: false as const, error: "A edição veio sem endereço." };
    return { ok: true as const, url };
  });

export const startVideo = createServerFn({ method: "POST" })
  .validator(
    (input: {
      prompt: string;
      duration: 6 | 10;
      resolution: "720p" | "1080p";
      aspect: VideoRatio;
      image?: string;
    }) => {
      const prompt = asPrompt(input?.prompt);
      if (input?.duration !== 6 && input?.duration !== 10) throw new Error("Duração inválida.");
      if (input?.resolution !== "720p" && input?.resolution !== "1080p") {
        throw new Error("Resolução inválida.");
      }
      if (!VIDEO_RATIOS.includes(input?.aspect)) throw new Error("Proporção inválida.");
      const image = asImageRef(input?.image);
      return {
        prompt,
        duration: input.duration,
        resolution: input.resolution,
        aspect: input.aspect,
        image,
      };
    },
  )
  .handler(async ({ data }) => {
    const blocked = blockedReason(data.prompt);
    if (blocked) return { ok: false as const, error: blocked };

    const payload: Record<string, unknown> = {
      model: "grok-imagine-video-1.5",
      prompt: data.prompt,
      duration: data.duration,
      resolution: data.resolution,
    };
    if (data.image) payload.image = { url: data.image };
    else payload.aspect_ratio = data.aspect;

    const result = await xai("/videos/generations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!result.ok) return result;
    const requestId = (result.body as { request_id?: unknown })?.request_id;
    if (typeof requestId !== "string" || !requestId) {
      return { ok: false as const, error: "O vídeo não começou." };
    }
    return { ok: true as const, requestId };
  });

export const pollVideo = createServerFn({ method: "POST" })
  .validator((input: { requestId: string }) => {
    const requestId = input?.requestId;
    if (typeof requestId !== "string" || !/^[\w-]{6,160}$/.test(requestId)) {
      throw new Error("Pedido de vídeo inválido.");
    }
    return { requestId };
  })
  .handler(async ({ data }) => {
    const result = await xai(`/videos/${data.requestId}`, { method: "GET" });
    if (!result.ok) return result;
    const body = result.body as {
      status?: string;
      video?: { url?: string };
      error?: unknown;
    };
    const status = body?.status ?? "pending";
    if (status === "done") {
      const url = body.video?.url;
      if (!url) return { ok: false as const, error: "O vídeo ficou pronto sem endereço." };
      return { ok: true as const, status: "done" as const, url };
    }
    if (status === "failed" || status === "expired") {
      const detail = extractError(body);
      return {
        ok: false as const,
        error: detail
          ? humanize(detail, 400)
          : "O vídeo não saiu. Tente outra cena.",
      };
    }
    return { ok: true as const, status: "pending" as const };
  });
