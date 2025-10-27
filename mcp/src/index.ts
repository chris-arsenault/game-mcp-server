import { GameDevMCPServer } from "./server.js";
import { waitForDependencies } from "./utils/startup.js";

async function bootstrap() {
    try {
        await waitForDependencies();

        const server = new GameDevMCPServer();
        await server.start();
    } catch (error) {
        console.error("Failed to start Game Dev MCP Server:", error);
        process.exit(1);
    }
}

bootstrap();
