import { GameDevMCPServer } from "./server.js";
import { migrateLegacyData } from "./utils/migrateLegacyData.js";
import { waitForDependencies } from "./utils/startup.js";

async function bootstrap() {
    try {
        await waitForDependencies();
        await migrateLegacyData();

        const server = new GameDevMCPServer();
        await server.start();
    } catch (error) {
        console.error("Failed to start Game Dev MCP Server:", error);
        process.exit(1);
    }
}

bootstrap();
