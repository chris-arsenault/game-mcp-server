import { OpenAIImageService, GenerateImageParams, GeneratedImage } from "../services/openai-image.service.js";

export type ImageGenArgs = GenerateImageParams;

export class ImageGenTool {
    constructor(private imageService: OpenAIImageService) {}

    async generateImage(args: ImageGenArgs): Promise<{
        count: number;
        images: GeneratedImage[];
        message: string;
    }> {
        if (!args.prompt || !args.prompt.trim()) {
            throw new Error("prompt is required");
        }

        const images = await this.imageService.generate({
            prompt: args.prompt,
            model: args.model,
            size: args.size,
            quality: args.quality,
            background: args.background,
            response_format: args.response_format,
            user: args.user,
            n: args.n
        });

        return {
            count: images.length,
            images,
            message: images.length > 0 ? "Images generated successfully" : "No images generated"
        };
    }
}
