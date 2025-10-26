
import axios from "axios";

export class EmbeddingService {
    private url: string;

    constructor(url: string) {
        this.url = url;
    }

    async embed(text: string): Promise<number[]> {
        const response = await axios
            .post(`${this.url}/embed`, { inputs: text })
            .catch((error) => {
                if (axios.isAxiosError(error)) {
                    const detail =
                        typeof error.response?.data === "string"
                            ? error.response.data
                            : JSON.stringify(error.response?.data);
                    console.error("Embedding error:", detail || error.message);
                    throw new Error(
                        `Failed to generate embedding: ${detail || error.message}`
                    );
                }
                console.error("Embedding error:", error);
                throw new Error("Failed to generate embedding");
            });
        return response.data[0]; // Returns array of floats
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await axios
            .post(`${this.url}/embed`, { inputs: texts })
            .catch((error) => {
                if (axios.isAxiosError(error)) {
                    const detail =
                        typeof error.response?.data === "string"
                            ? error.response.data
                            : JSON.stringify(error.response?.data);
                    console.error("Batch embedding error:", detail || error.message);
                    throw new Error(
                        `Failed to generate batch embeddings: ${detail || error.message}`
                    );
                }
                console.error("Batch embedding error:", error);
                throw new Error("Failed to generate batch embeddings");
            });
        return response.data;
    }
}
