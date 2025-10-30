import axios from "axios";

export class EmbeddingService {
  constructor(private url: string) {}

  async embed(text: string): Promise<number[]> {
    const response = await axios
      .post(`${this.url}/embed`, { inputs: text })
      .catch(error => {
        if (axios.isAxiosError(error)) {
          const detail =
            typeof error.response?.data === "string"
              ? error.response.data
              : JSON.stringify(error.response?.data);
          console.error("Embedding error:", detail || error.message);
          throw new Error(`Failed to generate embedding: ${detail || error.message}`);
        }
        throw error;
      });

    const data = response.data;
    if (Array.isArray(data)) {
      return data[0];
    }
    return data;
  }
}
