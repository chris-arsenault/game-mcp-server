
import axios from "axios";

export class EmbeddingService {
    private url: string;

    constructor(url: string) {
        this.url = url;
    }

    async embed(text: string): Promise<number[]> {
        try {
            const response = await axios.post(`${this.url}/embed`, {
                inputs: text
            });
            return response.data[0]; // Returns array of floats
        } catch (error) {
            console.error("Embedding error:", error);
            throw new Error("Failed to generate embedding");
        }
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        try {
            const response = await axios.post(`${this.url}/embed`, {
                inputs: texts
            });
            return response.data;
        } catch (error) {
            console.error("Batch embedding error:", error);
            throw new Error("Failed to generate batch embeddings");
        }
    }
}