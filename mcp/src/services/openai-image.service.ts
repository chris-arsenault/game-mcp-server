import axios, { AxiosInstance } from "axios";

export type GenerateImageParams = {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    style?: string;
    response_format?: "url" | "b64_json";
    user?: string;
    n?: number;
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
    private defaultStyle: string;
    private defaultResponseFormat: "url" | "b64_json";

    constructor(apiKey: string, options?: {
        baseURL?: string;
        defaultModel?: string;
        defaultSize?: string;
        defaultQuality?: string;
        defaultStyle?: string;
        defaultResponseFormat?: "url" | "b64_json";
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
        this.defaultStyle = options?.defaultStyle ?? "vivid";
        this.defaultResponseFormat = options?.defaultResponseFormat ?? "url";
    }

    async generate(params: GenerateImageParams): Promise<GeneratedImage[]> {
        const payload = {
            prompt: params.prompt,
            model: params.model ?? this.defaultModel,
            size: params.size ?? this.defaultSize,
            quality: params.quality ?? this.defaultQuality,
            style: params.style ?? this.defaultStyle,
            response_format: params.response_format ?? this.defaultResponseFormat,
            user: params.user,
            n: params.n ?? 1
        };

        const response = await this.client.post("/images/generations", payload);
        const data = response.data;
        if (!data || !Array.isArray(data.data)) {
            throw new Error("Unexpected response from OpenAI image API");
        }

        return data.data.map((item: any) => ({
            url: item.url,
            b64_json: item.b64_json,
            revised_prompt: item.revised_prompt
        }));
    }
}
