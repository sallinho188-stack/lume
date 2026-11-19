import { useEffect, useId, useRef, useState } from "react";
import { Aperture, Clapperboard, Download, ImagePlus, X } from "lucide-react";
import {
  directPrompt,
  editImage,
  generateImage,
  pollVideo,
  startVideo,
  studioReady,
} from "@/lib/lume/functions";

type Mode = "image" | "video";
type Piece = {
  id: string;
  kind: Mode;
  url: string;
  prompt: string;
  aspect: string;
  createdAt: number;
};

const GALLERY_KEY = "lume.gallery.v1";
const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"] as const;
const VIDEO_RATIOS = ["1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2"] as const;

const STYLES: { id: string; label: string; suffix: string }[] = [
  { id: "livre", label: "Livre", suffix: "" },
  {
    id: "cinema",
    label: "Cinema",
    suffix: "Cinematic frame, anamorphic lens, natural light, subtle film grain.",
  },
  {
    id: "foto",
    label: "Foto",
    suffix: "Photorealistic photograph, sharp detail, natural color.",
  },
  {
    id: "editorial",
    label: "Editorial",
    suffix: "Editorial photography, precise styling, magazine light.",
  },
  {
    id: "ilustra",
    label: "Ilustração",
    suffix: "Illustrated, clear materials, rich color.",
  },
  {
    id: "pintura",
    label: "Pintura",
    suffix: "Oil painting, visible brushwork, gallery light.",
  },
  {
    id: "anime",
    label: "Anime",
    suffix: "Anime film still, clean linework, expressive color.",
  },
];

function aspectRatioValue(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

function loadGallery(): Piece[] {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Piece[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.url === "string").slice(0, 36);
  } catch {
    return [];
  }
}

function saveGallery(pieces: Piece[]) {
  localStorage.setItem(GALLERY_KEY, JSON.stringify(pieces.slice(0, 36)));
}

async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não deu para ler a imagem.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.86);
}

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Não deu para criar agora.";
}

export function Studio() {
  const promptId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<string>("3:4");
  const [imageRes, setImageRes] = useState<"1k" | "2k">("1k");
  const [duration, setDuration] = useState<6 | 10>(6);
  const [videoRes, setVideoRes] = useState<"720p" | "1080p">("720p");
  const [styleId, setStyleId] = useState("livre");
  const [director, setDirector] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<null | "image" | "edit" | "video">(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState<Piece | null>(null);
  const [gallery, setGallery] = useState<Piece[]>([]);
  const [reference, setReference] = useState<{ url: string; name: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    alive.current = true;
    setGallery(loadGallery());
    setHydrated(true);
    studioReady()
      .then((result) => {
        if (alive.current) setReady(result.ready);
      })
      .catch(() => {
        if (alive.current) setReady(false);
      });
    return () => {
      alive.current = false;
    };
  }, []);

  function remember(piece: Piece) {
    setActive(piece);
    setGallery((current) => {
      const next = [piece, ...current.filter((item) => item.url !== piece.url)].slice(0, 36);
      saveGallery(next);
      return next;
    });
  }

  function composedPrompt() {
    const suffix = STYLES.find((item) => item.id === styleId)?.suffix ?? "";
    const base = prompt.trim();
    if (!suffix || base.toLowerCase().includes(suffix.slice(0, 24).toLowerCase())) return base;
    return `${base}\n${suffix}`;
  }

  async function maybeDirect(text: string) {
    if (!director) return text;
    setStatus("O diretor está afinando o pedido…");
    const directed = await directPrompt({ data: { prompt: text, mode } });
    if (!directed.ok) throw new Error(directed.error);
    return directed.prompt;
  }

  async function onCreateImage() {
    const text = composedPrompt();
    if (text.length < 2) {
      setError("Escreva o que você quer ver.");
      return;
    }
    setError("");
    setBusy("image");
    setStatus("Revelando a imagem…");
    try {
      const finalPrompt = await maybeDirect(text);
      const ratio = IMAGE_RATIOS.includes(aspect as (typeof IMAGE_RATIOS)[number])
        ? (aspect as (typeof IMAGE_RATIOS)[number])
        : "3:4";
      const result = await generateImage({
        data: { prompt: finalPrompt, aspect: ratio, resolution: imageRes },
      });
      if (!result.ok) throw new Error(result.error);
      const piece: Piece = {
        id: crypto.randomUUID(),
        kind: "image",
        url: result.url,
        prompt: finalPrompt,
        aspect: ratio,
        createdAt: Date.now(),
      };
      remember(piece);
      setReference({ url: result.url, name: "Última imagem" });
      setStatus("");
    } catch (err) {
      setError(messageFrom(err));
      setStatus("");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function onEdit() {
    if (!reference) return;
    const text = composedPrompt();
    if (text.length < 2) {
      setError("Diga o que muda na imagem.");
      return;
    }
    setError("");
    setBusy("edit");
    setStatus("Editando…");
    try {
      const finalPrompt = await maybeDirect(text);
      const ratio = IMAGE_RATIOS.includes(aspect as (typeof IMAGE_RATIOS)[number])
        ? (aspect as (typeof IMAGE_RATIOS)[number])
        : "3:4";
      const result = await editImage({
        data: {
          prompt: finalPrompt,
          image: reference.url,
          aspect: ratio,
          resolution: imageRes,
        },
      });
      if (!result.ok) throw new Error(result.error);
      const piece: Piece = {
        id: crypto.randomUUID(),
        kind: "image",
        url: result.url,
        prompt: finalPrompt,
        aspect: ratio,
        createdAt: Date.now(),
      };
      remember(piece);
      setReference({ url: result.url, name: "Última imagem" });
      setStatus("");
    } catch (err) {
      setError(messageFrom(err));
      setStatus("");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function onCreateVideo() {
    const text = composedPrompt();
    if (text.length < 2) {
      setError("Escreva o movimento que você quer ver.");
      return;
    }
    setError("");
    setBusy("video");
    setStatus("Abrindo a câmera…");
    try {
      const finalPrompt = await maybeDirect(text);
      const ratio = VIDEO_RATIOS.includes(aspect as (typeof VIDEO_RATIOS)[number])
        ? (aspect as (typeof VIDEO_RATIOS)[number])
        : "16:9";
      const started = await startVideo({
        data: {
          prompt: finalPrompt,
          duration,
          resolution: videoRes,
          aspect: ratio,
          image: reference?.url,
        },
      });
      if (!started.ok) throw new Error(started.error);
      const startedAt = Date.now();
      for (let i = 0; i < 40; i += 1) {
        if (!alive.current) return;
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        setStatus(`Filmando… ${seconds}s`);
        await new Promise((resolve) => setTimeout(resolve, 4000));
        if (!alive.current) return;
        const polled = await pollVideo({ data: { requestId: started.requestId } });
        if (!polled.ok) throw new Error(polled.error);
        if (polled.status === "done") {
          const piece: Piece = {
            id: crypto.randomUUID(),
            kind: "video",
            url: polled.url,
            prompt: finalPrompt,
            aspect: reference ? "auto" : ratio,
            createdAt: Date.now(),
          };
          remember(piece);
          setStatus("");
          return;
        }
      }
      throw new Error("O vídeo demorou demais. Tente uma cena mais curta.");
    } catch (err) {
      setError(messageFrom(err));
      setStatus("");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Use uma imagem.");
      return;
    }
    setError("");
    try {
      const url = await fileToDataUrl(file);
      setReference({ url, name: file.name });
    } catch (err) {
      setError(messageFrom(err));
    }
  }

  function selectMode(next: Mode) {
    setMode(next);
    const allowed = next === "image" ? IMAGE_RATIOS : VIDEO_RATIOS;
    if (!(allowed as readonly string[]).includes(aspect)) {
      setAspect(next === "image" ? "3:4" : "16:9");
    }
  }
  const ratios = mode === "image" ? IMAGE_RATIOS : VIDEO_RATIOS;
  const working = busy !== null;
  const stageAspect = active?.aspect && active.aspect !== "auto" ? active.aspect : aspect;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-6xl px-4 pt-5 pb-10 sm:px-6">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-widest text-muted uppercase">Estúdio</p>
          <h1 className="font-display text-5xl leading-none font-medium tracking-tight text-ink">
            Lume
          </h1>
        </div>
        <div
          className="flex rounded-full bg-elevated p-1"
          role="tablist"
          aria-label="Modo de criação"
        >
          <ModeButton current={mode} value="image" onSelect={selectMode} disabled={working}>
            Imagem
          </ModeButton>
          <ModeButton current={mode} value="video" onSelect={selectMode} disabled={working}>
            Vídeo
          </ModeButton>
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="order-2 min-w-0 overflow-hidden rounded-xl bg-surface p-3 sm:p-4 lg:order-1">
          <div className="stage-well">
            <div
              className="stage-frame overflow-hidden rounded-lg bg-bg"
              style={{ ["--ar" as string]: String(aspectRatioValue(stageAspect)) }}
            >
              {active?.kind === "video" ? (
                <video key={active.url} src={active.url} controls playsInline autoPlay loop />
              ) : active ? (
                <img src={active.url} alt={active.prompt} />
              ) : (
                <div className="flex h-full flex-col items-start justify-end p-6 sm:p-8">
                  <Aperture className="mb-6 size-8 text-faint" strokeWidth={1.25} />
                  <p className="font-display text-3xl text-ink">Nada na mesa.</p>
                  <p className="mt-2 max-w-xs text-sm text-pretty text-muted">
                    Descreva a cena. Imagem e vídeo saem daqui, quantas vezes você quiser.
                  </p>
                </div>
              )}
            </div>
          </div>

          {working && status ? (
            <div className="mt-3 px-1">
              <div className="bg-line h-px overflow-hidden">
                <div className="reveal bg-paper h-px w-full" />
              </div>
              <p className="mt-2 text-sm text-muted tabular-nums">{status}</p>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {active ? (
              <a
                href={active.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-md bg-elevated px-3 text-sm font-medium text-ink"
              >
                <Download className="size-4" strokeWidth={1.75} />
                Abrir
              </a>
            ) : null}
            {active?.kind === "image" ? (
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-md bg-elevated px-3 text-sm font-medium text-ink disabled:opacity-40"
                disabled={working}
                onClick={() => {
                  setReference({ url: active.url, name: "Esta imagem" });
                  setMode("video");
                  setAspect("16:9");
                }}
              >
                <Clapperboard className="size-4" strokeWidth={1.75} />
                Animar
              </button>
            ) : null}
            {reference ? (
              <button
                type="button"
                className="inline-flex h-11 max-w-full items-center gap-2 rounded-md px-3 text-sm text-muted"
                onClick={() => setReference(null)}
                disabled={working}
              >
                <X className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="truncate">Ref: {reference.name}</span>
              </button>
            ) : null}
          </div>

          {hydrated && gallery.length > 0 ? (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {gallery.map((piece) => (
                <button
                  key={piece.id}
                  type="button"
                  onClick={() => setActive(piece)}
                  className={
                    "h-16 w-16 shrink-0 overflow-hidden rounded-md bg-elevated ring-offset-2 ring-offset-surface " +
                    (active?.id === piece.id ? "ring-2 ring-paper" : "")
                  }
                  aria-label={piece.kind === "video" ? "Abrir vídeo" : "Abrir imagem"}
                >
                  {piece.kind === "video" ? (
                    <span className="flex h-full w-full items-center justify-center text-muted">
                      <Clapperboard className="size-4" />
                    </span>
                  ) : (
                    <img src={piece.url} alt="" className="h-full w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="order-1 rounded-xl bg-surface p-4 lg:sticky lg:top-4 lg:order-2">
          <label htmlFor={promptId} className="text-sm font-medium text-ink">
            {mode === "image" ? "O que você quer ver" : "O que a câmera faz"}
          </label>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            maxLength={4000}
            placeholder={
              mode === "image"
                ? "Uma cozinha de azulejo azul ao fim da tarde, luz de janela, mesa posta."
                : "A cortina se move com o vento e a câmera se aproxima da mesa."
            }
            className="mt-2 w-full resize-none rounded-md border border-line bg-bg px-3 py-3 text-base text-ink outline-none placeholder:text-faint focus-visible:border-paper"
          />

          <div className="mt-4">
            <p className="mb-2 text-sm text-muted">Proporção</p>
            <div className="flex flex-wrap gap-2">
              {ratios.map((ratio) => (
                <Chip key={ratio} on={aspect === ratio} onClick={() => setAspect(ratio)}>
                  {ratio}
                </Chip>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-sm text-muted">Tratamento</p>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((item) => (
                <Chip key={item.id} on={styleId === item.id} onClick={() => setStyleId(item.id)}>
                  {item.label}
                </Chip>
              ))}
            </div>
          </div>

          {mode === "image" ? (
            <div className="mt-4">
              <p className="mb-2 text-sm text-muted">Tamanho</p>
              <div className="flex gap-2">
                <Chip on={imageRes === "1k"} onClick={() => setImageRes("1k")}>
                  1K
                </Chip>
                <Chip on={imageRes === "2k"} onClick={() => setImageRes("2k")}>
                  2K
                </Chip>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="mb-2 text-sm text-muted">Duração</p>
                <div className="flex gap-2">
                  <Chip on={duration === 6} onClick={() => setDuration(6)}>
                    6s
                  </Chip>
                  <Chip on={duration === 10} onClick={() => setDuration(10)}>
                    10s
                  </Chip>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm text-muted">Qualidade</p>
                <div className="flex gap-2">
                  <Chip on={videoRes === "720p"} onClick={() => setVideoRes("720p")}>
                    720p
                  </Chip>
                  <Chip on={videoRes === "1080p"} onClick={() => setVideoRes("1080p")}>
                    1080p
                  </Chip>
                </div>
              </div>
            </div>
          )}

          <label className="mt-4 flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={director}
              onChange={(event) => setDirector(event.target.checked)}
              className="check mt-0.5 size-4"
            />
            <span>
              Diretor ligado
              <span className="mt-0.5 block text-muted">
                Reescreve o pedido com mais detalhe visual, sem mudar a intenção. Desligado, vai
                o texto exatamente como você escreveu.
              </span>
            </span>
          </label>

          <div className="mt-4 flex flex-col gap-2">
            {mode === "image" ? (
              <>
                <button
                  type="button"
                  disabled={working || ready === false}
                  onClick={onCreateImage}
                  className="h-12 rounded-md bg-paper text-base font-medium text-paper-ink transition-opacity disabled:opacity-40"
                >
                  Criar imagem
                </button>
                <button
                  type="button"
                  disabled={working || !reference || ready === false}
                  onClick={onEdit}
                  className="h-12 rounded-md border border-line text-base font-medium text-ink disabled:opacity-40"
                >
                  Editar a referência
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={working || ready === false}
                onClick={onCreateVideo}
                className="h-12 rounded-md bg-paper text-base font-medium text-paper-ink disabled:opacity-40"
              >
                {reference ? "Animar a referência" : "Criar vídeo"}
              </button>
            )}
            <button
              type="button"
              disabled={working}
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md text-sm font-medium text-muted"
            >
              <ImagePlus className="size-4" strokeWidth={1.75} />
              Usar uma imagem sua
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void onPickFile(file);
              }}
            />
          </div>

          {error ? (
            <p className="mt-3 text-sm text-pretty text-danger" role="alert">
              {error}
            </p>
          ) : (
            <p className="mt-3 text-sm text-pretty text-faint">
              Sem cota no app. O modelo ainda recusa o que não pode ser gerado — inclusive qualquer
              cena sexual com menores.
            </p>
          )}
          {ready === false ? (
            <p className="mt-2 text-sm text-danger">A criação não está disponível neste ambiente.</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function ModeButton({
  current,
  value,
  onSelect,
  disabled,
  children,
}: {
  current: Mode;
  value: Mode;
  onSelect: (value: Mode) => void;
  disabled: boolean;
  children: string;
}) {
  const on = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      disabled={disabled}
      onClick={() => {
        onSelect(value);
      }}
      className={
        "h-10 rounded-full px-4 text-sm font-medium disabled:opacity-40 " +
        (on ? "bg-paper text-paper-ink" : "text-muted")
      }
    >
      {children}
    </button>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "h-10 rounded-full px-3 text-sm font-medium " +
        (on ? "bg-paper text-paper-ink" : "bg-elevated text-muted")
      }
    >
      {children}
    </button>
  );
}
