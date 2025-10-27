import axios from "axios";
import net from "net";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DependencyConfig {
    name: string;
    check: () => Promise<void>;
}

async function waitForDependency(dep: DependencyConfig, retries = 30, delayMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await dep.check();
            console.log(`[startup] ${dep.name} available (attempt ${attempt})`);
            return;
        } catch (error) {
            console.warn(`[startup] Waiting for ${dep.name} (attempt ${attempt}/${retries}): ${(error as Error).message}`);
            if (attempt === retries) {
                throw new Error(`${dep.name} did not become available after ${retries} attempts`);
            }
            await wait(delayMs);
        }
    }
}

async function checkHttpEndpoint(url: string, timeoutMs = 2000) {
    await axios.get(url, { timeout: timeoutMs });
}

async function checkTcpEndpoint(host: string, port: number, timeoutMs = 2000) {
    await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
            socket.end();
            resolve();
        });
        socket.on("error", reject);
        socket.on("timeout", () => {
            socket.destroy(new Error("connection timeout"));
        });
    });
}

export async function waitForDependencies() {
    const embeddingUrl = process.env.EMBEDDING_URL || "http://localhost:8080";
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333/healthz";
    const neo4jHost = new URL(process.env.NEO4J_URL || "bolt://localhost:7687");

    const dependencies: DependencyConfig[] = [
        {
            name: "Embedding service",
            check: () => checkHttpEndpoint(embeddingUrl)
        },
        {
            name: "Qdrant",
            check: () => checkHttpEndpoint(qdrantUrl)
        },
        {
            name: "Neo4j",
            check: () => checkTcpEndpoint(neo4jHost.hostname, Number(neo4jHost.port || 7687))
        }
    ];

    console.log("[startup] Waiting for dependencies: embedding, Qdrant, Neo4j");

    for (const dep of dependencies) {
        await waitForDependency(dep);
    }

    console.log("[startup] All dependencies are available");
}
