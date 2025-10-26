import { config } from "dotenv";

import { GameDevMCPServer } from "./server.js";

config();

const server = new GameDevMCPServer();

server
    .start()
    .catch(error => {
        console.error("Failed to start Game Dev MCP Server:", error);
        process.exit(1);
    });
