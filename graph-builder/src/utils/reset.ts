import { rm, mkdir } from "fs/promises";
import path from "path";
import { config } from "./config.js";
import { logger } from "./logger.js";

export async function resetStaging(): Promise<void> {
    const stagingRoot = config.stagingPath;
    const targets = ["parse", "enrich", "logs"];

    for (const target of targets) {
        const targetPath = path.join(stagingRoot, target);
        await rm(targetPath, { recursive: true, force: true });
        await mkdir(targetPath, { recursive: true });
    }

    await rm(path.join(stagingRoot, "last-build.json"), { force: true });
    logger.info(`Reset staging directory at ${stagingRoot}`);
}
