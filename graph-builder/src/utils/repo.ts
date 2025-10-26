import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import simpleGit from "simple-git";
import { logger } from "./logger.js";

export async function syncRepository(
    repoPath: string,
    repoUrl: string,
    branch: string
): Promise<void> {
    if (!existsSync(repoPath)) {
        await mkdir(path.dirname(repoPath), { recursive: true });
        logger.info(`Cloning ${repoUrl} into ${repoPath} (branch: ${branch})`);
        const git = simpleGit();
        await git.clone(repoUrl, repoPath, ["--branch", branch, "--single-branch"]);
        logger.info("Clone complete");
        return;
    }

    const git = simpleGit(repoPath);
    logger.info(`Updating repository at ${repoPath} (branch: ${branch})`);
    await git.fetch("origin", branch);
    await git.checkout(branch);
    await git.pull("origin", branch);
    logger.info("Repository update complete");
}
