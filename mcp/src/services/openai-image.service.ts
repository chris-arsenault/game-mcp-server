import axios, { AxiosInstance } from "axios";

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
    private client: AxiosInstance;
    private defaultModel: string;
    private defaultSize: string;
    private defaultQuality: string;
    private defaultBackground: string;

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

        this.client = axios.create({
            baseURL: options?.baseURL ?? "https://api.openai.com/v1",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            timeout: 60_000
        });

        this.defaultModel = options?.defaultModel ?? "gpt-image-1";
        this.defaultSize = options?.defaultSize ?? "1024x1024";
        this.defaultQuality = options?.defaultQuality ?? "standard";
        this.defaultBackground = options?.defaultBackground ?? "auto";
    }

    async generate(params: GenerateImageParams): Promise<GeneratedImage[]> {
        const payload = {
            prompt: params.prompt,
            model: params.model ?? this.defaultModel,
            size: params.size ?? this.defaultSize,
            quality: params.quality ?? this.defaultQuality,
            background: params.background ?? this.defaultBackground
        };

        try {
            const response = await this.client.post("/images/generations", payload);
            const data = response.data;
            if (!data || !Array.isArray(data.data)) {
                console.error("[OpenAIImageService] Unexpected response structure", {
                    payload: this.safePayload(payload),
                    response: data
                });
                throw new Error("Unexpected response from OpenAI image API");
            }

            return data.data.map((item: any) => ({
                url: item.url,
                b64_json: item.b64_json,
                revised_prompt: item.revised_prompt
            }));
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const statusText = error.response?.statusText;
                const responseData = error.response?.data;
                console.error("[OpenAIImageService] Image generation request failed", {
                    status,
                    statusText,
                    response: responseData,
                    payload: this.safePayload(payload)
                });
                throw new Error(
                    `OpenAI image generation failed: ${status ?? ""} ${statusText ?? error.message}`
                );
            }

            console.error("[OpenAIImageService] Image generation error", {
                error: error instanceof Error ? error.message : String(error),
                payload: this.safePayload(payload)
            });
            throw error;
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
