import OpenAI from "openai";

type ImageBackground = "auto" | "transparent" | "opaque";
type ImageQuality = "low" | "medium" | "high" | "auto";
type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

type RawDefaults = {
    model?: string;
    size?: string;
    quality?: string;
    background?: string;
};

export type GenerateImageArgs = {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    background?: string;
};

export type GeneratedImage = {
    buffer: Buffer;
    revisedPrompt?: string;
};

export class OpenAIImageService {
    private readonly defaultModel: string;
    private readonly defaultSize: ImageSize;
    private readonly defaultQuality: ImageQuality;
    private readonly defaultBackground: ImageBackground;

    constructor(
        private readonly client: OpenAI,
        defaults: RawDefaults
    ) {
        this.defaultModel = defaults.model ?? "gpt-image-1";
        this.defaultSize = this.parseSize(defaults.size) ?? "1024x1024";
        this.defaultQuality = this.parseQuality(defaults.quality) ?? "auto";
        this.defaultBackground = this.parseBackground(defaults.background) ?? "auto";
    }

    async generate(args: GenerateImageArgs): Promise<GeneratedImage> {
        const background = this.parseBackground(args.background) ?? this.defaultBackground;
        const size = this.parseSize(args.size) ?? this.defaultSize;
        const quality = this.parseQuality(args.quality) ?? this.defaultQuality;

        const payload = {
            prompt: args.prompt,
            model: args.model ?? this.defaultModel,
            size,
            quality,
            background
        } as const;

        try {
            const response = await this.client.images.generate(payload);
            if (!response || !Array.isArray(response.data) || response.data.length === 0) {
                console.error("[OpenAIImageService] Unexpected response structure", {
                    payload: this.safePayload(payload),
                    response
                });
                throw new Error("Unexpected response from OpenAI image API");
            }

            const image = response.data[0];
            if (!image.b64_json) {
                console.error("[OpenAIImageService] Missing base64 payload in response", {
                    payload: this.safePayload(payload),
                    response: image
                });
                throw new Error("OpenAI response did not include base64 image data");
            }

            return {
                buffer: Buffer.from(image.b64_json, "base64"),
                revisedPrompt: image.revised_prompt ?? undefined
            };
        } catch (error) {
            const err = error as { status?: number; message?: string; error?: unknown };
            console.error("[OpenAIImageService] Image generation error", {
                status: err?.status,
                message: err?.message ?? (error instanceof Error ? error.message : String(error)),
                error: err?.error,
                payload: this.safePayload({
                    prompt: args.prompt,
                    model: args.model ?? this.defaultModel,
                    size,
                    quality,
                    background
                })
            });
            throw error;
        }
    }

    private parseBackground(value?: string): ImageBackground | undefined {
        switch ((value ?? "").toLowerCase()) {
            case "auto":
                return "auto";
            case "transparent":
                return "transparent";
            case "opaque":
                return "opaque";
            default:
                return undefined;
        }
    }

    private parseQuality(value?: string): ImageQuality | undefined {
        switch ((value ?? "").toLowerCase()) {
            case "low":
                return "low";
            case "medium":
                return "medium";
            case "high":
                return "high";
            case "auto":
                return "auto";
            default:
                return undefined;
        }
    }

    private parseSize(value?: string): ImageSize | undefined {
        switch ((value ?? "").toLowerCase()) {
            case "1024x1024":
                return "1024x1024";
            case "1536x1024":
                return "1536x1024";
            case "1024x1536":
                return "1024x1536";
            default:
                return undefined;
        }
    }

    private safePayload(payload: Record<string, unknown>) {
        const { prompt, ...rest } = payload;
        return {
            promptPreview: typeof prompt === "string" ? prompt.slice(0, 120) : undefined,
            ...rest
        };
    }
}
