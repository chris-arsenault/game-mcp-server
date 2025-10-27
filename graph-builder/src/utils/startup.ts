import axios from "axios";
import net from "net";
import { config } from "./config.js";
import { logger } from "./logger.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Dependency {
    name: string;
    check: () => Promise<void>;
}

async function waitForDependency(dep: Dependency, retries = 30, delayMs = 10000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await dep.check();
            logger.info(`[startup] ${dep.name} available (attempt ${attempt})`);
            return;
        } catch (error) {
            logger.warn(
                `[startup] Waiting for ${dep.name} (attempt ${attempt}/${retries}): ${
                    (error as Error).message
                }`
            );
            if (attempt === retries) {
                throw new Error(
                    `${dep.name} not reachable after ${retries} attempts`
                );
            }
            await wait(delayMs);
        }
    }
}

async function checkHttp(url: string, timeoutMs = 2000) {
    await axios.get(url, { timeout: timeoutMs });
}

async function checkTcp(host: string, port: number, timeoutMs = 2000) {
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
    const embeddingUrl = config.embedding.url;
    const qdrantUrl =
        config.qdrant.url.replace(/\/$/, "") + "/healthz";
    const neo4jUrl = new URL(config.neo4j.url);

    const dependencies: Dependency[] = [
        {
            name: "Embedding service",
            check: () => checkHttp(embeddingUrl)
        },
        {
            name: "Qdrant",
            check: () => checkHttp(qdrantUrl)
        },
        {
            name: "Neo4j",
            check: () =>
                checkTcp(
                    neo4jUrl.hostname,
                    Number(neo4jUrl.port || (neo4jUrl.protocol === "bolt:" ? 7687 : 80))
                )
        }
    ];

    logger.info(
        "[startup] Waiting for dependencies: embedding service, Qdrant, Neo4j"
    );

    for (const dep of dependencies) {
        await waitForDependency(dep);
    }

    logger.info("[startup] All dependencies are reachable");
}
