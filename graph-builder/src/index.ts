import express from "express";
import { BuildService } from "./services/build.service.js";
import { logger } from "./utils/logger.js";
import { config } from "./utils/config.js";
import { resetStaging } from "./utils/reset.js";
import { BuildRequest } from "./types/index.js";
import { waitForDependencies } from "./utils/startup.js";

const app = express();
const buildService = new BuildService();

app.use(express.json({ limit: "1mb" }));

app.get("/status", (_req, res) => {
    res.json(buildService.getStatus());
});

app.post("/reset", async (_req, res, next) => {
    try {
        await resetStaging();
        res.json({ success: true, message: "Staging directory reset" });
    } catch (error) {
        next(error);
    }
});

app.post("/build", async (req, res, next) => {
    try {
        const mode = (req.body?.mode ?? "incremental") as BuildRequest["mode"];
        const stage = (req.body?.stage ?? "all") as BuildRequest["stage"];
        const baseCommit = req.body?.baseCommit as string | undefined;
        const repoUrl = req.body?.repoUrl as string | undefined;
        const branch = req.body?.branch as string | undefined;

        if (!["incremental", "full"].includes(mode)) {
            return res.status(400).json({
                success: false,
                error: `Invalid mode '${mode}'. Expected 'incremental' or 'full'.`
            });
        }

        if (
            stage &&
            !["all", "parse", "enrich", "populate"].includes(stage)
        ) {
            return res.status(400).json({
                success: false,
                error: `Invalid stage '${stage}'. Expected one of all|parse|enrich|populate.`
            });
        }

        const request: BuildRequest = {
            mode,
            stage,
            baseCommit,
            repoUrl,
            branch
        };

        try {
            buildService.startBuild(request);
        } catch (error) {
            if (error instanceof Error && error.message.includes("already in progress")) {
                return res.status(409).json({
                    success: false,
                    error: error.message
                });
            }
            throw error;
        }

        res.status(202).json({
            success: true,
            message: `Build queued (${mode}/${stage})`,
            request
        });
    } catch (error) {
        next(error);
    }
});

app.use(
    (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Unhandled error:", err);
        res.status(500).json({
            success: false,
            error: message
        });
    }
);

const port = config.server.port;

waitForDependencies()
    .then(() => {
        app.listen(port, () => {
            logger.info(`Knowledge graph builder API listening on port ${port}`);
        });
    })
    .catch((error) => {
        logger.error("Failed to start graph builder API:", error);
        process.exit(1);
    });
