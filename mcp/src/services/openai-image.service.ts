import OpenAI from "openai";

type ImageBackground = "auto" | "transparent" | "opaque";
type ImageQuality = "standard" | "hd" | "low" | "medium" | "high" | "auto";
type ImageSize =
    | "auto"
    | "1024x1024"
    | "1536x1024"
    | "1024x1536"
    | "256x256"
    | "512x512"
    | "1792x1024"
    | "1024x1792";

export type GenerateImageParams = {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    background?: string;
};

export type GeneratedImage = {
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
};

export class OpenAIImageService {
    private client: OpenAI;
    private defaultModel: string;
    private defaultSize: ImageSize;
    private defaultQuality: ImageQuality;
    private defaultBackground: ImageBackground;

    constructor(apiKey: string, options?: {
        baseURL?: string;
        defaultModel?: string;
        defaultSize?: string;
        defaultQuality?: string;
        defaultBackground?: string;
    }) {
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is required for image generation");
        }

        this.client = new OpenAI({
            apiKey,
            baseURL: options?.baseURL
        });

        this.defaultModel = options?.defaultModel ?? "gpt-image-1";
        this.defaultSize = this.parseSize(options?.defaultSize) ?? "1024x1024";
        this.defaultQuality = this.parseQuality(options?.defaultQuality) ?? "auto";
        this.defaultBackground = this.parseBackground(options?.defaultBackground) ?? "auto";
    }

    async generate(params: GenerateImageParams): Promise<GeneratedImage[]> {
        const background = this.parseBackground(params.background) ?? this.defaultBackground;
        const size = this.parseSize(params.size) ?? this.defaultSize;
        const quality = this.parseQuality(params.quality) ?? this.defaultQuality;
        const payload = {
            prompt: params.prompt,
            model: params.model ?? this.defaultModel,
            size,
            quality,
            background
        };

        try {
            const response = await this.client.images.generate(payload);
            if (!response || !Array.isArray(response.data)) {
                console.error("[OpenAIImageService] Unexpected response structure", {
                    payload: this.safePayload(payload),
                    response
                });
                throw new Error("Unexpected response from OpenAI image API");
            }

            return response.data.map((item: any) => ({
                url: item.url,
                b64_json: item.b64_json,
                revised_prompt: item.revised_prompt
            }));
        } catch (error) {
            const err = error as { status?: number; message?: string; error?: unknown };
            console.error("[OpenAIImageService] Image generation error", {
                status: err?.status,
                message: err?.message ?? (error instanceof Error ? error.message : String(error)),
                error: err?.error,
                payload: this.safePayload(payload)
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
            case "standard":
                return "standard";
            case "hd":
                return "hd";
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
            case "auto":
                return "auto";
            case "1024x1024":
                return "1024x1024";
            case "1536x1024":
                return "1536x1024";
            case "1024x1536":
                return "1024x1536";
            case "256x256":
                return "256x256";
            case "512x512":
                return "512x512";
            case "1792x1024":
                return "1792x1024";
            case "1024x1792":
                return "1024x1792";
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
